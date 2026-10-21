#!/usr/bin/env python3
"""Read-only smoke check for running CoNest 8796 device server.

Verifies:
- HTTP 200 on all static, screen, and device endpoints
- /api/devices structure and active device registration
- Per-device screen assets (HTML, screen.css, screen.js, __coqin_device.js)
- Server release integrity: compares deployed commit with release-source.json

SAFETY:
- PURELY READ-ONLY: Never posts audio (/transcribe), never creates turns (/turn).
- One minor side effect: GET /api/config registers a lease for the fixed probe
  client id. It never holds a turn and expires on its own.
- Release check also confirms the deploy record's pid is a live
  voice.device_server whose cwd is releases/<commit>/companion.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://127.0.0.1:8796"
# The deployment's instance and releases directories have no default (they used to be a
# maintainer's own paths): pass --instance-dir / --releases-dir or set CONEST_DEVICE_INSTANCE_DIR /
# CONEST_DEVICE_RELEASES_DIR.
DEFAULT_INSTANCE_DIR = os.environ.get("CONEST_DEVICE_INSTANCE_DIR", "")
DEFAULT_RELEASES_DIR = os.environ.get("CONEST_DEVICE_RELEASES_DIR", "")


def http_get(url: str, timeout: float = 5.0) -> tuple[int, dict[str, str], bytes]:
    """Perform a read-only GET request and return (status, headers, body)."""
    req = urllib.request.Request(url, headers={"User-Agent": "CoNest-SmokeCheck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            headers = {k.lower(): v for k, v in resp.headers.items()}
            body = resp.read()
            return status, headers, body
    except urllib.error.HTTPError as e:
        headers = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
        return e.code, headers, e.read()
    except Exception as e:
        raise RuntimeError(f"Connection failed to {url}: {e}") from e


def verify_release_integrity(
    instance_dir: Path, releases_dir: Path, expected_commit: str = ""
) -> dict:
    """Verify release-source.json matches deployment records and running commit."""
    results = {
        "status": "PASS",
        "details": [],
        "deployed_commit": None,
        "source_commit": None,
        "release_path": None,
    }

    if not instance_dir.exists():
        results["status"] = "WARN"
        results["details"].append(f"Instance directory not found: {instance_dir}")
        return results

    # 1. Find latest deploy record
    deploy_files = sorted(instance_dir.glob("deploy-*.json"))
    if not deploy_files:
        results["status"] = "WARN"
        results["details"].append("No deploy-*.json records found in instance dir")
        return results

    latest_deploy_file = deploy_files[-1]
    try:
        deploy_data = json.loads(latest_deploy_file.read_text(encoding="utf-8"))
    except Exception as e:
        results["status"] = "FAIL"
        results["details"].append(f"Failed to parse {latest_deploy_file.name}: {e}")
        return results

    deployed_commit = deploy_data.get("commit", "")
    results["deployed_commit"] = deployed_commit
    results["details"].append(f"Latest deploy file: {latest_deploy_file.name} (commit: {deployed_commit})")

    if expected_commit and not deployed_commit.startswith(expected_commit):
        results["status"] = "FAIL"
        results["details"].append(
            f"Deployed commit mismatch: expected {expected_commit}, got {deployed_commit}"
        )

    # 2. Check release directory
    release_dir = releases_dir / deployed_commit
    results["release_path"] = str(release_dir)
    if not release_dir.exists():
        results["status"] = "FAIL"
        results["details"].append(f"Release dir does not exist: {release_dir}")
        return results

    # 3. Check release-source.json
    release_source_file = release_dir / "release-source.json"
    if not release_source_file.exists():
        results["status"] = "FAIL"
        results["details"].append(f"release-source.json missing at: {release_source_file}")
        return results

    try:
        source_data = json.loads(release_source_file.read_text(encoding="utf-8"))
    except Exception as e:
        results["status"] = "FAIL"
        results["details"].append(f"Failed to read release-source.json: {e}")
        return results

    source_commit = source_data.get("commit", "")
    results["source_commit"] = source_commit
    results["screen_from"] = source_data.get("screen_from", "")

    if source_commit != deployed_commit:
        results["status"] = "FAIL"
        results["details"].append(
            f"Commit mismatch! Deployed={deployed_commit} vs release-source={source_commit}"
        )
    else:
        results["details"].append(f"release-source.json matches deployed commit ({source_commit[:8]})")

    # 4. The deploy record is only a file: confirm the live process runs from it.
    pid = deploy_data.get("pid")
    expected_cwd = (release_dir / "companion").resolve()
    try:
        pid = str(int(pid))
    except (TypeError, ValueError):
        results["status"] = "FAIL"
        results["details"].append(f"Deploy record has no usable pid: {pid!r}")
        return results
    command = subprocess.run(["ps", "-p", pid, "-o", "command="],
                             capture_output=True, text=True, check=False).stdout.strip()
    if "voice.device_server" not in command:
        results["status"] = "FAIL"
        results["details"].append(f"pid {pid} is not a running voice.device_server (saw: {command or 'nothing'})")
        return results
    lsof = subprocess.run(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"],
                          capture_output=True, text=True, check=False).stdout
    cwd = next((line[1:] for line in lsof.splitlines() if line.startswith("n")), "")
    if not cwd or Path(cwd).resolve() != expected_cwd:
        results["status"] = "FAIL"
        results["details"].append(f"pid {pid} cwd is {cwd or 'unknown'}, expected {expected_cwd}")
    else:
        results["details"].append(f"pid {pid} is live and runs from {expected_cwd}")

    return results


def run_smoke_checks(
    base_url: str = DEFAULT_BASE_URL,
    instance_dir_path: str = DEFAULT_INSTANCE_DIR,
    releases_dir_path: str = DEFAULT_RELEASES_DIR,
    expected_commit: str = "",
) -> int:
    """Execute all read-only checks and print clean report."""
    base_url = base_url.rstrip("/")
    print("=" * 72)
    print(" CoNest 8796 Device Server Read-Only Smoke Check")
    print(f" Target URL: {base_url}")
    print(" Mode: READ-ONLY (no turns created, zero audio posted)")
    print("=" * 72)

    passed = 0
    failed = 0

    def record_check(name: str, success: bool, note: str = ""):
        nonlocal passed, failed
        if success:
            passed += 1
            print(f" [PASS] {name}" + (f" - {note}" if note else ""))
        else:
            failed += 1
            print(f" [FAIL] {name}" + (f" - {note}" if note else ""))

    # 1. Base root check
    try:
        status, headers, body = http_get(f"{base_url}/")
        record_check("GET / (Companion Portal)", status == 200, f"HTTP {status}, {len(body)} bytes")
    except Exception as e:
        record_check("GET / (Companion Portal)", False, str(e))

    # 2. Devices listing endpoint /api/devices
    devices = []
    try:
        status, headers, body = http_get(f"{base_url}/api/devices")
        if status == 200:
            data = json.loads(body.decode("utf-8"))
            devices = data.get("devices", [])
            busy = data.get("busy", None)
            playback = data.get("playback", None)
            note = f"HTTP 200, {len(devices)} device(s) registered (busy={busy}, playback={playback})"
            record_check("GET /api/devices", True, note)
        else:
            record_check("GET /api/devices", False, f"HTTP {status}")
    except Exception as e:
        record_check("GET /api/devices", False, str(e))

    # If no devices discovered from API, fallback to known default
    if not devices:
        devices = [{"device_id": "desk-gge", "name": "G哥的设备"}]

    # 3. Check each device's endpoints
    for dev in devices:
        dev_id = dev.get("device_id")
        dev_name = dev.get("name", dev_id)
        print(f"\n--- Device Check: {dev_name} ({dev_id}) ---")

        # 3.1 Standard device page GET /device/{device_id}
        dev_page_url = f"{base_url}/device/{dev_id}"
        try:
            status, headers, body = http_get(dev_page_url)
            record_check(f"GET /device/{dev_id} (Standard UI)", status == 200, f"HTTP {status}")
        except Exception as e:
            record_check(f"GET /device/{dev_id} (Standard UI)", False, str(e))

        # 3.2 Round screen page GET /device/{device_id}/screen/
        screen_url = f"{base_url}/device/{dev_id}/screen/"
        try:
            status, headers, body = http_get(screen_url)
            html_text = body.decode("utf-8", errors="replace")
            has_screen_tag = 'id="conest-device-ui"' in html_text or 'cn-screen' in html_text
            has_device_inject = '__coqin_device.js' in html_text
            success = (status == 200 and has_screen_tag and has_device_inject)
            record_check(
                f"GET /device/{dev_id}/screen/ (Round Screen HTML)",
                success,
                f"HTTP {status}, conest UI root & injection confirmed",
            )
        except Exception as e:
            record_check(f"GET /device/{dev_id}/screen/ (Round Screen HTML)", False, str(e))

        # 3.3 Screen JavaScript GET /device/{device_id}/screen/screen/screen.js
        screen_js_url = f"{base_url}/device/{dev_id}/screen/screen/screen.js"
        try:
            status, headers, body = http_get(screen_js_url)
            js_text = body.decode("utf-8", errors="replace")
            js_hash = hashlib.sha256(body).hexdigest()[:12]
            has_state_machine = "changePhase" in js_text
            has_thinking = "thinking" in js_text
            success = (status == 200 and has_state_machine and has_thinking)
            record_check(
                f"GET /device/{dev_id}/screen/screen/screen.js",
                success,
                f"HTTP {status}, sha256:{js_hash}, size:{len(body)} bytes",
            )
        except Exception as e:
            record_check(f"GET /device/{dev_id}/screen/screen/screen.js", False, str(e))

        # 3.4 Screen CSS GET /device/{device_id}/screen/screen/screen.css
        screen_css_url = f"{base_url}/device/{dev_id}/screen/screen/screen.css"
        try:
            status, headers, body = http_get(screen_css_url)
            record_check(f"GET /device/{dev_id}/screen/screen/screen.css", status == 200, f"HTTP {status}")
        except Exception as e:
            record_check(f"GET /device/{dev_id}/screen/screen/screen.css", False, str(e))

        # 3.5 Device config injection GET /device/{device_id}/screen/__coqin_device.js
        coqin_url = f"{base_url}/device/{dev_id}/screen/__coqin_device.js"
        try:
            status, headers, body = http_get(coqin_url)
            js_text = body.decode("utf-8", errors="replace")
            valid_inject = f'"deviceId":"{dev_id}"' in js_text or f"deviceId: '{dev_id}'" in js_text or dev_id in js_text
            record_check(
                f"GET /device/{dev_id}/screen/__coqin_device.js",
                status == 200 and valid_inject,
                f"HTTP {status}, device binding confirmed",
            )
        except Exception as e:
            record_check(f"GET /device/{dev_id}/screen/__coqin_device.js", False, str(e))

        # 3.6 Device API config GET /device/{device_id}/api/config
        config_url = f"{base_url}/device/{dev_id}/api/config"
        try:
            # Requires valid client UUID format as identity token
            probe_uuid = "00000000-0000-0000-0000-000000000001"
            req = urllib.request.Request(
                config_url,
                headers={"User-Agent": "CoNest-SmokeCheck/1.0", "X-Device-Client": probe_uuid},
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                status = resp.status
                body = resp.read()
            if status == 200:
                cdata = json.loads(body.decode("utf-8"))
                role = cdata.get("default_role", "")
                proj = cdata.get("project", "")
                asr_ready = cdata.get("asr_model_ready", False)
                record_check(
                    f"GET /device/{dev_id}/api/config",
                    True,
                    f"HTTP 200, default_role='{role}', asr_ready={asr_ready}",
                )
            else:
                record_check(f"GET /device/{dev_id}/api/config", False, f"HTTP {status}")
        except Exception as e:
            record_check(f"GET /device/{dev_id}/api/config", False, str(e))

    # 4. Release source & commit integrity check
    print("\n--- Daemon Release & Commit Integrity Check ---")
    release_res = verify_release_integrity(
        Path(instance_dir_path), Path(releases_dir_path), expected_commit=expected_commit
    )
    for detail in release_res["details"]:
        print(f"  • {detail}")

    is_release_ok = release_res["status"] == "PASS"
    record_check(
        "Release Commit Verification (deploy vs release-source.json)",
        is_release_ok,
        f"Commit: {release_res.get('source_commit', 'unknown')[:8]}",
    )

    # Summary
    print("\n" + "=" * 72)
    print(f" Smoke Check Summary: {passed} PASSED, {failed} FAILED")
    print("=" * 72)

    return 0 if failed == 0 else 1


def main():
    parser = argparse.ArgumentParser(
        description="Read-only smoke check for CoNest 8796 device server."
    )
    parser.add_argument(
        "--url", default=DEFAULT_BASE_URL, help=f"Base URL (default: {DEFAULT_BASE_URL})"
    )
    parser.add_argument(
        "--instance-dir",
        default=DEFAULT_INSTANCE_DIR,
        help="Instance directory containing deploy records (default: $CONEST_DEVICE_INSTANCE_DIR; required)",
    )
    parser.add_argument(
        "--releases-dir",
        default=DEFAULT_RELEASES_DIR,
        help="Releases root directory (default: $CONEST_DEVICE_RELEASES_DIR; required)",
    )
    parser.add_argument(
        "--expected-commit",
        default="",
        help="Optional expected commit SHA to verify against",
    )

    args = parser.parse_args()
    if not args.instance_dir or not args.releases_dir:
        parser.error("need the deployment's directories: --instance-dir and --releases-dir "
                     "(or CONEST_DEVICE_INSTANCE_DIR / CONEST_DEVICE_RELEASES_DIR)")
    args.instance_dir = os.path.expanduser(args.instance_dir)
    args.releases_dir = os.path.expanduser(args.releases_dir)
    sys.exit(
        run_smoke_checks(
            base_url=args.url,
            instance_dir_path=args.instance_dir,
            releases_dir_path=args.releases_dir,
            expected_commit=args.expected_commit,
        )
    )


if __name__ == "__main__":
    main()
