#!/usr/bin/env python3
"""Reference GPU admission gate: authenticated submitter, delegated execution."""
import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def reject(message):
    raise ValueError(message)


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        reject("timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def verify(ticket, trusted_keys, now):
    required = {"version", "platform", "user_id", "project", "session", "action", "nonce", "issued_at", "expires_at"}
    claims = ticket["claims"]
    if set(claims) - required - {"message_id"} or not required <= set(claims):
        reject("unknown or missing claim fields")
    if claims["version"] != 1:
        reject("unsupported ticket version")
    public = base64.b64decode(ticket["public_key"], validate=True)
    signature = base64.b64decode(ticket["signature"], validate=True)
    required_text = ("platform", "user_id", "project", "session", "action", "nonce", "issued_at", "expires_at")
    if len(public) != 32 or len(signature) != 64 or not all(isinstance(claims[field], str) and claims[field] for field in required_text):
        reject("invalid Ed25519 key, signature or claim value")
    key_id = hashlib.sha256(public).hexdigest()
    if not hmac.compare_digest(ticket["key_id"], key_id) or key_id not in trusted_keys or not hmac.compare_digest(public, trusted_keys[key_id]):
        reject("untrusted bridge key")
    # Python's Ed25519 is intentionally not imported from an optional package:
    # use the host-provided verifier in production. See verify_signature below.
    verify_signature(public, canonical(claims), signature)
    issued, expires = timestamp(claims["issued_at"]), timestamp(claims["expires_at"])
    if now < issued or now >= expires:
        reject("ticket outside validity interval")
    return claims


def canonical(claims):
    # Match Go's fixed struct field order, including the optional message_id.
    fields = ["version", "platform", "user_id", "project", "session", "action", "message_id", "nonce", "issued_at", "expires_at"]
    ordered = {field: claims.get(field, "") for field in fields}
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":")).encode()


def verify_signature(public, payload, signature):
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        reject("the reference verifier requires the 'cryptography' package")
    Ed25519PublicKey.from_public_bytes(public).verify(signature, payload)


def authorize(policy, claims):
    principal = policy["principals"].get(claims["platform"] + ":" + claims["user_id"])
    if not principal:
        reject("unknown originator")
    binding = principal["projects"].get(claims["project"])
    if not binding or claims["action"] not in binding["actions"]:
        reject("originator is not authorized for this project or action")
    return {"originator": claims["platform"] + ":" + claims["user_id"], "role": principal["role"], "execute_as": binding["execute_as"], "command": binding["command"]}


def audit(path, record):
    line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ticket", required=True, type=Path)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--trusted-keys", required=True, type=Path)
    parser.add_argument("--audit-log", required=True, type=Path)
    parser.add_argument("--nonce-db", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        ticket = json.loads(args.ticket.read_text())
        if not isinstance(ticket, dict) or not isinstance(ticket.get("claims"), dict) or not isinstance(ticket["claims"].get("nonce"), str):
            reject("ticket nonce is required")
        nonce = args.nonce_db / (hashlib.sha256(ticket["claims"]["nonce"].encode()).hexdigest() + ".json")
        nonce.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        policy = json.loads(args.policy.read_text())
        trusted = json.loads(args.trusted_keys.read_text())
        keys = {key_id: base64.b64decode(public, validate=True) for key_id, public in trusted.items()}
        # Verify before claiming the nonce. Claiming it first meant anyone could
        # fill the directory with bogus tickets and exhaust it without ever
        # presenting a valid signature (2026-11-05 review, item 4).
        claims = verify(ticket, keys, datetime.now(timezone.utc))
        grant = authorize(policy, claims)
        # One exclusive file per verified nonce; a replay finds it and is rejected
        # before any execution, including when the replayed ticket has expired.
        try:
            fd = os.open(nonce, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            reject("ticket nonce was already used")
        try:
            os.write(fd, json.dumps({"nonce": claims["nonce"], "originator": grant["originator"]}, ensure_ascii=False).encode())
            os.fsync(fd)
        finally:
            os.close(fd)
        record = {"nonce": claims["nonce"], "originator": grant["originator"], "role": grant["role"], "execute_as": grant["execute_as"], "project": claims["project"], "action": claims["action"], "session": claims["session"], "status": "submitted"}
        audit(args.audit_log, record)
        if args.dry_run:
            print(json.dumps(record, ensure_ascii=False))
        else:
            # The deployment-specific adapter must enforce execute_as with OS
            # isolation. No --user parameter is accepted from the model.
            result = subprocess.run(grant["command"], check=False)
            record["exit_code"] = result.returncode
            audit(args.audit_log, record)
            if result.returncode:
                return result.returncode
    except Exception as exc:
        # InvalidSignature is deliberately mapped to a generic denial. The
        # cryptography exception carries no text, so fall back to its type name
        # rather than printing a bare "denied: ".
        reason = str(exc) or type(exc).__name__
        print("gpu-submit: denied: " + reason, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
