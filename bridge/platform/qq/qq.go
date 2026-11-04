package qq

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

func init() {
	core.RegisterPlatform("qq", New)
}

// Platform connects to a OneBot v11 implementation (NapCat, LLOneBot, etc.)
// via forward WebSocket. It receives message events and sends messages back
// through the same WS connection.
type Platform struct {
	wsURL     string // e.g. "ws://127.0.0.1:3001"
	token     string // optional access_token
	allowFrom string // comma-separated user IDs or "*"
	// allowGroupsWith: comma-separated user IDs; a group message from anyone
	// passes when one of them is in that group (option allow_groups_with).
	// Private chats still follow allowFrom only.
	allowGroupsWith  []string
	groupAnchorCache sync.Map // groupID -> groupAnchorEntry
	groupHistory     sync.Map // groupID -> *groupLog: recent lines, so a turn sees what the group was saying
	// saveImagesDir: when set (option save_images_dir), every received image is also
	// written there and the path is added to this turn only.
	saveImagesDir         string
	splitReplyBubbles     bool
	commandAllowFrom      string // optional separate sender list for slash-prefixed input
	shareSessionInChannel bool
	project               string // this bot's project name (opts["cc_project"]), named in outbound receipts
	handler               core.MessageHandler
	conn                  *websocket.Conn
	mu                    sync.Mutex
	echoSeq               atomic.Int64
	echoCh                sync.Map // echo -> chan json.RawMessage
	cancel                context.CancelFunc
	selfID                int64
	dedup                 core.MessageDedup
	groupNameCache        sync.Map // groupID -> group name
	groupNamePending      sync.Map // groupID -> struct{}: a lookup is already running
	httpURL               string   // OneBot HTTP API URL, e.g. "http://127.0.0.1:3000"

	// quoteCache holds recent messages by OneBot message ID. A reply segment
	// carries only that ID, so without this the model sees "继续" with no idea
	// what it continues (core.Message.ExtraContent).
	quoteCache sync.Map // message ID string -> quoteEntry

	nickname string // login nickname, for "@名字" of a teammate (team mode)

	// connectedAt is when the current WS connection was established (Unix
	// nano; 0 before the first connect). It bounds catch-up handling below:
	// a replayed event may only be trusted right after a connect.
	connectedAt atomic.Int64

	// outageStart is when the current, still-ongoing outage began (Unix nano;
	// 0 while connected). It is written once per continuous outage: a failed
	// reconnect round that returns to readLoop must not move the start
	// forward, or the early part of a long outage falls outside the boundary.
	// (review found the disconnect instant being overwritten.)
	outageStart atomic.Int64

	// catchUpFrom is the start of the last completed outage (Unix nano; 0
	// when no outage has completed yet). Anything older than it had its
	// chance while the bridge was still connected, so it is stale even when
	// it is newer than this process. (review: the
	// entry point bypassed the measured boundary.)
	catchUpFrom atomic.Int64

	// watermark remembers the newest handled message per chat across restarts.
	// nil when no data dir is configured, which leaves the guards in-memory.
	watermark *recvWatermark

	// catchUp remembers message IDs handled as a reconnect replay, so the
	// same event pushed again after another reconnect is not answered twice.
	// The ordinary dedup TTL (core dedupTTL, 60s) is far shorter than a
	// reconnect gap, so it cannot cover this.
	catchUp catchUpSeen

	// now reads the current time; tests overwrite it to make the catch-up
	// windows deterministic. nil means time.Now.
	now func() time.Time
}

// teamPlatforms: QQ number → *Platform for every QQ bot in this process, so a
// bot can tell "@另一个机器人" from "@我" (core.Message.AddressedOther). Same
// registry platform/discord keeps for its teammates.
var teamPlatforms sync.Map

// quoteEntry is one message kept for reply quoting.
type quoteEntry struct {
	content string
	name    string // who wrote it; the quote must not read as the quoting person's words
	self    bool   // this bot sent it, so a reply to it calls the bot
	at      time.Time
}

// quoteCacheTTL bounds quoteCache. Source: 沿用 platform/qqbot messageCacheTTL,
// the same "a quote this old is not worth resolving" bound the official adapter
// uses.
const quoteCacheTTL = 7 * 24 * time.Hour

// quoteCacheMaxItems bounds quoteCache. Source: 沿用 platform/qqbot
// messageCacheMaxItems, so an always-on group cannot grow this map for a week.
const quoteCacheMaxItems = 1000

// quotedTextMaxRunes bounds one cached quote. Source: 沿用 platform/qqbot
// quotedTextMaxRunes, the same "a quote is context, not a transcript" bound.
const quotedTextMaxRunes = 800

// bareMentionPlaceholder starts a turn when a person @-ed the bot without
// saying anything. Describe the event without prescribing a persona response.
const bareMentionPlaceholder = "（对方只 @ 了你一下，没说别的）"

// forwardOnlyPlaceholder is the turn text when someone sends only a merged
// forward: the event itself, so the forwarded lines stay in ExtraContent and
// are never read as this sender's words.
const forwardOnlyPlaceholder = "（对方转发了一段聊天记录，没说别的）"

// Outbound receipt log messages (Issue #842): one per send, so a receipt can be
// matched to the inbound message_id and the message_id NapCat returned.
const (
	outboundReceiptMessage       = "qq: outbound message"
	outboundReceiptFailedMessage = "qq: outbound message failed"
)

func New(opts map[string]any) (core.Platform, error) {
	wsURL, _ := opts["ws_url"].(string)
	if wsURL == "" {
		wsURL = "ws://127.0.0.1:3001"
	}
	token, _ := opts["token"].(string)
	allowFrom, _ := opts["allow_from"].(string)
	var allowGroupsWith []string
	if raw, _ := opts["allow_groups_with"].(string); raw != "" {
		for _, id := range strings.Split(raw, ",") {
			if id = strings.TrimSpace(id); id != "" {
				allowGroupsWith = append(allowGroupsWith, id)
			}
		}
	}
	commandAllowFrom, _ := opts["command_allow_from"].(string)
	shareSessionInChannel, _ := opts["share_session_in_channel"].(bool)
	project, _ := opts["cc_project"].(string)
	saveImagesDir, _ := opts["save_images_dir"].(string)
	splitReplyBubbles, _ := opts["split_bubbles"].(bool)

	core.CheckAllowFrom("qq", allowFrom)

	httpURL, _ := opts["http_url"].(string)
	httpURL = strings.TrimRight(httpURL, "/")

	// 落盘位置沿用同仓库 platform/weixin 的做法：cc_data_dir/<平台>/<项目>/。
	// 会话键水位之外不引入新的目录约定。
	//
	// cc_data_dir 由 cmd/cc-connect 在创建每个平台时无条件注入
	// （main.go: opts["cc_data_dir"] = cfg.DataDir），且 config 在 data_dir
	// 为空时会填默认值，所以生产上这里不会是空串 —— 水位确实落盘。opts 里缺
	// 键只会出现在直接构造 Platform 的测试中，那时退化为内存水位。
	var watermarkPath string
	if dataDir, _ := opts["cc_data_dir"].(string); dataDir != "" {
		project, _ := opts["cc_project"].(string)
		if project == "" {
			project = "default"
		}
		watermarkPath = filepath.Join(dataDir, "qq", watermarkPathSegment(project), "recv-watermark.json")
	}

	return &Platform{
		watermark:             newRecvWatermark(watermarkPath),
		wsURL:                 wsURL,
		token:                 token,
		allowFrom:             allowFrom,
		allowGroupsWith:       allowGroupsWith,
		commandAllowFrom:      commandAllowFrom,
		saveImagesDir:         saveImagesDir,
		splitReplyBubbles:     splitReplyBubbles,
		shareSessionInChannel: shareSessionInChannel,
		project:               project,
		httpURL:               httpURL,
	}, nil
}

func (p *Platform) Name() string { return "qq" }

func (p *Platform) Start(handler core.MessageHandler) error {
	p.handler = handler

	header := http.Header{}
	if p.token != "" {
		header.Set("Authorization", "Bearer "+p.token)
	}

	conn, _, err := websocket.DefaultDialer.Dial(p.wsURL, header)
	if err != nil {
		return fmt.Errorf("qq: ws connect failed (%s): %w", p.wsURL, err)
	}
	p.conn = conn
	p.connectedAt.Store(p.clock().UnixNano())

	slog.Info("qq: connected to OneBot", "url", p.wsURL)

	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel

	// Start readLoop BEFORE callAPI: callAPI's response is routed by readLoop,
	// so calling it first would always time out after 15s and leave selfID=0,
	// which disables the self-message filter in handleMessage and lets the bot
	// respond to its own messages.
	go p.readLoop(ctx)

	// Get bot self info
	if info, err := p.callAPI("get_login_info", nil); err == nil {
		if uid := jsonInt64(info, "user_id"); uid != 0 {
			p.selfID = uid
		}
		nick, _ := info["nickname"].(string)
		p.nickname = nick
		if p.selfID != 0 {
			teamPlatforms.Store(p.selfID, p) // lets addressedOther find teammates
		}
		slog.Info("qq: logged in", "qq", p.selfID, "nickname", nick)
	} else {
		slog.Warn("qq: get_login_info failed; self-message filter disabled until next reconnect", "error", err)
	}

	return nil
}

func (p *Platform) readLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_, raw, err := p.conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("qq: ws read error, reconnecting...", "error", err)
			// Record when the socket died, but only the first failure of a
			// continuous outage: after a failed reconnect round readLoop reads
			// the same dead socket again and would otherwise push the start
			// forward, hiding the early part of the outage.
			p.markDisconnected()
			p.reconnect()
			continue
		}

		var payload map[string]any
		if json.Unmarshal(raw, &payload) != nil {
			continue
		}

		// If this is an API response (has "echo" field), route to caller
		if echo, ok := payload["echo"].(string); ok {
			if ch, loaded := p.echoCh.LoadAndDelete(echo); loaded {
				if dataCh, ok := ch.(chan json.RawMessage); ok {
					dataCh <- raw
				}
			}
			continue
		}

		// Otherwise it's an event
		postType, _ := payload["post_type"].(string)
		if postType == "message" {
			// Dispatch in its own goroutine: callAPI resolves responses through
			// this loop, so running the handler here would make every send from
			// a turn wait for that turn to finish (same as platform/wecom).
			go p.handleMessage(payload)
		}
	}
}

func (p *Platform) reconnect() {
	for i := 1; i <= 30; i++ {
		time.Sleep(time.Duration(i) * 2 * time.Second)
		header := http.Header{}
		if p.token != "" {
			header.Set("Authorization", "Bearer "+p.token)
		}
		conn, _, err := websocket.DefaultDialer.Dial(p.wsURL, header)
		if err != nil {
			slog.Warn("qq: reconnect attempt failed", "attempt", i, "error", err)
			continue
		}
		p.mu.Lock()
		p.conn = conn
		p.mu.Unlock()
		p.connectedAt.Store(p.clock().UnixNano())
		// Real recovery: the outage that just ended becomes the catch-up
		// boundary for the backlog NapCat buffered meanwhile, and the next
		// outage will start a fresh one.
		if start := p.outageStart.Swap(0); start != 0 {
			p.catchUpFrom.Store(start)
			// Re-attaching the socket does not recover what NapCat received
			// while nobody was listening; ask for it explicitly, once per
			// recovery, in the background so the read loop is not blocked.
			go p.pullCatchUpHistory()
		}
		slog.Info("qq: reconnected")
		return
	}
	slog.Error("qq: failed to reconnect after 30 attempts")
}

// NapCat pushes events to this WebSocket only while a client is attached, so a
// message it received while the bridge was away is lost unless NapCat replays
// it after the reconnect — and a replay carries a time older than this process,
// which the plain IsOldMessage cut-off throws away. The constants below widen
// that cut-off just enough to accept a replay, and bound how long one replayed
// message_id stays deduped.
const (
	// reconnect() 的重试契约：30 次，第 i 次前 sleep i*2 秒。
	qqReconnectAttempts = 30
	qqReconnectStep     = 2 * time.Second

	// 一次失败的 Dial 最长占用 websocket.DefaultDialer 的握手超时；本包未
	// 改写它，gorilla/websocket 的默认值是 45 秒。
	qqDialTimeout = 45 * time.Second
)

// qqCatchUpWindow is how old a replayed message may be: one full reconnect
// budget — every backoff sleep (2*(1+…+30) = 930s) plus one Dial timeout per
// attempt (30 × 45s) = 2280s — because a message received while the bridge was
// away can only reach us after the last attempt succeeds. 这是上界，典型断线
// 是秒级；不另取没有契约依据的时限。
var qqCatchUpWindow = qqReconnectStep*time.Duration(qqReconnectAttempts*(qqReconnectAttempts+1)/2) +
	time.Duration(qqReconnectAttempts)*qqDialTimeout

// catchUpSeen tracks message IDs handled from a reconnect replay, with a TTL of
// one full reconnect cycle (qqCatchUpWindow, far longer than core.MessageDedup's
// 60s): a batch replayed by the next reconnect is not answered twice, while the
// entry still expires instead of blocking the id forever.
type catchUpSeen struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

// seenBefore reports whether id was already handled as a replay, recording it
// on the first call. now comes from the platform clock so the TTL is measured
// on the same source as the catch-up windows (tests inject it).
func (c *catchUpSeen) seenBefore(id string, now time.Time) bool {
	if id == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen == nil {
		c.seen = make(map[string]time.Time)
	}
	for k, t := range c.seen {
		if now.Sub(t) > qqCatchUpWindow {
			delete(c.seen, k)
		}
	}
	if _, ok := c.seen[id]; ok {
		return true
	}
	c.seen[id] = now
	return false
}

// clock is the platform's time source; tests replace it through now.
func (p *Platform) clock() time.Time {
	if p.now != nil {
		return p.now()
	}
	return time.Now()
}

// markDisconnected records the start of an outage, once per continuous one.
// Called from readLoop for every read error, including the reads that fail on
// the same dead socket after a reconnect round gave up; only the first call
// wins, so a long outage keeps the instant it actually began.
func (p *Platform) markDisconnected() {
	// Truncated to the second on purpose: OneBot reports a message time as
	// whole seconds (time.Unix(int64(ts), 0) below), so a nanosecond-precision
	// boundary would reject a message that merely shares the disconnect's
	// second — the message looks older than the boundary only because its own
	// sub-second part was rounded away. Same precision on both sides of the
	// comparison, and the wider side is the safe one here: admitting a message
	// from that second cannot resurrect anything older.
	start := p.clock().Truncate(time.Second).UnixNano()
	if p.outageStart.Load() == 0 {
		p.outageStart.CompareAndSwap(0, start)
	}
}

// acceptsCatchUp reports whether a message is still worth handling. Two
// different stale sources, checked in this order:
//
//  1. Older than the last completed outage started: it had its chance while
//     this bridge was still connected, so it is stale however old the process
//     is. This is the measured boundary, and it applies to every message, not
//     only to the ones older than the process start.
//  2. Older than the process start with no outage completed yet: a fresh
//     process cannot measure a boundary, so fall back to one reconnect budget
//     (qqCatchUpWindow) and treat it as a documented guess.
func (p *Platform) acceptsCatchUp(msgTime time.Time) bool {
	if p.connectedAt.Load() == 0 {
		return false
	}
	if from := p.catchUpFrom.Load(); from != 0 {
		// A measured boundary decides on its own: adding the process-age
		// window on top would drop a message buffered early in a long outage,
		// which is exactly what the boundary is there to admit.
		return !msgTime.Before(time.Unix(0, from))
	}
	if core.IsOldMessage(msgTime) {
		return p.clock().Sub(msgTime) <= qqCatchUpWindow
	}
	return true
}

func (p *Platform) handleMessage(payload map[string]any) {
	msgType, _ := payload["message_type"].(string)
	userID := jsonInt64(payload, "user_id")
	groupID := jsonInt64(payload, "group_id")
	messageID := jsonInt64(payload, "message_id")

	if userID == p.selfID {
		return
	}

	msgIDStr := strconv.FormatInt(messageID, 10)

	// chatKey identifies the conversation the way a person would: one group is
	// one chat, one private partner is one chat. Deliberately not the session
	// key, which share_session_in_channel can rename.
	chatKey := fmt.Sprintf("u:%d", userID)
	if msgType == "group" {
		chatKey = fmt.Sprintf("g:%d", groupID)
	}

	if ts, ok := payload["time"].(float64); ok && ts > 0 {
		msgTime := time.Unix(int64(ts), 0)
		// Durable guard first: a message this process never saw but a previous
		// run already handled is caught here, which no in-memory set can do.
		if p.watermark != nil && p.watermark.seen(chatKey, msgIDStr, msgTime) {
			slog.Debug("qq: message already handled before restart",
				"message_id", messageID, "chat", chatKey)
			return
		}
		// The stale check runs for every message, not only for the ones older
		// than the process: a backlog received after the process started but
		// before the disconnect is just as stale, and used to skip this gate
		// entirely. (review.)
		if !p.acceptsCatchUp(msgTime) {
			slog.Debug("qq: ignoring stale message", "time", int64(ts),
				"old_for_process", core.IsOldMessage(msgTime))
			return
		}
		if core.IsOldMessage(msgTime) {
			slog.Info("qq: handling message replayed after reconnect",
				"message_id", messageID, "age_s", int(p.clock().Sub(msgTime).Seconds()))
		}
	}

	// Dedupe every message on the reconnect-cycle TTL, not only the ones that
	// look old. A message handled live comes back as a replay after the next
	// disconnect; core.MessageDedup expires after 60s, which is shorter than a
	// reconnect gap, so the replay reached the engine a second time. Review of the
	// review P1 (运行中重放跨短期去重后仍重复进入).
	if messageID != 0 && p.catchUp.seenBefore(msgIDStr, p.clock()) {
		slog.Debug("qq: duplicate message ignored", "message_id", messageID)
		return
	}
	if p.dedup.IsDuplicate(msgIDStr) {
		slog.Debug("qq: duplicate message ignored", "message_id", messageID)
		return
	}

	if !p.isAllowed(userID) && !(msgType == "group" && p.groupHasAnchor(groupID)) {
		return
	}

	// Extract sender info
	var userName string
	if sender, ok := payload["sender"].(map[string]any); ok {
		card, _ := sender["card"].(string)
		nick, _ := sender["nickname"].(string)
		if card != "" {
			userName = card
		} else {
			userName = nick
		}
	}

	// Parse message content from CQ message array or raw_message
	parsed := p.parseMessage(payload, msgType, groupID)
	// A merged forward is other people's old messages: it goes to the model as
	// labelled material (ExtraContent below), never as the sender's own words.
	forwarded, fwdImages := p.expandForwards(parsed.forwards)
	parsed.images = append(parsed.images, fwdImages...)

	// A slash-prefixed message is a command, and command_allow_from decides who
	// may submit one. This runs before core gets the message, so built-in
	// commands, custom commands, skills and unknown commands forwarded to an
	// agent all follow one policy; core would otherwise hand an unknown command
	// straight to the agent. Ordinary chat is unaffected: allow_from still
	// decides who is admitted at all.
	if strings.HasPrefix(strings.TrimSpace(parsed.text), "/") &&
		!core.AllowList(p.commandAllowFrom, strconv.FormatInt(userID, 10)) {
		return
	}

	// A reply to one of this bot's messages calls the bot just like an @ does
	// (core/gate_local.go: "an @, a reply to it"). Everyone else's message is
	// context only.
	mentioned := parsed.mentioned
	var quoted []string
	if id := parsed.replyTo; id != "" {
		if entry, ok := p.loadQuote(id); ok {
			// Keep the quoted speaker's name: a bare quote read as the quoting
			// person's words is the same mix-up as an unlabelled chat line.
			line := entry.content
			if entry.name != "" {
				line = entry.name + "：" + line
			}
			quoted = append(quoted, line)
			mentioned = mentioned || entry.self
		}
	}

	// A bare @ or quote of the bot still calls it. Resolve quotes first so
	// these messages are not mistaken for empty input.
	content := parsed.text
	saved := p.saveImages(messageID, parsed.images)
	previews := parsed.images[:0]
	for _, img := range parsed.images {
		img.Data, img.MimeType = shrinkImage(img.Data, img.MimeType)
		if len(img.Data) == 0 {
			content = strings.TrimSpace(content + "\n[图片过大且无法生成安全预览]")
			continue
		}
		previews = append(previews, img)
	}
	parsed.images = previews
	if content == "" && forwarded != "" {
		content = forwardOnlyPlaceholder
	}
	if content == "" && len(parsed.images) == 0 && len(parsed.files) == 0 && parsed.audio == nil && !mentioned {
		return
	}
	if content == "" && len(parsed.images) == 0 && len(parsed.files) == 0 && parsed.audio == nil {
		content = bareMentionPlaceholder
	}

	// Store the person's own words, not the bare-@ placeholder: a later reply to
	// a poke should not quote the placeholder back as if they had said it.
	p.storeQuote(strconv.FormatInt(messageID, 10), parsed.text, userName, false)

	var sessionKey string
	if msgType == "group" {
		if p.shareSessionInChannel {
			sessionKey = fmt.Sprintf("qq:g:%d", groupID)
		} else {
			sessionKey = fmt.Sprintf("qq:%d:%d", groupID, userID)
		}
	} else {
		sessionKey = fmt.Sprintf("qq:%d", userID)
	}

	rctx := &replyContext{
		messageType: msgType,
		userID:      userID,
		groupID:     groupID,
		sessionKey:  sessionKey,
		inMessageID: strconv.FormatInt(messageID, 10),
	}

	// ChannelKey is the raw chat id; core adds the platform prefix when it
	// binds a workspace (core/engine.go effectiveChannelID).
	var channelKey, chatName string
	if msgType == "group" {
		channelKey = strconv.FormatInt(groupID, 10)
		// Cold cache returns the id and looks the name up in the background: the
		// round trip can take 15s and the name is cosmetic.
		chatName = p.cachedGroupName(groupID)
		p.warmGroupName(groupID)
	} else {
		channelKey = strconv.FormatInt(userID, 10)
	}

	// AddressedOther: an @ or a name at a line start pointed at a teammate bot,
	// so a no-gate lead leaves the message to that teammate (core/team.go
	// suppressUnaddressedGroup). Never true for a message that also calls this
	// bot: Mentioned already decides that case.
	addressedOther := !mentioned && (parsed.other || p.addressedOther(content))

	msg := &core.Message{
		SessionKey:     sessionKey,
		Platform:       "qq",
		MessageID:      strconv.FormatInt(messageID, 10),
		UserID:         strconv.FormatInt(userID, 10),
		UserName:       userName,
		ChatName:       chatName,
		ChannelKey:     channelKey,
		Content:        content,
		Images:         parsed.images,
		Files:          parsed.files,
		Audio:          parsed.audio,
		ReplyCtx:       rctx,
		Mentioned:      mentioned,
		AddressedOther: addressedOther,
		Direct:         msgType != "group",
		GroupChat:      msgType == "group",
	}
	if len(quoted) > 0 {
		msg.ExtraContent = "[引用消息]\n" + strings.Join(quoted, "\n")
	}
	if saved != "" {
		msg.ExtraContent = strings.TrimSpace(msg.ExtraContent + "\n" + saved)
	}
	if forwarded != "" {
		msg.ExtraContent = strings.TrimSpace(msg.ExtraContent + "\n\n" + forwarded)
	}
	if msgType == "group" {
		if recent := p.groupContext(groupID); recent != "" {
			// Background for this turn only: core keeps it out of the gate's silent buffer
			// (a buffered message must not repeat the chat it was written in).
			msg.AmbientChat = strings.TrimSpace(recent)
		}
		line := content
		if line == "" && len(parsed.images) > 0 {
			line = "[图片]"
		}
		p.noteGroupLine(groupID, userID, userName, line)
	}

	slog.Debug("qq: message received", "type", msgType, "user", userID, "text_len", len(content), "mentioned", mentioned)
	// Record before dispatch, not after: the handler only queues the turn, and
	// a crash mid-turn must not make the same message look unhandled next time.
	if p.watermark != nil {
		if ts, ok := payload["time"].(float64); ok && ts > 0 {
			p.watermark.observe(chatKey, msgIDStr, time.Unix(int64(ts), 0))
		}
	}
	p.handler(p, msg)
}

// parsedMessage is one OneBot message event, split into what core.Message needs.
type parsedMessage struct {
	text      string
	images    []core.ImageAttachment
	files     []core.FileAttachment
	audio     *core.AudioAttachment
	mentioned bool             // an "at" segment addressed this bot
	other     bool             // an "at" segment named a teammate bot, not this one
	replyTo   string           // message ID of the "reply" segment, empty when not a reply
	forwards  []map[string]any // "forward" segments (merged chat logs), expanded in handleMessage
}

func (p *Platform) parseMessage(payload map[string]any, msgType string, groupID int64) parsedMessage {
	var out parsedMessage
	var textParts []string

	// Normalize both OneBot wire formats before interpreting media or mentions.
	msg, ok := payload["message"].([]any)
	if !ok {
		raw, _ := payload["message"].(string)
		if raw == "" {
			raw, _ = payload["raw_message"].(string)
		}
		msg = parseCQString(raw)
	}
	for _, seg := range msg {
		s, ok := seg.(map[string]any)
		if !ok {
			continue
		}
		segType, _ := s["type"].(string)
		data, _ := s["data"].(map[string]any)
		if data == nil {
			continue
		}

		switch segType {
		case "text":
			if text, ok := data["text"].(string); ok {
				textParts = append(textParts, text)
			}
		case "image":
			if url, ok := data["url"].(string); ok && url != "" {
				imgData, mime, err := downloadFile(url)
				if err != nil {
					slog.Warn("qq: download image failed", "error", err)
					continue
				}
				out.images = append(out.images, core.ImageAttachment{
					MimeType: mime,
					Data:     imgData,
				})
			}
		case "record":
			if audio := p.fetchRecord(data); audio != nil {
				out.audio = audio
			}
		case "file":
			name, _ := data["name"].(string)
			if name == "" {
				name, _ = data["file"].(string)
			}
			fileID, _ := data["file_id"].(string)
			if fileID == "" {
				fileID, _ = data["file"].(string)
			}

			slog.Info("qq: file segment received", "name", name, "file_id", fileID,
				"has_url", data["url"] != nil, "msg_type", msgType, "group_id", groupID)

			var downloaded bool

			// Step 1: Try direct URL from message segment (with longer timeout for large files)
			if url, ok := data["url"].(string); ok && url != "" {
				fileData, mime, err := downloadLargeFile(url)
				if err != nil {
					slog.Warn("qq: [step1] download file via segment URL failed", "error", err)
				} else {
					out.files = append(out.files, core.FileAttachment{
						MimeType: mime,
						Data:     fileData,
						FileName: name,
					})
					downloaded = true
					slog.Info("qq: [step1] file downloaded via segment URL", "name", name, "size", len(fileData))
				}
			}

			// Step 2: Get fresh direct link via NapCat API (CDN URLs expire / have download limits)
			// NapCat docs: params are STRINGS — group (not group_id), file_id
			if !downloaded && p.httpURL != "" && fileID != "" {
				var freshURL string
				if msgType == "group" && groupID != 0 {
					groupStr := strconv.FormatInt(groupID, 10)
					slog.Info("qq: [step2] trying get_group_file_url", "file_id", fileID, "group", groupStr)
					result, err := p.callHTTPAPI("get_group_file_url", map[string]any{
						"file_id": fileID,
						"group":   groupStr,
					})
					if err == nil {
						freshURL, _ = result["url"].(string)
						slog.Info("qq: [step2] get_group_file_url returned", "has_url", freshURL != "")
					} else {
						slog.Warn("qq: [step2] get_group_file_url failed", "file_id", fileID, "error", err)
					}
				} else {
					slog.Info("qq: [step2] trying get_private_file_url", "file_id", fileID)
					result, err := p.callHTTPAPI("get_private_file_url", map[string]any{
						"file_id": fileID,
					})
					if err == nil {
						freshURL, _ = result["url"].(string)
					} else {
						slog.Warn("qq: [step2] get_private_file_url failed", "file_id", fileID, "error", err)
					}
				}
				if freshURL != "" {
					fileData, mime, err := downloadLargeFile(freshURL)
					if err == nil {
						out.files = append(out.files, core.FileAttachment{
							MimeType: mime,
							Data:     fileData,
							FileName: name,
						})
						downloaded = true
						slog.Info("qq: [step2] file downloaded via fresh URL", "name", name, "size", len(fileData))
					} else {
						slog.Warn("qq: [step2] download file via fresh URL failed", "error", err)
					}
				}
			}

			// Step 3: Last resort — get_file (downloads to NapCat local or returns base64)
			if !downloaded && p.httpURL != "" && fileID != "" {
				slog.Info("qq: [step3] trying get_file", "file_id", fileID)
				result, err := p.callHTTPAPI("get_file", map[string]any{"file_id": fileID})
				if err == nil {
					if fileURL, ok := result["url"].(string); ok && fileURL != "" {
						fileData, mime, err := downloadLargeFile(fileURL)
						if err == nil {
							out.files = append(out.files, core.FileAttachment{
								MimeType: mime,
								Data:     fileData,
								FileName: name,
							})
							downloaded = true
						}
					}
					if !downloaded {
						if b64Str, ok := result["base64"].(string); ok && b64Str != "" {
							if decoded, err := base64.StdEncoding.DecodeString(b64Str); err == nil {
								out.files = append(out.files, core.FileAttachment{
									MimeType: http.DetectContentType(decoded),
									Data:     decoded,
									FileName: name,
								})
								downloaded = true
							}
						}
					}
				} else {
					slog.Warn("qq: get_file API failed", "file_id", fileID, "error", err)
				}
			}

			if !downloaded {
				slog.Warn("qq: file segment could not be downloaded", "name", name)
			}
		case "at":
			// The bot's own @ is the call itself (Message.Mentioned), so it
			// must not reach the model as text. Someone else's stays in the
			// text: the model needs to know who was addressed.
			qq, _ := data["qq"].(string)
			if qq == strconv.FormatInt(p.selfID, 10) {
				out.mentioned = true
				continue
			}
			if p.isTeammate(qq) {
				out.other = true
			}
			// OneBot puts the separating space in the following text
			// segment ("[CQ:at,qq=2] 你看一下"), so none is added here.
			name, _ := data["name"].(string)
			if name == "" {
				name = p.teammateName(qq)
			}
			if name == "" {
				name = qq
			}
			textParts = append(textParts, "@"+name)
		case "forward":
			out.forwards = append(out.forwards, data)
		case "reply":
			out.replyTo, _ = data["id"].(string)
		}
	}

	out.text = strings.TrimSpace(strings.Join(textParts, ""))
	return out
}

// parseCQString normalizes CQ codes into the same segments as message_format=array.
// Split before unescaping so escaped literal CQ text is never treated as a code.
func parseCQString(raw string) []any {
	var segments []any
	for len(raw) > 0 {
		idx := strings.Index(raw, "[CQ:")
		if idx < 0 || !strings.Contains(raw[idx:], "]") {
			segments = append(segments, map[string]any{
				"type": "text", "data": map[string]any{"text": unescapeCQText(raw)},
			})
			break
		}
		if idx > 0 {
			segments = append(segments, map[string]any{
				"type": "text", "data": map[string]any{"text": unescapeCQText(raw[:idx])},
			})
		}
		raw = raw[idx+len("[CQ:"):]
		end := strings.IndexByte(raw, ']')
		fields := strings.Split(raw[:end], ",")
		segments = append(segments, map[string]any{
			"type": fields[0], "data": parseCQParams(fields[1:]),
		})
		raw = raw[end+1:]
	}
	return segments
}

// teammateName returns a teammate bot's nickname for a QQ number, or "" when the
// number is not a bot of this process. OneBot omits "name" on an at segment in
// some builds, and "@2002" reads worse to the model than "@小助手".
func (p *Platform) teammateName(qq string) string {
	v, ok := teamPlatforms.Load(qq)
	if !ok {
		return ""
	}
	tp, _ := v.(*Platform)
	if tp == nil || tp == p {
		return ""
	}
	return tp.nickname
}

// isTeammate reports whether a QQ number belongs to another bot of this process,
// so "@队友" can be told from "@我" and from "@一个普通人".
func (p *Platform) isTeammate(qq string) bool {
	if qq == "" {
		return false
	}
	v, ok := teamPlatforms.Load(qq)
	if !ok {
		return false
	}
	tp, _ := v.(*Platform)
	return tp != nil && tp != p
}

// addressedOther reports whether the text @-s or names (at a line start) another
// QQ bot of this process rather than this one, so a no-gate lead leaves the
// message to that teammate (core.Message.AddressedOther).
func (p *Platform) addressedOther(content string) bool {
	other := false
	teamPlatforms.Range(func(k, v any) bool {
		tp, _ := v.(*Platform)
		if tp == nil || tp == p || tp.nickname == "" {
			return true
		}
		if core.NameCalled(content, tp.nickname, p.teamBotNames()...) {
			other = true
			return false
		}
		return true
	})
	return other
}

// teamBotNames lists the nicknames of the other QQ bots in this process, so a
// line opening "龙娘、橘，…" is read as calling both.
func (p *Platform) teamBotNames() []string {
	var names []string
	teamPlatforms.Range(func(k, v any) bool {
		tp, _ := v.(*Platform)
		if tp != nil && tp != p && tp.nickname != "" {
			names = append(names, tp.nickname)
		}
		return true
	})
	return names
}

// parseCQParams reads the "key=value" parameters of one CQ code.
func parseCQParams(fields []string) map[string]any {
	params := make(map[string]any, len(fields))
	for _, f := range fields {
		k, v, ok := strings.Cut(f, "=")
		if !ok {
			continue
		}
		params[k] = cqParamUnescaper.Replace(v)
	}
	return params
}

// truncateRunes cuts s to max runes. Source: 沿用 platform/qqbot truncateRunes.
func truncateRunes(s string, max int) string {
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

// unescapeCQText decodes text escapes; commas are escaped only in parameters.
func unescapeCQText(s string) string {
	if !strings.Contains(s, "&") {
		return s
	}
	return cqUnescaper.Replace(s)
}

var cqUnescaper = strings.NewReplacer(
	"&#91;", "[",
	"&#93;", "]",
	"&amp;", "&",
)

var cqParamUnescaper = strings.NewReplacer(
	"&#91;", "[",
	"&#93;", "]",
	"&#44;", ",",
	"&amp;", "&",
)

// plainAtToCQ turns a plain "@123456" the model wrote into a real OneBot at
// segment, so the person is actually notified instead of seeing the text
// "@123456". Existing CQ codes are left alone.
//
// Same approach as two public OneBot bridges, which both hit this: Gu-Heping's
// openclaw-napcat-qq (src/util/cq-code.ts convertPlainAtToCq) and foggyww's
// qqbot-claude (src/adapter/onebot.ts normalizeOutgoingMessage). Both treat it
// as a safety net for the model writing "@id" instead of a CQ code, which is
// what raw text output looks like.
func plainAtToCQ(s string) string {
	if !strings.Contains(s, "@") {
		return s
	}
	return plainAtRe.ReplaceAllString(s, "${1}[CQ:at,qq=${2}]")
}

// plainAtRe matches "@123456" or "@all" that is not already inside a CQ code.
// 6-12 digits: 来源 沿用上述两个项目的 \d{6,12}, which is the range a QQ
// number has had for years.
var plainAtRe = regexp.MustCompile(`(^|[^\w\[\]])(?:@)(\d{6,12}|all)\b`)

// Reply sends a message as a reply to an incoming message.
func (p *Platform) Reply(ctx context.Context, replyCtx any, content string) error {
	return p.Send(ctx, replyCtx, content)
}

// Send sends a message to the conversation identified by replyCtx.
func (p *Platform) Send(ctx context.Context, replyCtx any, content string) error {
	// Optionally send blank-line separated paragraphs as individual messages.
	if parts := splitBubbles(content); p.splitReplyBubbles && len(parts) > 1 {
		for _, part := range parts {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := p.sendOne(ctx, replyCtx, part); err != nil {
				return err
			}
		}
		return nil
	}
	return p.sendOne(ctx, replyCtx, content)
}

// splitBubbles 按空行拆段；含代码块时不拆，避免把代码切碎。
func splitBubbles(content string) []string {
	if strings.Contains(content, "```") {
		return []string{content}
	}
	var out []string
	for _, seg := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n\n") {
		if seg = strings.TrimSpace(seg); seg != "" {
			out = append(out, seg)
		}
	}
	if len(out) == 0 {
		return []string{content}
	}
	return out
}

func (p *Platform) sendOne(ctx context.Context, replyCtx any, content string) error {
	rctx, ok := replyCtx.(*replyContext)
	if !ok {
		return fmt.Errorf("qq: invalid reply context")
	}
	if strings.TrimSpace(content) == "" {
		return nil
	}

	params := map[string]any{
		"message": plainAtToCQ(content),
	}

	if rctx.messageType == "group" {
		params["group_id"] = rctx.groupID
		result, err := p.callAPIContext(ctx, "send_group_msg", params)
		p.logOutbound("send_group_msg", rctx, content, result, err)
		if err != nil {
			return err
		}
		p.recordSent(result, content)
		p.noteGroupLine(rctx.groupID, p.selfID, "你", content)
		return nil
	}

	params["user_id"] = rctx.userID
	result, err := p.callAPIContext(ctx, "send_private_msg", params)
	p.logOutbound("send_private_msg", rctx, content, result, err)
	if err != nil {
		return err
	}
	p.recordSent(result, content)
	return nil
}

// ReplyWithAt sends content with real OneBot at segments, so the mentioned
// people get a notification instead of a literal "@name".
// Implements core.AtMentionSender.
func (p *Platform) ReplyWithAt(ctx context.Context, replyCtx any, content string, atUsers []string, atAll bool) error {
	rctx, ok := replyCtx.(*replyContext)
	if !ok {
		return fmt.Errorf("qq: ReplyWithAt: invalid reply context type %T", replyCtx)
	}
	if strings.TrimSpace(content) == "" && len(atUsers) == 0 && !atAll {
		return nil
	}

	segments := make([]map[string]any, 0, len(atUsers)+2)
	if atAll {
		// OneBot spells @全体成员 as qq=all.
		segments = append(segments, map[string]any{"type": "at", "data": map[string]any{"qq": "all"}})
	}
	for _, uid := range atUsers {
		segments = append(segments, map[string]any{"type": "at", "data": map[string]any{"qq": uid}})
	}
	// OneBot joins segments verbatim, so the separating space has to be part of
	// the text segment or the mention would run into the message.
	segments = append(segments, map[string]any{"type": "text", "data": map[string]any{"text": " " + content}})

	params := map[string]any{"message": segments}
	action := "send_private_msg"
	if rctx.messageType == "group" {
		params["group_id"] = rctx.groupID
		action = "send_group_msg"
	} else {
		params["user_id"] = rctx.userID
	}

	summary := content
	if atAll || len(atUsers) > 0 {
		summary = fmt.Sprintf("[at all=%t users=%v] %s", atAll, atUsers, content)
	}
	result, err := p.callAPIContext(ctx, action, params)
	p.logOutbound(action, rctx, summary, result, err)
	if err != nil {
		return fmt.Errorf("qq: ReplyWithAt: %w", err)
	}
	p.recordSent(result, content)
	return nil
}

var _ core.AtMentionSender = (*Platform)(nil)

// recordSent remembers a message this bot sent. A reply to one of them calls
// the bot just like an @ (core/gate_local.go), and the text is what the quote
// shows to the model.
func (p *Platform) recordSent(result map[string]any, text string) {
	if id := jsonInt64(result, "message_id"); id != 0 {
		// "你" matches how groupContext labels this bot's own lines.
		p.storeQuote(strconv.FormatInt(id, 10), text, "你", true)
	}
}

// logOutbound writes one structured receipt for an outbound QQ message, so an
// inbound message_id can be matched to the message_id NapCat returned for the
// send that answered it. Every outbound path calls it once per actual send.
//
// content is a short description of what went out (text, "[image …]",
// "[voice …]", "[file …]"), truncated with the existing quotedTextMaxRunes
// bound (来源: 沿用 platform/qq quotedTextMaxRunes) so a receipt stays as small
// as a cached quote; content_len is the untruncated rune count.
//
// This is logging only: it never changes what, or whether, a message is sent.
func (p *Platform) logOutbound(action string, rctx *replyContext, content string, result map[string]any, err error) {
	outID := ""
	if id := jsonInt64(result, "message_id"); id != 0 {
		outID = strconv.FormatInt(id, 10)
	}
	attrs := []any{
		"pid", os.Getpid(),
		"project", p.project,
		"session_key", rctx.sessionKey,
		"in_message_id", rctx.inMessageID,
		"out_message_id", outID,
		"action", action,
		"content", truncateRunes(content, quotedTextMaxRunes),
		"content_len", utf8.RuneCountInString(content),
	}
	if err != nil {
		slog.Warn(outboundReceiptFailedMessage, append(attrs, "error", err)...)
		return
	}
	slog.Info(outboundReceiptMessage, attrs...)
}

// SendImage sends an image to the conversation.
// Implements core.ImageSender.
func (p *Platform) SendImage(ctx context.Context, replyCtx any, img core.ImageAttachment) error {
	// 空图片数据仍然是一个语法合法的请求：下面的段会变成后面什么都没接的
	// "base64://"，上游照常接受并回报成功，QQ 客户端渲染出一个既无文字也无
	// 图片的气泡。这里在构造段之前丢弃它，而不是把它发出去。
	if len(img.Data) == 0 {
		slog.Warn("qq: skip empty image data", "mime", img.MimeType)
		return nil
	}

	rctx, ok := replyCtx.(*replyContext)
	if !ok {
		return fmt.Errorf("qq: SendImage: invalid reply context type %T", replyCtx)
	}

	b64 := base64.StdEncoding.EncodeToString(img.Data)
	segments := []map[string]any{
		{"type": "image", "data": map[string]any{"file": "base64://" + b64}},
	}

	params := map[string]any{
		"message": segments,
	}

	summary := fmt.Sprintf("[image %s %d bytes]", img.MimeType, len(img.Data))

	if rctx.messageType == "group" {
		params["group_id"] = rctx.groupID
		result, err := p.callAPIContext(ctx, "send_group_msg", params)
		p.logOutbound("send_group_msg", rctx, summary, result, err)
		if err != nil {
			return fmt.Errorf("qq: send image: %w", err)
		}
		return nil
	}

	params["user_id"] = rctx.userID
	result, err := p.callAPIContext(ctx, "send_private_msg", params)
	p.logOutbound("send_private_msg", rctx, summary, result, err)
	if err != nil {
		return fmt.Errorf("qq: send image: %w", err)
	}
	return nil
}

var _ core.ImageSender = (*Platform)(nil)

// fetchRecord returns a received voice message in a format core speech can
// read. QQ voice is silk, which stock ffmpeg cannot demux, so NapCat is asked
// to transcode it first (get_record out_format=mp3 returns base64). If that
// fails, the segment URL is downloaded as before.
func (p *Platform) fetchRecord(data map[string]any) *core.AudioAttachment {
	file, _ := data["file"].(string)
	if file != "" {
		result, err := p.callAPI("get_record", map[string]any{"file": file, "out_format": "mp3"})
		if err == nil {
			if b64, _ := result["base64"].(string); b64 != "" {
				if audio, err := base64.StdEncoding.DecodeString(b64); err == nil && len(audio) > 0 {
					return &core.AudioAttachment{MimeType: "audio/mpeg", Data: audio, Format: "mp3"}
				}
			}
			slog.Warn("qq: get_record returned no audio", "file", file)
		} else {
			slog.Warn("qq: get_record failed, falling back to segment url", "file", file, "error", err)
		}
	}

	url, _ := data["url"].(string)
	if url == "" {
		return nil
	}
	audio, _, err := downloadFile(url)
	if err != nil {
		slog.Warn("qq: download audio failed", "error", err)
		return nil
	}
	format := "silk"
	switch {
	case strings.HasSuffix(file, ".amr"):
		format = "amr"
	case strings.HasSuffix(file, ".mp3"):
		format = "mp3"
	}
	return &core.AudioAttachment{Data: audio, Format: format}
}

// SendAudio sends synthesized speech as a QQ voice message. NapCat accepts
// common formats in a record segment and encodes them to silk itself.
// Implements core.AudioSender.
func (p *Platform) SendAudio(ctx context.Context, replyCtx any, audio []byte, format string) error {
	rctx, ok := replyCtx.(*replyContext)
	if !ok {
		return fmt.Errorf("qq: SendAudio: invalid reply context type %T", replyCtx)
	}
	if len(audio) == 0 {
		return fmt.Errorf("qq: SendAudio: empty audio")
	}

	segments := []map[string]any{
		{"type": "record", "data": map[string]any{"file": "base64://" + base64.StdEncoding.EncodeToString(audio)}},
	}
	params := map[string]any{"message": segments}
	action := "send_private_msg"
	if rctx.messageType == "group" {
		params["group_id"] = rctx.groupID
		action = "send_group_msg"
	} else {
		params["user_id"] = rctx.userID
	}

	summary := fmt.Sprintf("[voice %s %d bytes]", format, len(audio))
	result, err := p.callAPIContext(ctx, action, params)
	if err != nil {
		p.logOutbound(action, rctx, summary, result, err)
		return fmt.Errorf("qq: send audio: %w", err)
	}
	if jsonInt64(result, "message_id") == 0 {
		sendErr := fmt.Errorf("qq: send audio: no message_id in reply")
		p.logOutbound(action, rctx, summary, result, sendErr)
		return sendErr
	}
	p.logOutbound(action, rctx, summary, result, nil)
	p.recordSent(result, "[voice]")
	return nil
}

var _ core.AudioSender = (*Platform)(nil)

func (p *Platform) Stop() error {
	if p.cancel != nil {
		p.cancel()
	}
	if p.conn != nil {
		return p.conn.Close()
	}
	return nil
}

// cachedGroupName returns the group name when it is already known, otherwise
// the raw group id. It never blocks: get_group_info is a 15s round trip when
// the OneBot side does not answer, and the name is only cosmetic.
func (p *Platform) cachedGroupName(groupID int64) string {
	if groupID == 0 {
		return ""
	}
	fallback := strconv.FormatInt(groupID, 10)
	if cached, ok := p.groupNameCache.Load(fallback); ok {
		return cached.(string)
	}
	return fallback
}

// warmGroupName looks up a group name in the background, once per group, so
// later messages carry the real name instead of the id.
func (p *Platform) warmGroupName(groupID int64) {
	if groupID == 0 {
		return
	}
	key := strconv.FormatInt(groupID, 10)
	if _, ok := p.groupNameCache.Load(key); ok {
		return
	}
	if _, loaded := p.groupNamePending.LoadOrStore(key, struct{}{}); loaded {
		return
	}
	go func() {
		defer p.groupNamePending.Delete(key)
		result, err := p.callAPI("get_group_info", map[string]any{"group_id": groupID})
		if err != nil {
			slog.Debug("qq: resolve group name failed", "group_id", groupID, "error", err)
			return
		}
		if name, _ := result["group_name"].(string); name != "" {
			p.groupNameCache.Store(key, name)
		}
	}()
}

// storeQuote remembers a message for reply quoting, dropping entries that are
// too old or when the cache is full.
func (p *Platform) storeQuote(messageID, content, name string, self bool) {
	content = strings.TrimSpace(content)
	if messageID == "" || content == "" {
		return
	}
	p.quoteCache.Store(messageID, quoteEntry{content: truncateRunes(content, quotedTextMaxRunes), name: strings.TrimSpace(name), self: self, at: time.Now()})

	now := time.Now()
	var expired, total int
	p.quoteCache.Range(func(k, v any) bool {
		total++
		if now.Sub(v.(quoteEntry).at) > quoteCacheTTL {
			p.quoteCache.Delete(k)
			expired++
		}
		return true
	})
	// Only pay for eviction when the cache actually overflows; the scan above is
	// cheap but this keeps the common path single-pass.
	if total-expired <= quoteCacheMaxItems {
		return
	}
	var oldestKey string
	var oldestAt time.Time
	p.quoteCache.Range(func(k, v any) bool {
		if at := v.(quoteEntry).at; oldestKey == "" || at.Before(oldestAt) {
			oldestKey, oldestAt = k.(string), at
		}
		return true
	})
	if oldestKey != "" {
		p.quoteCache.Delete(oldestKey)
	}
}

// loadQuote returns the cached message for a reply segment.
func (p *Platform) loadQuote(messageID string) (quoteEntry, bool) {
	v, ok := p.quoteCache.Load(messageID)
	if !ok {
		return quoteEntry{}, false
	}
	entry := v.(quoteEntry)
	if time.Since(entry.at) > quoteCacheTTL {
		p.quoteCache.Delete(messageID)
		return quoteEntry{}, false
	}
	return entry, true
}

// ── OneBot API call via WebSocket ───────────────────────────────

func (p *Platform) callAPI(action string, params map[string]any) (map[string]any, error) {
	return p.callAPIContext(context.Background(), action, params)
}

// callAPIContext stops waiting when the owning turn is cancelled. Once the
// write has started, cancellation does not prove OneBot rejected the message:
// callers must not replay it automatically.
func (p *Platform) callAPIContext(ctx context.Context, action string, params map[string]any) (map[string]any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	seq := p.echoSeq.Add(1)
	echo := strconv.FormatInt(seq, 10)

	req := map[string]any{
		"action": action,
		"echo":   echo,
	}
	if params != nil {
		req["params"] = params
	}

	ch := make(chan json.RawMessage, 1)
	p.echoCh.Store(echo, ch)
	defer p.echoCh.Delete(echo)

	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	if err := ctx.Err(); err != nil {
		p.mu.Unlock()
		return nil, err
	}
	if p.conn == nil {
		p.mu.Unlock()
		return nil, core.ErrTaskTextNotAccepted
	}
	err = p.conn.WriteMessage(websocket.TextMessage, data)
	p.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("qq: ws write: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case raw := <-ch:
		var resp struct {
			Status  string          `json:"status"`
			RetCode int             `json:"retcode"`
			Data    json.RawMessage `json:"data"`
		}
		if json.Unmarshal(raw, &resp) != nil {
			return nil, fmt.Errorf("qq: invalid API response")
		}
		if resp.RetCode != 0 {
			return nil, fmt.Errorf("qq: API %s failed (retcode=%d)", action, resp.RetCode)
		}
		var result map[string]any
		_ = json.Unmarshal(resp.Data, &result)
		return result, nil

	case <-time.After(15 * time.Second):
		return nil, fmt.Errorf("qq: API %s timeout", action)
	}
}

// callHTTPAPI calls a OneBot v11 HTTP endpoint (e.g. /upload_group_file).
// Used for file operations — avoids WebSocket message size limits and
// file-path issues across Windows/WSL/Docker boundaries.
// Requires http_url to be configured.
func (p *Platform) callHTTPAPI(action string, params map[string]any) (map[string]any, error) {
	return p.callHTTPAPIContext(context.Background(), action, params)
}

func (p *Platform) callHTTPAPIContext(ctx context.Context, action string, params map[string]any) (map[string]any, error) {
	if p.httpURL == "" {
		return nil, fmt.Errorf("qq: http_url not configured")
	}
	body, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	url := p.httpURL + "/" + action
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.token != "" {
		req.Header.Set("Authorization", "Bearer "+p.token)
	}
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("qq: HTTP %s failed: %w", action, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qq: HTTP %s returned HTTP %d", action, resp.StatusCode)
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("qq: HTTP %s read body: %w", action, err)
	}

	var apiResp struct {
		Status  string          `json:"status"`
		RetCode int             `json:"retcode"`
		Data    json.RawMessage `json:"data"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(raw, &apiResp) != nil {
		return nil, fmt.Errorf("qq: HTTP %s invalid response", action)
	}
	if apiResp.RetCode != 0 {
		return nil, fmt.Errorf("qq: HTTP %s failed (retcode=%d, msg=%s)", action, apiResp.RetCode, apiResp.Message)
	}
	var result map[string]any
	_ = json.Unmarshal(apiResp.Data, &result)
	return result, nil
}

// ── Helpers ─────────────────────────────────────────────────────

type replyContext struct {
	messageType string // "private" or "group"
	userID      int64
	groupID     int64
	sessionKey  string // conversation key, named in outbound receipts
	inMessageID string // inbound message that triggered the send; empty for proactive sends
}

func (p *Platform) ReconstructReplyCtx(sessionKey string) (any, error) {
	// qq:{userID}, qq:{groupID}:{userID} or qq:g:{groupID}
	parts := strings.SplitN(sessionKey, ":", 3)
	if len(parts) < 2 || parts[0] != "qq" {
		return nil, fmt.Errorf("qq: invalid session key %q", sessionKey)
	}
	if len(parts) == 3 {
		if parts[1] == "g" {
			gid, _ := strconv.ParseInt(parts[2], 10, 64)
			return &replyContext{messageType: "group", groupID: gid, sessionKey: sessionKey}, nil
		}
		gid, _ := strconv.ParseInt(parts[1], 10, 64)
		uid, _ := strconv.ParseInt(parts[2], 10, 64)
		return &replyContext{messageType: "group", groupID: gid, userID: uid, sessionKey: sessionKey}, nil
	}
	uid, _ := strconv.ParseInt(parts[1], 10, 64)
	return &replyContext{messageType: "private", userID: uid, sessionKey: sessionKey}, nil
}

// saveImages writes the images into saveImagesDir and returns one line per file
// for the message text ("" when the option is off or nothing was written).
func (p *Platform) saveImages(messageID int64, images []core.ImageAttachment) string {
	if p.saveImagesDir == "" || len(images) == 0 {
		return ""
	}
	if err := os.MkdirAll(p.saveImagesDir, 0o755); err != nil {
		slog.Warn("qq: save_images_dir unusable", "dir", p.saveImagesDir, "error", err)
		return ""
	}
	var lines []string
	for i, img := range images {
		ext := map[string]string{"image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}[img.MimeType]
		if ext == "" {
			ext = ".jpg"
		}
		path := filepath.Join(p.saveImagesDir, fmt.Sprintf("%d-%d%s", messageID, i+1, ext))
		if err := os.WriteFile(path, img.Data, 0o644); err != nil {
			slog.Warn("qq: save image failed", "path", path, "error", err)
			continue
		}
		lines = append(lines, "[图片已存到 "+path+"]")
	}
	return strings.Join(lines, "\n")
}

// groupHistoryMax / groupHistoryWindow bound what a group turn is shown of the
// chat before it. Source: existing adapter defaults in commit 9d2cc80b.
const (
	groupHistoryMax    = 10
	groupHistoryWindow = 15 * time.Minute
)

type groupLine struct {
	// userID 是发言人的稳定平台号（QQ 号），与显示名并列保存：两个人用同一张
	// 群名片时，只有显示名的背景无法把历史事实归属到人身上。
	// 来源：任务板 #11 缺口（EVIDENCE 6.1、TestQQ11BackgroundStableAuthorAcceptance FAIL）。
	userID     int64
	name, text string
	at         time.Time
}

type groupLog struct {
	mu    sync.Mutex
	lines []groupLine
}

// noteGroupLine appends one line to the group's recent chat. userID is the
// speaker's stable platform id (0 when unknown, e.g. this bot's own line
// before get_login_info answered); name is what the group shows.
func (p *Platform) noteGroupLine(groupID, userID int64, name, text string) {
	if groupID == 0 || strings.TrimSpace(text) == "" {
		return
	}
	v, _ := p.groupHistory.LoadOrStore(groupID, &groupLog{})
	g := v.(*groupLog)
	g.mu.Lock()
	defer g.mu.Unlock()
	g.lines = append(g.lines, groupLine{userID: userID, name: name, text: text, at: time.Now()})
	if len(g.lines) > groupHistoryMax {
		g.lines = g.lines[len(g.lines)-groupHistoryMax:]
	}
}

// groupContext renders the recent chat before the current message, or "".
func (p *Platform) groupContext(groupID int64) string {
	v, ok := p.groupHistory.Load(groupID)
	if !ok {
		return ""
	}
	g := v.(*groupLog)
	g.mu.Lock()
	defer g.mu.Unlock()
	var b strings.Builder
	for _, l := range g.lines {
		if time.Since(l.at) > groupHistoryWindow {
			continue
		}
		if b.Len() == 0 {
			b.WriteString("[群里刚才的聊天]\n")
		}
		fmt.Fprintf(&b, "%s：%s\n", groupSpeakerLabel(l), groupLineBreaks.Replace(l.text))
	}
	return strings.TrimRight(b.String(), "\n")
}

// groupSpeakerLabel renders one background speaker as "名字[ID:20001]". The
// stable id is appended only when the platform knows it, so an unknown speaker
// (or the bot's own line before login) keeps the plain "名字" form.
// 来源：任务板 #11 缺口——同群同名两人的历史发言必须能从背景分清归属
// （2026-11-02 EVIDENCE 6.1；把 ID 放进展示文本的取舍记在那份证据里）。
func groupSpeakerLabel(l groupLine) string {
	name := groupLineBreaks.Replace(l.name)
	if l.userID == 0 {
		return name
	}
	if name == "" {
		return fmt.Sprintf("[ID:%d]", l.userID)
	}
	return fmt.Sprintf("%s[ID:%d]", name, l.userID)
}

// Parse boundary for the background (#69 审查：正文换行可伪造他人带号行):
// one rendered line is exactly one stored record, and its label holds the
// line's only half-width "[ID:". Line breaks in a name or text (LF, CRLF, CR,
// Unicode line/paragraph separators) render as "⏎", and a typed "[ID:" in a
// name or text renders full-width "［ID:". Stored data stays raw.
var groupLineBreaks = strings.NewReplacer(
	"\r\n", "⏎", "\r", "⏎", "\n", "⏎",
	"\v", "⏎", "\f", "⏎", "\u0085", "⏎", "\u2028", "⏎", "\u2029", "⏎",
	"[ID:", "［ID:",
)

// groupAnchorTTL: how long a "this group has / lacks an allow_groups_with
// member" answer is reused. Source: existing adapter cache in commit 54848436.
const groupAnchorTTL = 10 * time.Minute

type groupAnchorEntry struct {
	ok bool
	at time.Time
}

// groupHasAnchor reports whether one of allowGroupsWith is a member of the
// group (OneBot get_group_member_info). A lookup error that is not a plain
// "not a member" refusal is not cached, so a dropped connection retries.
func (p *Platform) groupHasAnchor(groupID int64) bool {
	if len(p.allowGroupsWith) == 0 || groupID == 0 {
		return false
	}
	if v, ok := p.groupAnchorCache.Load(groupID); ok {
		if e := v.(groupAnchorEntry); time.Since(e.at) < groupAnchorTTL {
			return e.ok
		}
	}
	found, cacheable := false, true
	for _, id := range p.allowGroupsWith {
		uid, err := strconv.ParseInt(id, 10, 64)
		if err != nil {
			continue
		}
		_, err = p.callAPI("get_group_member_info", map[string]any{"group_id": groupID, "user_id": uid})
		if err == nil {
			found = true
			break
		}
		if !strings.Contains(err.Error(), "retcode=") {
			cacheable = false
			slog.Warn("qq: allow_groups_with lookup failed", "group_id", groupID, "error", err)
		}
	}
	if found || cacheable {
		p.groupAnchorCache.Store(groupID, groupAnchorEntry{ok: found, at: time.Now()})
	}
	return found
}

func (p *Platform) isAllowed(userID int64) bool {
	if p.allowFrom == "" || p.allowFrom == "*" {
		return true
	}
	uid := strconv.FormatInt(userID, 10)
	for _, allowed := range strings.Split(p.allowFrom, ",") {
		if strings.TrimSpace(allowed) == uid {
			return true
		}
	}
	return false
}

func jsonInt64(m map[string]any, key string) int64 {
	switch v := m[key].(type) {
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	}
	return 0
}

func downloadLargeFile(url string) ([]byte, string, error) {
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	mime := resp.Header.Get("Content-Type")
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	return data, mime, nil
}

func downloadFile(url string) ([]byte, string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	mime := resp.Header.Get("Content-Type")
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	return data, mime, nil
}

// SendFile sends a file to the conversation.
// Implements core.FileSender.
//
// Uses base64-encoded file data to avoid file-path issues across
// Windows/WSL/Docker. Routes through NapCat HTTP API when configured
// (better for large files), falls back to WebSocket.
func (p *Platform) SendFile(ctx context.Context, replyCtx any, file core.FileAttachment) error {
	rctx, ok := replyCtx.(*replyContext)
	if !ok {
		return fmt.Errorf("qq: SendFile: invalid reply context type %T", replyCtx)
	}

	name := file.FileName
	if name == "" {
		name = "attachment"
	}

	b64data := "base64://" + base64.StdEncoding.EncodeToString(file.Data)

	// Pick API caller: prefer HTTP for large payloads, fall back to WebSocket.
	call := p.callAPIContext
	if p.httpURL != "" {
		call = p.callHTTPAPIContext
	}

	summary := fmt.Sprintf("[file %s %d bytes]", name, len(file.Data))

	if rctx.messageType == "group" {
		result, err := call(ctx, "upload_group_file", map[string]any{
			"group_id": rctx.groupID,
			"file":     b64data,
			"name":     name,
		})
		p.logOutbound("upload_group_file", rctx, summary, result, err)
		if err != nil {
			return fmt.Errorf("qq: SendFile group: %w", err)
		}
		return nil
	}

	// Private: use send_private_msg with file segment
	result, err := call(ctx, "send_private_msg", map[string]any{
		"user_id": rctx.userID,
		"message": []map[string]any{
			{"type": "file", "data": map[string]any{"file": b64data, "name": name}},
		},
	})
	p.logOutbound("send_private_msg", rctx, summary, result, err)
	if err != nil {
		return fmt.Errorf("qq: SendFile private: %w", err)
	}
	return nil
}

var _ core.FileSender = (*Platform)(nil)

// QuietSystemNotices keeps the bridge's own notices (unknown slash command,
// ♻️ new session) out of QQ groups, where a slash command is usually meant for
// another bot; private chats still get them (user 2026-11-03).
func (p *Platform) QuietSystemNotices(replyCtx any) bool {
	rc, ok := replyCtx.(*replyContext)
	return ok && rc != nil && rc.messageType == "group"
}

var _ core.GroupQueueBatcher = (*Platform)(nil)

// BatchGroupQueue folds a busy QQ group's queued messages into one turn and lets a full queue
// keep taking @s (user 2026-11-02); private chats and unknown contexts keep the plain queue.
func (p *Platform) BatchGroupQueue(replyCtx any) bool {
	rc, ok := replyCtx.(*replyContext)
	return ok && rc != nil && rc.messageType == "group"
}
