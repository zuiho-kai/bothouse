# Bothouse role events

Copyright (c) 2026 zuiho-kai and bothouse contributors. These excerpts retain Apache-2.0. The full license is in [LICENSES/Apache-2.0.txt](../../../LICENSES/Apache-2.0.txt). Agent Arcade's local integration uses CommonJS, its own SQLite history and its existing notification settings. [Upstream revision](https://github.com/zuiho-kai/bothouse/tree/8ec73a8f32573b5307922df3c79675a934cdefb7)

| Upstream source | Git blob | Usage |
|---|---|---|
| plugins/bothouse-role-journal/index.mjs | 23db3635edcd39b024e86515c1373bbe6bf12ece | UTC filename and JSONL record projection, including dropping the role snapshot |
| plugins/bothouse-role-notify/index.mjs | 5b7d8a34a251e89ccade0fa71975ca17dc0836de | Event type and draft filtering before notifying |
| plugins/bothouse-role-notify/lib/bothouse.mjs | aace7c5ed7a907ce36b2b502b73899e9c748a7a5 | Shared status list, statusFilter and roleLabel. Journal and webhook contain the identical helper blob. |
| plugins/bothouse-role-webhook/index.mjs | 20eba0c63bc172c4aad33908d70622be75cffc7e | Reviewed only. Its Discord/Slack/Feishu POST would add a separate external destination. |
| LICENSE | 00eb553da3262800578b20d58dfb0852d12a68a2 | Apache License, version 2.0 |
| NOTICE | 09362ebaa3cab6f238b8525bc9fa101880a2b4e9 | Original notice distributed alongside this file |

The Notices page reads retained, committed assistant source reminders from the selected App conversation. The UTC-day projection uses the existing maximum of 120 stored messages, including compatible pre-upgrade reminders. The role key and session key are scoped identities independent of display names. Older rows lacking a saved name use the current character label or built-in identifier. Separate branches retain separate session keys. A group row requires a saved speaker identity. An owner can view or save one day as JSON Lines. No second durable transcript is created automatically.

Bothouse's SSE connection and DSH binding fetch are replaced by Agent Arcade's existing source bus, role selection and local conversation binding. Desktop delivery continues through Electron and its existing quiet/focus gates. The default notice stays content-free. There is no generic outgoing webhook destination in the listen/notify settings. Calendar/folder/feed subscriptions, the explicit QQ owner route and other configured chat integrations retain their own permissions.
