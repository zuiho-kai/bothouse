package qq

import (
	"log/slog"
	"strconv"
	"time"
)

// historyPageSize is how many messages one history request asks for.
//
// Source: NapCat 4.18.42 contract probes return count messages per page and
// include the anchor in adjacent pages. Retain the existing 20-message page
// size; pullOneChat determines the number of pages needed.
const historyPageSize = 20

// historyMaxPages bounds how many history pages one catch-up pull may request.
//
// Source: measured pages contain 20 messages with one inclusive anchor overlap;
// 32 pages cover 609 distinct messages, over three times the 197-message history
// observed in the contract probe. This is a request budget, not a retention
// guarantee: hitting it leaves the batch incomplete and preserves the watermark.
const historyMaxPages = 32

// catchUpChat is one conversation to pull after a reconnect.
type catchUpChat struct {
	key     string // "g:<group>" or "u:<user>", same shape as the watermark key
	sinceTS int64  // newest message time already handled (unix seconds)
}

// pullCatchUpHistory asks NapCat for what arrived while no WebSocket receiver
// was attached, for every chat this bridge has handled before.
//
// This is the path the reviews kept pointing at: the reconnect only re-attaches
// the socket, and anything NapCat received while the bridge was down was simply
// not delivered to us. Replaying from our own watermark upwards is the only way
// to recover it.
//
// History availability still depends on the server's retention and permissions.
func (p *Platform) pullCatchUpHistory() {
	if p.watermark == nil {
		return
	}
	chats := p.watermark.chats()
	if len(chats) == 0 {
		// Nothing handled before, so there is no "since" to ask from; guessing
		// one would replay history the bridge never had a reason to process.
		slog.Debug("qq: no watermark yet, skipping history pull")
		return
	}
	for _, c := range chats {
		p.pullOneChat(c)
	}
}

// pullOneChat pulls and replays the history of a single conversation.
//
// It pages backwards until it has crossed the boundary this bridge cares
// about, following the contract measured against the real NapCat on
// NapCat 4.18.42:
//
//   - message_seq:0 answers the newest page and ignores reverseOrder;
//   - message_seq:<a message's own message_seq> is inclusive, and
//     reverseOrder:true walks older from it;
//   - the anchor must be a message_seq; a real_seq answers 1200 消息N不存在.
//
// A single request only ever recovered the newest page, which on the measured
// group is about 14 minutes — shorter than the 2280 s reconnect window, so a
// long outage lost everything older than that.
func (p *Platform) pullOneChat(c catchUpChat) {
	action := historyAction(c.key)
	if action == "" {
		return
	}

	// Stop paging once a page reaches back past this instant: older messages
	// were either already handled (watermark floor) or arrived while the
	// bridge was still connected (the measured outage start). Both are unix
	// seconds, the same precision as message time.
	boundary := c.sinceTS
	if from := p.catchUpFrom.Load(); from != 0 {
		if ts := time.Unix(0, from).Unix(); ts > boundary {
			boundary = ts
		}
	}

	// fetched holds one entry per page, newest page first; complete says the walk
	// stopped for a reason that proves nothing older is left to fetch.
	var (
		fetched    [][]map[string]any
		seenID     = make(map[string]struct{})
		usedAnchor = make(map[int64]struct{})
		complete   bool
		stopNote   string
	)
	anchor, reverse := int64(0), false

	for page := 1; ; page++ {
		if page > historyMaxPages {
			stopNote = "page limit"
			slog.Warn("qq: history paging stopped at the page limit",
				"chat", c.key, "pages", historyMaxPages)
			break
		}
		resp, err := p.callAPI(action, historyParams(c, anchor, reverse))
		if err != nil {
			// Loud but not fatal: a NapCat that refuses history must not break
			// the live connection that already works. The batch is left marked
			// incomplete so the watermark cannot cover what was not replayed.
			stopNote = "request failed"
			slog.Warn("qq: history pull failed", "chat", c.key, "action", action, "page", page, "error", err)
			break
		}
		items := historyItems(resp)
		if len(items) == 0 {
			// Nothing older exists: the walk is complete (a short page is the
			// cheaper form of the same answer).
			complete = true
			break
		}

		// The measured response is oldest-first (real_seq order) even when
		// paging backwards, so the first item is the page's oldest and its
		// message_seq is the next anchor.
		oldest := historyTime(items[0])
		nextAnchor := historySeq(items[0])

		kept := keepUnseen(seenID, items)
		if len(kept) > 0 {
			fetched = append(fetched, kept)
		}

		// Stop once this page is *strictly* older than the boundary. It must be
		// strict: paging walks backwards, so a page whose oldest second equals
		// the boundary may still have older siblings in that same second, and
		// `<=` would drop them without ever asking.
		if boundary > 0 && oldest < boundary {
			complete = true
			break
		}
		if len(items) < historyPageSize {
			// Short page: NapCat has nothing older, so the walk is complete even
			// though it stopped before the boundary.
			complete = true
			break
		}
		if nextAnchor == 0 {
			stopNote = "page has no message_seq anchor"
			break
		}
		if _, again := usedAnchor[nextAnchor]; again {
			// The anchor did not move older: another request would just repeat
			// this page (a server ignoring the anchor). Not complete — nothing
			// proves the older pages do not exist.
			stopNote = "anchor did not advance"
			break
		}
		usedAnchor[nextAnchor] = struct{}{}
		anchor, reverse = nextAnchor, true
	}

	// handleMessage records a durable watermark before dispatch. Replaying the
	// newest pages and rewinding afterwards would expose that advanced floor
	// to a crash or a concurrent save, losing the missing older pages forever.
	// Only a complete walk may start replay; failure leaves this batch untouched
	// so a subsequent pull can retry from the existing watermark.
	if !complete {
		slog.Warn("qq: incomplete history batch deferred", "chat", c.key,
			"pages", len(fetched), "stop", stopNote)
		return
	}

	// Assemble oldest page first, keeping each page's own oldest-first order.
	// Paging collects newest page first, so sorting the whole batch by seconds
	// put a whole same-second block in reverse when it straddled two pages
	// instead of arrival order: page order is the only monotonic key available,
	// because message_seq is pseudo-random.
	pulled := make([]map[string]any, 0, len(seenID))
	for i := len(fetched) - 1; i >= 0; i-- {
		pulled = append(pulled, fetched[i]...)
	}
	if len(pulled) == 0 {
		return
	}

	replayed := 0
	for _, item := range pulled {
		// Identity, not just the time: two messages can share a second, and
		// the one handled before the disconnect must not swallow its sibling.
		if p.watermark != nil && p.watermark.seen(c.key, historyID(item), time.Unix(historyTime(item), 0)) {
			continue
		}
		p.handleMessage(item)
		replayed++
	}
	if replayed > 0 {
		slog.Info("qq: replayed messages pulled from history", "chat", c.key, "count", replayed,
			"complete", complete, "stop", stopNote)
	}
}

// keepUnseen drops the messages this batch already collected, and records the new
// ids in seen. The next page repeats one message as its paging anchor, so without
// this the batch would carry that message twice, even if handleMessage's own
// dedupe eventually hides the duplicate dispatch.
func keepUnseen(seen map[string]struct{}, items []map[string]any) []map[string]any {
	kept := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if id := historyID(item); id != "" {
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
		}
		kept = append(kept, item)
	}
	return kept
}

// historyAction maps a chat key to the OneBot action that reads its history.
func historyAction(key string) string {
	if len(key) < 3 {
		return ""
	}
	switch key[:1] {
	case "g":
		return "get_group_msg_history"
	case "u":
		return "get_friend_msg_history"
	}
	return ""
}

// historyParams builds one history request. anchor is the message_seq to page
// from (0 asks for the newest page); reverse asks for the messages older than
// the anchor. On message_seq:0, reverseOrder is a no-op (measured).
func historyParams(c catchUpChat, anchor int64, reverse bool) map[string]any {
	idField := "user_id"
	if c.key[:1] == "g" {
		idField = "group_id"
	}
	return map[string]any{
		idField:        c.key[2:],
		"count":        historyPageSize,
		"reverseOrder": reverse,
		"message_seq":  anchor,
	}
}

// historyItems extracts the message list from a history response. Missing or
// unexpected shapes yield nil rather than an error: the contract is unverified,
// so the caller must treat "nothing usable" as normal.
//
// resp is what callAPI returns, and callAPI has already unwrapped the OneBot
// envelope (`{status,retcode,echo,data:{...}}`) and handed back the inner data
// map, so `messages` sits at the top level here. Looking for resp["data"]
// again matched nothing and made every pull silently return zero messages
// (found in review of a later increment).
func historyItems(resp map[string]any) []map[string]any {
	// No fallback to resp["data"]: callAPI always hands back the inner data
	// map, so a second unwrap here can only hide a shape change behind a
	// silent empty pull.
	raw, ok := resp["messages"].([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, r := range raw {
		if m, ok := r.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// historyID reads the message id a history item carries, in the same string
// form handleMessage uses for its own dedupe keys.
func historyID(item map[string]any) string {
	switch v := item["message_id"].(type) {
	case float64:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case int:
		return strconv.Itoa(v)
	case string:
		return v
	}
	return ""
}

// historySeq reads the message_seq a history item carries: the only field
// NapCat accepts as a paging anchor. real_seq is a small monotonic number but
// answers 1200 消息N不存在, and the two must not be mixed up (measured).
func historySeq(item map[string]any) int64 {
	switch v := item["message_seq"].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	case string:
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0
		}
		return n
	}
	return 0
}

// historyTime reads the message timestamp a history item carries.
func historyTime(item map[string]any) int64 {
	switch ts := item["time"].(type) {
	case float64:
		return int64(ts)
	case int64:
		return ts
	case int:
		return int64(ts)
	}
	return 0
}
