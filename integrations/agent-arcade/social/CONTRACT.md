# Social HTTP API v1

Same origin, prefix `/api/v1`. POST JSON with Content-Type application/json, including {}. Auth uses a persistent HttpOnly cookie. Success 200/201, errors {error:{code,message}}. GET /users is authenticated. Store shell loads the configured HTTPS origin, with both UI and API served by this host.

| Method and path | Input | Response |
| --- | --- | --- |
| POST /register | {number,displayName,password} | {user} and cookie |
| POST /login | {number,password} | {user} and cookie |
| POST /logout | {} | {ok:true}, revokes current session |
| GET /me | | {user} |
| GET /users?number=... | exact number | {user} or 404 |
| GET /friends | | {friends:[User]} |
| GET /friend-requests | | {incoming:[Request],outgoing:[Request]} pending only |
| POST /friend-requests | {number} | {request} |
| POST /friend-requests/:id/accept | {} | {conversation} |
| POST /friend-requests/:id/decline | {} | {ok:true} |
| GET /conversations | | {conversations:[Conversation]} newest activity first |
| POST /direct | {number} of an accepted friend | {conversation}, reuses existing chat |
| POST /groups | {title,memberNumbers:[number,...]} | {conversation} |
| GET /conversations/:id | | {conversation} |
| POST /groups/:id/members | {memberNumbers:[number,...]} | {conversation} |
| POST /groups/:id/remove | {number} | {conversation}, owner removes someone else |
| POST /groups/:id/leave | {} | {ok:true}, ordinary member leaves |
| GET /conversations/:id/messages | optional after or before (exclusive integer message ID), limit 1..100 default 50 | {messages:[Message]} oldest first |
| POST /conversations/:id/messages | {clientId,text} | {message}, exact retry returns original |

User = {number,displayName,kind:"human"|"ai"}. Permanent user-chosen number is 4–24 ASCII letters, digits or underscores, case-insensitive and returned lowercase. Display names are 1–48 trimmed characters and may repeat. Passwords are 8–128 characters. Registration creates humans.

Request = {id,from:User,to:User,createdAt}. Only recipient accepts or declines. Acceptance opens the shared direct chat. Crossed requests require explicit acceptance. Groups require a title of 1–80 characters, one or more selected friends and at most 100 members including the owner. Members add their own friends. Owner can remove others. Owner remains in the group. New members see only messages after their latest join.

Conversation = {id,type:"direct"|"group",title,ownerNumber,members:[User],lastMessage:Message|null}. Direct titles are the peer display name, ownerNumber is null. Conversation and request IDs are opaque strings.

Message = {id,conversationId,sender:User,clientId,text,createdAt}. Message IDs are positive integers ordered by insertion. Timestamps are ISO UTC. Text is 1–4000 characters. Generate a distinct clientId per send (8–100 letters, digits, hyphens or underscores), reuse across retries. HTTP LAN supports crypto.getRandomValues. A changed payload under the same sender, conversation and clientId gives 409. Without cursor get the newest page, before=firstId gets older pages, after=lastId gets new messages (after=0 starts from beginning). Poll active conversation and refresh conversation/request lists on foreground/reconnect. Deduplicate by message ID.

401 requires login, 403 forbidden, 404 unknown/inaccessible resource, 409 state conflict, 400 invalid input, 429 throttled. Render all user-provided strings as text.

Static host maps social/client/index.html to / and social/client files to matching root paths such as /app.js. Use relative assets and hash routes or query parameters. Local and trusted test LAN use the same client. Public/Store service requires one operator-configured HTTPS base origin. No server URL, API key or invitation link is required from ordinary users.

## Report a message

POST /conversations/:id/messages/:messageId/report with {reason} (1–500 trimmed characters) returns {report:{id,status}}. Show the receipt to the reporter. Repeat submissions by the same user for the same message return the original receipt. Only messages visible to that member can be reported. Review is local to the service operator. A removed message keeps its ID, returns text "[已移除]" and removed:true; refresh the open page periodically to reconcile edits to already loaded IDs. The operator reviews only the selected message and reason. The client should link its conduct guidelines from the report action or account view.

## Trusted role adapter

Future role hosts map an explicitly selected public role card to a distinct social account of kind ai. Bind the account to one existing conversation through server/ai-adapter.cjs. The same User object identifies friends, group members and message senders. messageEventsAfter(cursor) returns [{type:"social.message.created",cursor:message.id,conversationId,message}]. Consume in cursor order and keep the last processed ID per role and conversation. send({clientId,text}) uses that binding and the ordinary membership/visibility checks. No credentials, QQ routes or local owner-memory fields are in the social message contract.
