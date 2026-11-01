#!/usr/bin/env python3
"""Poll a trusted condition snapshot. An unmet condition prints nothing.

Usage: wait_condition.py SOURCE TASK snapshot.json
The provider must keep the event ID and payload stable on repeat reads.
Read/parse failures exit nonzero, so the existing poller does not wake anyone.
"""
import json
import sys

source, task, path = sys.argv[1:]
with open(path, encoding="utf-8") as stream:
    condition = json.load(stream)
if condition["satisfied"] is not True:
    raise SystemExit(0)
print(json.dumps({"task_events": [{
    "source_instance": source, "task_id": task,
    "event_id": condition["event_id"], "thread_ref": condition["thread_ref"],
    "actor_kind": "system", "actor_id": condition["provider_id"],
    "occurred_at": condition["occurred_at"], "payload_ref": condition["payload_ref"],
    "source_sequence": condition["source_sequence"],
}]}))
