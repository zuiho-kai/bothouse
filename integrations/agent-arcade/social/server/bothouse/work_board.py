"""Adapter for the operator's installed Bothouse gate. No shell or user-supplied paths."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from uuid import UUID, uuid4


def main():
    gate, root, role, key, action = sys.argv[1:]
    if str(UUID(key)) != key or not role or len(role) > 200:
        raise ValueError("invalid work identity")
    root = Path(root).resolve()
    scope = root
    scope.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.environ.update(BOARD_DIR=str(scope), GATE_SETUP_DIR=str(root),
                      BOTHOUSE_DATA_DIR=str(root), CC_PROJECT=role, CC_SESSION_KEY="arcade:" + key)
    sys.path.insert(0, str(Path(gate).resolve()))
    import board
    import filelock
    request = json.load(sys.stdin)
    source = "arcade:" + key
    artifacts = scope / "social-results"
    artifacts.mkdir(mode=0o700, exist_ok=True)
    artifact = artifacts / (key + ".json")
    with (scope / "social-intake.lock").open("a+b") as lock:
        filelock.lock(lock)
        # Keep the original board number even if a worker later claims a workspace
        # (which can change sk), or archives the task before an HTTP retry.
        pointer = artifacts / (key + ".id")
        if pointer.exists():
            item = board.item_by_id(int(pointer.read_text(encoding="ascii")))
            if item is None:
                raise ValueError("original task no longer on board")
        else:
            item = next((row for row in board.items() + board.done_records()
                         if row.get("sk") == source), None)
        if not item and action in {"submit", "retry"}:
            number = board.add(request["text"], request["location"], "已接单", role,
                               assigner={"kind": "human", "id": request["sender"]})
            item = board.item_by_id(number)
        if not item or item["who"] != role:
            raise ValueError("unknown assignment")
        number = item["id"]
        if not pointer.exists():
            tmp = pointer.with_suffix(".partial")
            tmp.write_text(str(number), encoding="ascii")
            os.replace(tmp, pointer)
        lease = artifacts / (key + ".worker")
        token = request.get("claim")
        if action == "cancel" and not item.get("returned_at"):
            board.update(number, "已撤回")
            lease.unlink(missing_ok=True)
            item = board.item_by_id(number)
        if token and (not lease.exists() or lease.read_text(encoding="ascii") != token):
            raise ValueError("obsolete worker claim")
        if lease.exists() and time.time() - lease.stat().st_mtime > 150 and not item.get("returned_at"):
            board.update(number, "回执待核实")
            lease.unlink()
            if token:
                raise ValueError("expired worker claim")
            item = board.item_by_id(number)
        if action == "renew":
            if not token:
                raise ValueError("worker claim required")
            lease.touch()
        claimed = None
        if action == "claim" and item["status"] == "已接单" and not item.get("returned_at"):
            # Persist before calling the role. A restart does not repeat a claimed turn.
            claimed = str(uuid4())
            lease.write_text(claimed, encoding="ascii")
            board.update(number, "正在处理")
            item = board.item_by_id(number)
        if action in {"start", "return", "fail", "uncertain"}:
            # These operations are only available to the local role worker.
            if not item.get("returned_at"):
                if action == "return":
                    text = request["text"]
                    if not isinstance(text, str) or not 0 < len(text.strip()) <= 3000:
                        raise ValueError("expected a bounded text deliverable")
                    tmp = artifact.with_suffix(".partial")
                    tmp.write_text(json.dumps({"key": key, "result": text}, ensure_ascii=False), encoding="utf-8")
                    os.replace(tmp, artifact)
                    if not board.returned(number, role):
                        raise RuntimeError("handback rejected")
                else:
                    status = {"start": "正在处理", "fail": "处理失败", "uncertain": "回执待核实"}
                    board.update(number, status[action])
            lease.unlink(missing_ok=True)
            item = board.item_by_id(number)
        if action == "retry" and item["status"] == "处理失败":
            board.update(number, "已接单")
            item = board.item_by_id(number)
        result = {"claimed": claimed, "boardId": number, "key": key, "role": role,
                  "state": {"正在处理": "running", "处理失败": "failed", "回执待核实": "uncertain"}.get(item["status"], "accepted")}
        if item.get("returned_at"):
            data = json.loads(artifact.read_text(encoding="utf-8"))
            if data["key"] != key or not isinstance(data["result"], str) or not 0 < len(data["result"].strip()) <= 3000:
                raise ValueError("invalid deliverable")
            result.update(state="returned", text=data["result"],
                          sha256=hashlib.sha256(data["result"].encode()).hexdigest())
        print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
