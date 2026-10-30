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
	wsURL                 string // e.g. "ws://127.0.0.1:3001"
	token                 string // optional access_token
	allowFrom             string // comma-separated user IDs or "*"
	shareSessionInChannel bool
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
}

// teamPlatforms: QQ number → *Platform for every QQ bot in this process, so a
// bot can tell "@另一个机器人" from "@我" (core.Message.AddressedOther). Same
// registry platform/discord keeps for its teammates.
var teamPlatforms sync.Map

// quoteEntry is one message kept for reply quoting.
type quoteEntry struct {
	content string
	self    bool // this bot sent it, so a reply to it calls the bot
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
// saying anything. Source: 沿用 platform/discord, the same words its bare-@
// path uses, so the model reads the situation the same way on both platforms.
const bareMentionPlaceholder = "（用户 @ 了你，在等你回复：看上面的频道消息判断要你做什么；看不出来就问）"

func New(opts map[string]any) (core.Platform, error) {
	wsURL, _ := opts["ws_url"].(string)
	if wsURL == "" {
		wsURL = "ws://127.0.0.1:3001"
	}
	token, _ := opts["token"].(string)
	allowFrom, _ := opts["allow_from"].(string)
	shareSessionInChannel, _ := opts["share_session_in_channel"].(bool)

	core.CheckAllowFrom("qq", allowFrom)

	httpURL, _ := opts["http_url"].(string)
	httpURL = strings.TrimRight(httpURL, "/")

	return &Platform{
		wsURL:                 wsURL,
		token:                 token,
		allowFrom:             allowFrom,
		shareSessionInChannel: shareSessionInChannel,
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
		slog.Info("qq: reconnected")
		return
	}
	slog.Error("qq: failed to reconnect after 30 attempts")
}

func (p *Platform) handleMessage(payload map[string]any) {
	msgType, _ := payload["message_type"].(string)
	userID := jsonInt64(payload, "user_id")
	groupID := jsonInt64(payload, "group_id")
	messageID := jsonInt64(payload, "message_id")

	if userID == p.selfID {
		return
	}

	if ts, ok := payload["time"].(float64); ok && ts > 0 {
		if core.IsOldMessage(time.Unix(int64(ts), 0)) {
			slog.Debug("qq: ignoring old message after restart", "time", int64(ts))
			return
		}
	}

	msgIDStr := strconv.FormatInt(messageID, 10)
	if p.dedup.IsDuplicate(msgIDStr) {
		slog.Debug("qq: duplicate message ignored", "message_id", messageID)
		return
	}

	if !p.isAllowed(userID) {
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

	// A bare @ is a person calling the bot with nothing to say yet; dropping it
	// as empty would look like the bot ignored them (platform/discord does the
	// same).
	content := parsed.text
	if content == "" && len(parsed.images) == 0 && len(parsed.files) == 0 && parsed.audio == nil && !parsed.mentioned {
		return
	}
	if content == "" && len(parsed.images) == 0 && len(parsed.files) == 0 && parsed.audio == nil {
		content = bareMentionPlaceholder
	}

	// A reply to one of this bot's messages calls the bot just like an @ does
	// (core/gate_local.go: "an @, a reply to it"). Everyone else's message is
	// context only.
	mentioned := parsed.mentioned
	var quoted []string
	if id := parsed.replyTo; id != "" {
		if entry, ok := p.loadQuote(id); ok {
			quoted = append(quoted, entry.content)
			mentioned = mentioned || entry.self
		}
	}
	// Store the person's own words, not the bare-@ placeholder: a later reply to
	// a poke should not quote the placeholder back as if they had said it.
	p.storeQuote(strconv.FormatInt(messageID, 10), parsed.text, false)

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
		messageID:   int32(messageID),
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
	}
	if len(quoted) > 0 {
		msg.ExtraContent = "[引用消息]\n" + strings.Join(quoted, "\n")
	}

	slog.Debug("qq: message received", "type", msgType, "user", userID, "text_len", len(content), "mentioned", mentioned)
	p.handler(p, msg)
}

// parsedMessage is one OneBot message event, split into what core.Message needs.
type parsedMessage struct {
	text      string
	images    []core.ImageAttachment
	files     []core.FileAttachment
	audio     *core.AudioAttachment
	mentioned bool   // an "at" segment addressed this bot
	other     bool   // an "at" segment named a teammate bot, not this one
	replyTo   string // message ID of the "reply" segment, empty when not a reply
}

func (p *Platform) parseMessage(payload map[string]any, msgType string, groupID int64) parsedMessage {
	var out parsedMessage
	var textParts []string

	// OneBot message can be array of segments or a string
	switch msg := payload["message"].(type) {
	case []any:
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
			case "reply":
				out.replyTo, _ = data["id"].(string)
			}
		}
	default:
		// String message (message_format=string): CQ codes, with raw_message as
		// the same text when the OneBot side includes it.
		raw, _ := payload["message"].(string)
		if raw == "" {
			raw, _ = payload["raw_message"].(string)
		}
		out.mentioned, out.other = p.parseCQString(raw, &textParts)
	}

	out.text = strings.TrimSpace(strings.Join(textParts, ""))
	return out
}

// parseCQString splits a raw CQ-string message ("[CQ:at,qq=10000] 你好") into
// text, reporting whether an at code names this bot or a teammate. Used when
// the OneBot side sends message_format=string instead of a segment array.
func (p *Platform) parseCQString(raw string, textParts *[]string) (mentioned, other bool) {
	for len(raw) > 0 {
		idx := strings.Index(raw, "[CQ:")
		if idx < 0 {
			*textParts = append(*textParts, unescapeCQText(raw))
			break
		}
		*textParts = append(*textParts, unescapeCQText(raw[:idx]))
		end := strings.Index(raw[idx:], "]")
		if end < 0 {
			break
		}
		fields := strings.Split(raw[idx+len("[CQ:"):idx+end], ",")
		raw = raw[idx+end+1:]

		switch fields[0] {
		case "at":
			params := parseCQParams(fields[1:])
			if params["qq"] == strconv.FormatInt(p.selfID, 10) {
				mentioned = true
				continue
			}
			if p.isTeammate(params["qq"]) {
				other = true
			}
			name := params["name"]
			if name == "" {
				name = p.teammateName(params["qq"])
			}
			if name == "" {
				name = params["qq"]
			}
			*textParts = append(*textParts, "@"+name)
		case "reply":
			// Reply targets are ignored here: the same event normally carries a
			// "reply" only in segment form, and Message.ExtraContent already
			// covers the quote for that shape.
		}
	}
	return mentioned, other
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
func parseCQParams(fields []string) map[string]string {
	params := make(map[string]string, len(fields))
	for _, f := range fields {
		k, v, ok := strings.Cut(f, "=")
		if !ok {
			continue
		}
		params[k] = unescapeCQText(v)
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

// unescapeCQText reverses the four escapes OneBot applies inside CQ codes.
func unescapeCQText(s string) string {
	if !strings.Contains(s, "&") {
		return s
	}
	return cqUnescaper.Replace(s)
}

var cqUnescaper = strings.NewReplacer(
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
	rctx, ok := replyCtx.(*replyContext)
	if !ok {
		return fmt.Errorf("qq: invalid reply context")
	}

	params := map[string]any{
		"message": plainAtToCQ(content),
	}

	if rctx.messageType == "group" {
		params["group_id"] = rctx.groupID
		result, err := p.callAPI("send_group_msg", params)
		if err != nil {
			return err
		}
		p.recordSent(result, content)
		return nil
	}

	params["user_id"] = rctx.userID
	result, err := p.callAPI("send_private_msg", params)
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

	result, err := p.callAPI(action, params)
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
		p.storeQuote(strconv.FormatInt(id, 10), text, true)
	}
}

// SendImage sends an image to the conversation.
// Implements core.ImageSender.
func (p *Platform) SendImage(ctx context.Context, replyCtx any, img core.ImageAttachment) error {
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

	if rctx.messageType == "group" {
		params["group_id"] = rctx.groupID
		_, err := p.callAPI("send_group_msg", params)
		if err != nil {
			return fmt.Errorf("qq: send image: %w", err)
		}
		return nil
	}

	params["user_id"] = rctx.userID
	_, err := p.callAPI("send_private_msg", params)
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

	result, err := p.callAPI(action, params)
	if err != nil {
		return fmt.Errorf("qq: send audio: %w", err)
	}
	id := jsonInt64(result, "message_id")
	if id == 0 {
		return fmt.Errorf("qq: send audio: no message_id in reply")
	}
	slog.Info("qq: voice sent", "message_id", id, "format", format, "bytes", len(audio))
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
func (p *Platform) storeQuote(messageID, content string, self bool) {
	content = strings.TrimSpace(content)
	if messageID == "" || content == "" {
		return
	}
	p.quoteCache.Store(messageID, quoteEntry{content: truncateRunes(content, quotedTextMaxRunes), self: self, at: time.Now()})

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
	err = p.conn.WriteMessage(websocket.TextMessage, data)
	p.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("qq: ws write: %w", err)
	}

	select {
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
	if p.httpURL == "" {
		return nil, fmt.Errorf("qq: http_url not configured")
	}
	body, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	url := p.httpURL + "/" + action
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
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
	messageID   int32
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
			return &replyContext{messageType: "group", groupID: gid}, nil
		}
		gid, _ := strconv.ParseInt(parts[1], 10, 64)
		uid, _ := strconv.ParseInt(parts[2], 10, 64)
		return &replyContext{messageType: "group", groupID: gid, userID: uid}, nil
	}
	uid, _ := strconv.ParseInt(parts[1], 10, 64)
	return &replyContext{messageType: "private", userID: uid}, nil
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
	call := p.callAPI
	if p.httpURL != "" {
		call = p.callHTTPAPI
	}

	if rctx.messageType == "group" {
		_, err := call("upload_group_file", map[string]any{
			"group_id": rctx.groupID,
			"file":     b64data,
			"name":     name,
		})
		if err != nil {
			return fmt.Errorf("qq: SendFile group: %w", err)
		}
		return nil
	}

	// Private: use send_private_msg with file segment
	_, err := call("send_private_msg", map[string]any{
		"user_id": rctx.userID,
		"message": []map[string]any{
			{"type": "file", "data": map[string]any{"file": b64data, "name": name}},
		},
	})
	if err != nil {
		return fmt.Errorf("qq: SendFile private: %w", err)
	}
	return nil
}

var _ core.FileSender = (*Platform)(nil)
