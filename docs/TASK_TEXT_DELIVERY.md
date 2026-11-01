# Task-bound text delivery

Issue #749 adds durable delivery for explicit task-bound result, receipt and
question text. It stores the text and fragment plan in the existing private
PublicProgress journal (0600). It does not rerun an agent to recover a send.

## Use

Use the current task revision from `bothouse task show`:

~~~sh
bothouse send --project worker --session discord:CHANNEL +  --task TASK_ID --revision 1 --delivery-id stable-result-id +  --text-kind result --message 'The result text'
~~~

This returns HTTP 202 and a delivery record in state `pending`. It means the
request was persisted, not that the platform accepted it or a human read it.
Reuse the same delivery ID only for the same task/revision/target/kind/text.
A conflicting retry is rejected. Media, mentions, working-directory switches
and DM discovery cannot be combined with this text-only operation.

The local API accepts the normal `POST /send` envelope plus
`task_text: {task_id, revision, delivery_id, kind}`. The normal `message` and
`session_key` fields supply its text and explicit destination.

`task show` and `task list` expose `text_deliveries` metadata, including each
part's state and message ID, even without a platform task card. They exclude
the text. The body hash references the private journal's stored fragment plan;
it is not a public download URL.

For manual reconciliation use the existing local API socket with `POST
/task-text` and fields `Project`, `TaskID`, `DeliveryID`, `Action`,
`Evidence`. `list` reads metadata; `sent` records a confirmed message ID;
`not-accepted` permits retry only after an operator has confirmed absence;
`cancel` explicitly skips remaining unsent parts. Mutation requires nonempty
evidence. Evidence is public metadata: use a receipt ID or safe reference,
never private text or credentials. The local socket has the same trust boundary
as the existing send/task APIs; this does not add a remote unauthenticated API.

## Delivery ownership matrix

| Exit | Authority / retry owner | #749 behavior |
| --- | --- | --- |
| PublicProgress cards and public facts | Existing task journal / card publisher | Remains separate; no text delivery is created by Flush |
| Workspace handback (#625) | Proposed team report journal / handback recovery | PR #625 was unmerged at implementation; #749 never consumes its records |
| Verification of handback (#797 / board #46) | Existing team review state | Acceptance is separate from transport receipt |
| Explicit task-bound Send | Existing task journal, TextDeliveries / same progress tick | One owner, saved fragment plan, per-part receipts |
| Ordinary chat and unbound Send | Existing engine/platform path | Not silently enrolled |
| Native DSH/collab output | Native hub message store / native execution | No bridge text queue enrollment; cloud-web adapter is a separate route |
| Voice / #593 | Existing voice mechanism | Not enrolled |

## Receipt capability matrix

| Platform | Success evidence | Fragment plan | Ambiguous failure |
| --- | --- | --- | --- |
| Discord | Create-message response ID | Existing code-fence-aware splitter and limit | unknown; SDK automatic retries disabled |
| QQ / OneBot | send_group_msg or send_private_msg message_id | One message | unknown on websocket write/ACK failure; disconnected before write is pending |
| Feishu | Create-message response ID; stable UUID in request | One message | unknown on transport failure; explicit rate limit is pending; token refresh only after explicit rejection |
| DSH / household via cloud-web | Existing ref_id / preview_ack carrying posted row ID | One reply frame | unknown when ACK unavailable; disconnected before write is pending |
| Native DSH | Native hub owns the message | Native boundary | Not represented as a bridge receipt |

Stable keys do not imply permanent exactly-once delivery. Discord/OneBot have
no safe lookup by this delivery ID in the current adapters. Feishu UUID has a
platform-defined deduplication window, not an unbounded lookup API. A cloud-web
reply ref_id correlates an ACK; it is not the preview card's deduplication key.
These paths stop at unknown rather than replaying after an uncertain interval.

## Recovery and ordering

The append order in each task journal plus persisted target is the sequence
key. A pending, unknown or permanently failed predecessor blocks later text to
that target; an explicit cancellation leaves evidence and allows continuation.
Other tasks have independent workers. No new retry interval is introduced:
the existing PublicProgress tick drives known-unaccepted retries.

Each fragment is persisted as sending before the platform call. After restart,
an unfinished sending fragment becomes unknown. Confirmed sent fragments are
never replayed. A checkpoint failure after an ACK retains the receipt in memory;
if the process exits first, the old sending checkpoint recovers as unknown.

Cancellation, revision replacement and answered questions prevent pending
parts from starting. In-flight or unknown parts remain visible as possible
external side effects. A failed task state caused solely by restart does not
mean an unanswered question was answered.

The project that owns the journal remains the sending role across model swaps
and workspace release. The persisted destination is reconstructed directly;
current workspace ownership does not redirect it. The optional #751 check
runs at admission and before each actual part; a definitive denial cancels
unsent parts, while a temporary check error leaves them pending. #751 owns
binding and checking its authorization decision IDs.

## Validation boundaries

Core fault fixtures cover pre-send refusal, lost ACK, persistence failure,
in-flight restart, duplicate ID, ordering, parallel tasks, partial delivery,
revision changes, answered questions and in-flight cancellation. Adapter fixtures
exercise real request/response code against local protocol fakes.

Tests and local fixtures are not production deployment or human acceptance.
Real Discord/QQ/Feishu/DSH entry verification remains a separately recorded
post-deployment step; this implementation task does not deploy or restart.
