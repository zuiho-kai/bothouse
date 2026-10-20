package core

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Base URLs are variables so tests can point them at fake servers.
var (
	discordAPIBase = "https://discord.com/api/v10"
	feishuOpenBase = "https://open.feishu.cn"
	larkOpenBase   = "https://open.larksuite.com"
	// 来源：沿用 setup.go 里飞书扫码调用的 15 秒客户端超时。
	setupHTTPTimeout = 15 * time.Second
)

// CONEST_DISCORD_API_BASE / CONEST_FEISHU_OPEN_BASE point the wizard at fake
// servers (end-to-end tests of an isolated instance) or a local proxy.
func init() {
	if v := os.Getenv("CONEST_DISCORD_API_BASE"); v != "" {
		discordAPIBase = strings.TrimRight(v, "/")
	}
	if v := os.Getenv("CONEST_FEISHU_OPEN_BASE"); v != "" {
		feishuOpenBase, larkOpenBase = strings.TrimRight(v, "/"), strings.TrimRight(v, "/")
	}
}

// ── Discord ─────────────────────────────────────────────────────

type DiscordGuild struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type DiscordChannel struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     int    `json:"type"`
	Position int    `json:"position"`
	Parent   string `json:"parent_id,omitempty"`
}

// DiscordBotInfo is what the wizard shows after checking a token. No token in it.
type DiscordBotInfo struct {
	BotID          string         `json:"bot_id"`
	Username       string         `json:"username"`
	ApplicationID  string         `json:"application_id"`
	MessageContent bool           `json:"message_content_intent"` // Message Content Intent enabled
	IntentKnown    bool           `json:"intent_known"`           // the application lookup worked, so MessageContent is a real answer
	OwnerID        string         `json:"owner_id,omitempty"`     // Discord user who owns the bot's application (team owner for team apps)
	Guilds         []DiscordGuild `json:"guilds"`
	InviteURL      string         `json:"invite_url"`
}

// discordInvitePermissions — 来源：docs/connect-discord-feishu.md 第 1 步「权限至少勾查看频道、发消息、读消息历史、加反应」
// = View Channels(1<<10) + Send Messages(1<<11) + Read Message History(1<<16) + Add Reactions(1<<6)；
// cc-connect 回复会发文件、链接预览、线程，所以再加 Attach Files(1<<15) + Embed Links(1<<14) + Send Messages in Threads(1<<38)。
const discordInvitePermissions = 1<<10 | 1<<11 | 1<<14 | 1<<15 | 1<<16 | 1<<6 | 1<<38

// DiscordInviteURL builds the "add bot to server" link.
func DiscordInviteURL(appID, guildID string) string {
	q := url.Values{}
	q.Set("client_id", appID)
	q.Set("scope", "bot applications.commands")
	q.Set("permissions", fmt.Sprint(int64(discordInvitePermissions)))
	if guildID != "" {
		q.Set("guild_id", guildID)
	}
	return "https://discord.com/oauth2/authorize?" + q.Encode()
}

// DiscordBotIDFromToken decodes the bot user ID from the first token segment
// (Discord tokens start with base64(user id)). Returns "" if it can't.
func DiscordBotIDFromToken(token string) string {
	seg, _, _ := strings.Cut(strings.TrimPrefix(strings.TrimSpace(token), "Bot "), ".")
	for _, enc := range []*base64.Encoding{base64.RawStdEncoding, base64.StdEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(seg); err == nil {
			s := string(b)
			if s != "" && strings.Trim(s, "0123456789") == "" {
				return s
			}
		}
	}
	return ""
}

func discordGet(ctx context.Context, token, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discordAPIBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bot "+strings.TrimPrefix(strings.TrimSpace(token), "Bot "))
	resp, err := (&http.Client{Timeout: setupHTTPTimeout}).Do(req)
	if err != nil {
		return fmt.Errorf("discord: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("discord: token 无效（401）/ invalid token")
	}
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("discord %s: %d %s", path, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// CheckDiscordBot validates a bot token and lists the servers the bot is in.
func CheckDiscordBot(ctx context.Context, token string) (*DiscordBotInfo, error) {
	var me struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	if err := discordGet(ctx, token, "/users/@me", &me); err != nil {
		return nil, err
	}
	info := &DiscordBotInfo{BotID: me.ID, Username: me.Username, ApplicationID: me.ID, Guilds: []DiscordGuild{}}
	var app struct {
		ID    string `json:"id"`
		Flags int64  `json:"flags"`
		Owner *struct {
			ID string `json:"id"`
		} `json:"owner"`
		Team *struct {
			OwnerUserID string `json:"owner_user_id"`
		} `json:"team"`
	}
	if err := discordGet(ctx, token, "/oauth2/applications/@me", &app); err == nil {
		if app.ID != "" {
			info.ApplicationID = app.ID
		}
		// Discord application flags GATEWAY_MESSAGE_CONTENT (1<<18) / _LIMITED (1<<19).
		info.MessageContent = app.Flags&(1<<18|1<<19) != 0
		info.IntentKnown = true
		// Team-owned applications report the team as a pseudo-user in "owner"; the person is team.owner_user_id.
		switch {
		case app.Team != nil && app.Team.OwnerUserID != "":
			info.OwnerID = app.Team.OwnerUserID
		case app.Owner != nil:
			info.OwnerID = app.Owner.ID
		}
	}
	if err := discordGet(ctx, token, "/users/@me/guilds", &info.Guilds); err != nil {
		return nil, err
	}
	info.InviteURL = DiscordInviteURL(info.ApplicationID, "")
	return info, nil
}

// ListDiscordChannels lists text channels (types 0 text, 5 announcement) in a guild, by position.
func ListDiscordChannels(ctx context.Context, token, guildID string) ([]DiscordChannel, error) {
	var all []DiscordChannel
	if err := discordGet(ctx, token, "/guilds/"+url.PathEscape(guildID)+"/channels", &all); err != nil {
		return nil, err
	}
	out := []DiscordChannel{}
	for _, c := range all {
		if c.Type == 0 || c.Type == 5 {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

// ── Feishu / Lark: list the groups the bot is in (default chat) ─────

type FeishuChat struct {
	ChatID string `json:"chat_id"`
	Name   string `json:"name"`
}

// ListFeishuChats lists the group chats the bot has been added to (first page;
// page_size 100 = 飞书 im/v1/chats 接口的上限，来源：飞书开放平台文档).
func ListFeishuChats(ctx context.Context, appID, appSecret, platformType string) ([]FeishuChat, error) {
	base := feishuOpenBase
	if platformType == "lark" {
		base = larkOpenBase
	}
	client := &http.Client{Timeout: setupHTTPTimeout}
	body, _ := json.Marshal(map[string]string{"app_id": appID, "app_secret": appSecret})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, base+"/open-apis/auth/v3/tenant_access_token/internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("feishu token: %w", err)
	}
	var tok struct {
		Code  int    `json:"code"`
		Msg   string `json:"msg"`
		Token string `json:"tenant_access_token"`
	}
	err = json.NewDecoder(resp.Body).Decode(&tok)
	resp.Body.Close()
	if err != nil || tok.Code != 0 || tok.Token == "" {
		return nil, fmt.Errorf("feishu token: code=%d %s", tok.Code, tok.Msg)
	}
	req, _ = http.NewRequestWithContext(ctx, http.MethodGet, base+"/open-apis/im/v1/chats?page_size=100", nil)
	req.Header.Set("Authorization", "Bearer "+tok.Token)
	resp, err = client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("feishu chats: %w", err)
	}
	defer resp.Body.Close()
	var r struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Items []FeishuChat `json:"items"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil || r.Code != 0 {
		return nil, fmt.Errorf("feishu chats: code=%d %s", r.Code, r.Msg)
	}
	if r.Data.Items == nil {
		r.Data.Items = []FeishuChat{}
	}
	return r.Data.Items, nil
}

// ── jev: test once whether the gate could use the model ─────

type JevTestResult struct {
	Reachable bool     `json:"reachable"`
	Logprobs  bool     `json:"logprobs"` // usable by the gate: at least one option letter is among the top candidates
	Options   []string `json:"options,omitempty"`
	LatencyMs int64    `json:"latency_ms"`
	Slow      bool     `json:"slow,omitempty"` // answered with probabilities, but slower than the gate waits
	// what worked, so the gate asks the same way (saved in jev.json)
	TopLogprobs int    `json:"top_logprobs,omitempty"`
	NoThinking  bool   `json:"no_thinking"`
	Error       string `json:"error,omitempty"`
}

// jevMaxLatency — 来源：contrib/gate/scorer_remote.py TIMEOUT_S = 2.5（gate 每次打分最多等这么久，过了就当出错）。
var jevMaxLatency = 2500 * time.Millisecond

// jevTestOptions / jevTopLogprobs mirror what contrib/gate/scorer_remote.py asks for:
// a one-token answer, top 20 log-probabilities (来源：scorer_remote.py TOP_LOGPROBS = 20，OpenAI 接口上限),
// and the option letters A/B/C of the gate's main question (gate.py: options=["A", "B", "C"]).
var jevTestOptions = []string{"A", "B", "C"}

const jevTopLogprobs = 20 // 来源：contrib/gate/scorer_remote.py TOP_LOGPROBS

const jevTestPrompt = "判断群里这条消息 AI 该怎么处理，只答一个字母。\nA 回复\nB 当作补充信息\nC 不回\n\n消息：「今天的会几点开？」\n\n答案："

// TestJevEndpoint asks <base>/chat/completions the way the gate does and reports
// usable only when one of A/B/C is among the returned top log-probabilities — the
// same condition under which scorer_remote.py gets a score instead of an error.
// 来源：方案第 4 步「填完自动测一次（只要一个字的请求）」，所以 max_tokens = 1。
func TestJevEndpoint(ctx context.Context, baseURL, apiKey, model string) JevTestResult {
	p := jevParams{Top: jevTopLogprobs, NoThinking: true}
	var res JevTestResult
	// Up to two adjustments, each only on the server's own 400: fewer top_logprobs when it states
	// its limit (mlx_lm.server: "top_logprobs must be at most 11"), and no chat_template_kwargs
	// when it rejects that field.
	for attempt := 0; attempt < 3; attempt++ {
		res = testJevOnce(ctx, baseURL, apiKey, model, p)
		next, retry := p.adjustFor(res.Error)
		if !retry {
			break
		}
		p = next
	}
	if res.Slow {
		// The first call to a local model often includes loading it; the gate warms up at start
		// (gate.py __main__), so judge the second, warm call.
		res = testJevOnce(ctx, baseURL, apiKey, model, p)
	}
	res.TopLogprobs, res.NoThinking = p.Top, p.NoThinking
	return res
}

// jevParams are the request knobs the gate must use too (saved in jev.json).
//
// NoThinking sends chat_template_kwargs {"enable_thinking": false}: Qwen3-style chat templates
// otherwise open a <think> block and the first token is never an option letter. Chosen over an
// assistant prefill ("<think></think>") and "/no_think" because, measured 2026-10-20 on
// mlx_lm.server + Qwen3-0.6B-4bit, only chat_template_kwargs gave "A"/"B"/"C" as top tokens
// (prefill and /no_think still started with "<think>"); vLLM and SGLang document the same field.
type jevParams struct {
	Top        int
	NoThinking bool
}

var topLimitRe = regexp.MustCompile(`top_logprobs[^0-9]*(?:at most|<=|maximum(?: of)?|max(?:imum)?)\s*(\d+)`)

// adjustFor returns new params when err is a 400 the server explained.
func (p jevParams) adjustFor(err string) (jevParams, bool) {
	if !strings.HasPrefix(err, "HTTP 400") {
		return p, false
	}
	low := strings.ToLower(err)
	if m := topLimitRe.FindStringSubmatch(low); m != nil {
		if n, e := strconv.Atoi(m[1]); e == nil && n > 0 && n < p.Top {
			p.Top = n
			return p, true
		}
	}
	if p.NoThinking && strings.Contains(low, "chat_template_kwargs") {
		p.NoThinking = false
		return p, true
	}
	return p, false
}

func (p jevParams) body(model string) map[string]any {
	b := map[string]any{
		"model":        model,
		"messages":     []map[string]string{{"role": "user", "content": jevTestPrompt}},
		"max_tokens":   1,
		"temperature":  0,
		"logprobs":     true,
		"top_logprobs": p.Top,
	}
	if p.NoThinking {
		b["chat_template_kwargs"] = map[string]any{"enable_thinking": false}
	}
	return b
}

func testJevOnce(ctx context.Context, baseURL, apiKey, model string, p jevParams) JevTestResult {
	var res JevTestResult
	body, _ := json.Marshal(p.body(model))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		res.Error = err.Error()
		return res
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	start := time.Now()
	resp, err := (&http.Client{Timeout: setupHTTPTimeout}).Do(req)
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	res.LatencyMs = time.Since(start).Milliseconds() // whole answer, as the gate waits for it
	if resp.StatusCode/100 != 2 {
		msg := strings.TrimSpace(string(b))
		if len(msg) > 300 {
			msg = msg[:300]
		}
		res.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, msg)
		return res
	}
	res.Reachable = true
	var out struct {
		Choices []struct {
			Logprobs *struct {
				Content []struct {
					TopLogprobs []struct {
						Token string `json:"token"`
					} `json:"top_logprobs"`
				} `json:"content"`
			} `json:"logprobs"`
		} `json:"choices"`
	}
	if json.Unmarshal(b, &out) != nil || len(out.Choices) == 0 || out.Choices[0].Logprobs == nil || len(out.Choices[0].Logprobs.Content) == 0 {
		return res
	}
	seen := map[string]bool{}
	for _, c := range out.Choices[0].Logprobs.Content[0].TopLogprobs {
		tok := strings.TrimSpace(c.Token) // same as scorer_remote.py: token.strip()
		for _, o := range jevTestOptions {
			if tok == o && !seen[o] {
				seen[o] = true
				res.Options = append(res.Options, o)
			}
		}
	}
	res.Logprobs = len(res.Options) > 0
	if res.Logprobs && time.Duration(res.LatencyMs)*time.Millisecond > jevMaxLatency {
		res.Logprobs, res.Slow = false, true
	}
	return res
}
