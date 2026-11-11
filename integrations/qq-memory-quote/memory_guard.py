"""Trusted memory commit service; run outside the QQ agent's existing OS sandbox."""
import argparse
import ast
from collections import Counter
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socketserver
import subprocess
import sys
import tempfile
import threading


def shared_rules():
    # Reuse the pure definitions without initializing ingest's wiki/model environment.
    source = Path(__file__).resolve().parents[2] / "bridge/contrib/wiki/llmwiki/ingest.py"
    names = {"MIN_QUOTE", "FLAT", "flat", "quote_ok", "in_order", "quotes_on"}
    tree = ast.parse(source.read_text())
    nodes = [node for node in tree.body
             if isinstance(node, ast.FunctionDef) and node.name in names
             or isinstance(node, ast.Assign) and any(
                 isinstance(target, ast.Name) and target.id in names for target in node.targets)]
    namespace = {"re": re}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), namespace)
    return namespace


RULES = shared_rules()


def direct_lines(text):
    """Quoted/reported material is context, never the quoting sender's self statement."""
    # QQ already keeps native replies/forwards out of people_said.text. Exclude
    # explicit pasted quotes and reported speech inside the sender's typed text too.
    for line in text.splitlines():
        if re.search(r'^[ \t]*>|「|」|“|”|"|转述|转发|[他她它]说|说[：:]|\b(?:said|says|wrote)\b', line, re.I):
            continue
        if line.strip():
            yield line


class MemoryStore:
    def __init__(self, memory, people, project, channel):
        self.memory = Path(memory).resolve(strict=True)
        self.people = Path(people).resolve(strict=True)
        if not self.memory.is_dir() or not self.people.is_dir():
            raise ValueError("memory and people must be existing directories")
        if not project or not re.fullmatch(r"qq:(?:g:\d+|\d+(?::\d+)?)", channel):
            raise ValueError("missing QQ bridge project/session context")
        self.project, self.channel = project, channel
        self.lock = threading.RLock()

    def sources(self):
        sources = {}
        for path in self.people.glob("qq-*.jsonl"):
            for line in path.read_text().splitlines():
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue  # An incomplete append is not evidence.
                speaker = record.get("speaker_id", "")
                if (record.get("via") != "bridge" or record.get("kind") != "message"
                        or record.get("dir") != "in" or record.get("platform") != "qq"
                        or record.get("project") != self.project or record.get("channel") != self.channel
                        or not isinstance(speaker, str) or not speaker.isdecimal()
                        or record.get("from_bot") or record.get("role") in ("assistant", "bot", "system")):
                    continue
                # Only the trusted people_said producer writes this store; a request
                # cannot supply its own author, source path, channel, or source text.
                if not isinstance(record.get("text"), str):
                    continue
                identity = hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                sources[identity] = record
        return sources

    def target(self, raw):
        path = Path(raw)
        if not path.is_absolute() or path.parent != self.memory:
            raise ValueError("memory target must be a direct canonical child")
        if path.is_symlink() or path.resolve() != path:
            raise ValueError("memory aliases are not writable")
        if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
            raise ValueError("memory target must be a regular unlinked file")
        group = re.fullmatch(r"qq:(?:g:)?(\d+)(?::\d+)?", self.channel)
        in_group = self.channel.startswith("qq:g:") or self.channel.count(":") == 2
        if path.name == "self.md":
            return path, None
        if re.fullmatch(r"\d+\.md", path.name):
            if not in_group and path.stem != group[1]:
                raise ValueError("private memory belongs to a different person")
            return path, path.stem
        if in_group and path.name == f"group-{group[1]}.md":
            return path, None
        raise ValueError("memory filename is outside this QQ conversation")

    @staticmethod
    def version(path):
        if not path.exists():
            return None
        stat = path.stat()
        # Source: DSH LocalFileSystem FsVersion (dev:ino:size:mtimeNs:ctimeNs).
        return f"{stat.st_dev}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}"

    def validate(self, before, after, owner):
        old = Counter(before.splitlines())
        sources = self.sources()
        for line in after.splitlines():
            if old[line]:
                old[line] -= 1
                continue
            if not line.strip() or re.fullmatch(r"#{1,6} +[^\r\n]+", line):
                continue
            ids = re.findall(r"来源[：:]\s*([0-9a-f]{64})(?![0-9a-f])", line)
            quotes = RULES["quotes_on"](line)
            if not ids or not quotes:
                raise ValueError("new memory facts require 原话：「…」 and 来源：<trusted source id>; query sources first")
            for identity in ids:
                record = sources.get(identity)
                if record is None or owner is not None and record["speaker_id"] != owner:
                    raise ValueError("source is not this person's human message in this conversation")
            texts = [RULES["flat"](text) for identity in ids
                     for text in direct_lines(sources[identity]["text"])]
            if not all(RULES["quote_ok"](quote, texts) for quote in quotes):
                raise ValueError("quote does not match trusted human words; memory unchanged")

    def request(self, request):
        # Multiple ACP conversations share the same memory directory. The file
        # lock spans version checking, validation and publication across services.
        with self.lock, (self.memory / ".quote-commit.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if request.get("op") == "sources":
                return [{"id": identity, **record} for identity, record in self.sources().items()]
            if request.get("op") not in ("write", "edit"):
                raise ValueError("unsupported memory operation")
            path, owner = self.target(request["path"])
            version = self.version(path)
            expected = request.get("expected") or {}
            if expected.get("kind") == "createIfAbsent" and version is not None:
                raise ValueError("memory already exists; read it before writing")
            if expected.get("version") is not None and expected["version"] != version:
                raise ValueError("memory changed since it was read")
            before = path.read_text() if version is not None else ""
            if request["op"] == "edit":
                edit = request["edit"]
                old = edit["oldString"]
                count = before.count(old) if old else 0
                if not count or count > 1 and not edit.get("replaceAll"):
                    raise ValueError("memory edit is missing or ambiguous")
                after = before.replace(old, edit["newString"], -1 if edit.get("replaceAll") else 1)
            else:
                after = request["content"]
            if not isinstance(after, str):
                raise ValueError("memory content must be text")
            self.validate(before, after, owner)
            # All writers, including DSH itself, are OS-denied. Only this service
            # can publish; it never spawns request-supplied commands. No cleanup
            # removes directories: os.replace consumes the one staging file.
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.memory, delete=False) as staged:
                staged.write(after)
                staged.flush()
                os.fsync(staged.fileno())
                stage = staged.name
            os.replace(stage, path)
            return {"operation": "update" if version else "create",
                    "version": self.version(path), "before": before if version else None, "after": after}


class RequestHandler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            envelope = json.loads(self.rfile.readline())
            if not hmac.compare_digest(str(envelope.get("capability", "")), self.server.capability):
                raise ValueError("memory capability is not valid for this conversation")
            result = self.server.store.request(envelope["request"])
            response = {"ok": True, "result": result}
        except (OSError, ValueError, KeyError, TypeError) as error:
            response = {"ok": False, "error": str(error)}
        self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode())


def sandbox_overlay(profile, memory, people, runtime, code):
    """Extend the existing QQ policy; the entire agent tree stays untrusted."""
    forms = [profile]
    forms.append(f"(allow file-read-data (subpath {json.dumps(str(Path(code).resolve()))}))")
    for root in (memory, people, runtime, code):
        path = Path(root).resolve()
        forms.append(f"(deny file-write* (subpath {json.dumps(str(path))}))")
        # Prevent swapping an ancestor to replace a protected tree via rename.
        forms.extend(f"(deny file-write* (literal {json.dumps(str(parent))}))"
                     for parent in path.parents if parent != Path("/"))
    forms.append(f"(deny file-read-data (subpath {json.dumps(str(Path(people).resolve()))}))")
    forms.extend(["(deny mach-priv-task-port)",
                  "(deny signal (target others))", "(allow signal (target same-sandbox))",
                  "(deny process-info* (target others))", "(allow process-info* (target same-sandbox))"])
    return "\n".join(forms)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--memory", required=True)
    parser.add_argument("--people", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("this integration requires the existing macOS QQ sandbox")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a sandboxed agent command is required")
    store = MemoryStore(args.memory, args.people, os.environ.get("CC_PROJECT", ""),
                        os.environ.get("CC_SESSION_KEY", ""))
    runtime = Path(tempfile.mkdtemp(prefix="quote-", dir=Path(args.runtime).resolve(strict=True)))
    socket = runtime / "commit.sock"
    code = Path(__file__).resolve().parent
    profile = runtime / "memory.sb"
    profile.write_text(sandbox_overlay(Path(args.profile).read_text(), store.memory, store.people, runtime, code))
    with socketserver.ThreadingUnixStreamServer(str(socket), RequestHandler) as server:
        server.daemon_threads = True
        server.store = store
        server.capability = secrets.token_hex()
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        env = os.environ.copy()
        env["QQ_MEMORY_SOCKET"] = str(socket)
        env["QQ_MEMORY_ROOT"] = str(store.memory)
        # The capability is never written into the child-readable runtime files.
        # Another QQ channel's agent cannot use a discovered socket to change scope.
        env["QQ_MEMORY_CAPABILITY"] = server.capability
        # Compose with existing Node --import loaders (image/session fixes).
        env["NODE_OPTIONS"] = (env.get("NODE_OPTIONS", "") +
                               " --import " + (code / "loader.mjs").as_uri()).strip()
        child = subprocess.Popen(["/usr/bin/sandbox-exec", "-f", str(profile), *command], env=env)
        def stop(signum, _frame):
            child.send_signal(signum)
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(signum, stop)
        try:
            return child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait()
            server.shutdown()
            worker.join()


if __name__ == "__main__":
    raise SystemExit(main())
