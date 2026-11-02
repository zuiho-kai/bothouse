#!/usr/bin/env python3
"""Normalize an already authenticated GitHub webhook; never verifies signatures.

Usage: github_event.py SOURCE TASK DELIVERY_ID OCCURRED_AT payload.json
The trusted gateway supplies X-GitHub-Delivery and receipt time after verifying
GitHub's signature. Source/thread binding is still required on bothouse.
"""
import json
import sys

source, task, delivery, occurred, path = sys.argv[1:]
with open(path, encoding="utf-8") as stream:
    payload = json.load(stream)
repo = str(payload["repository"]["id"])
sender = payload["sender"]
if "comment" in payload:
    item = payload["comment"]
    thread = "github:repo:" + repo + ":issue:" + str(payload["issue"]["number"])
    kind = "bot" if sender["type"] == "Bot" else "human"
elif "check_run" in payload:
    item = payload["check_run"]
    thread = "github:repo:" + repo + ":commit:" + item["head_sha"]
    kind = "ci"
elif "pull_request" in payload:
    item = payload["pull_request"]
    thread = "github:repo:" + repo + ":issue:" + str(item["number"])
    kind = "bot" if sender["type"] == "Bot" else "human"
else:
    raise SystemExit("unsupported GitHub event")
print(json.dumps({"task_events": [{
    "source_instance": source, "event_id": delivery, "task_id": task,
    "thread_ref": thread, "actor_kind": kind, "actor_id": str(sender["id"]),
    "occurred_at": occurred, "payload_ref": item["html_url"],
}]}))
