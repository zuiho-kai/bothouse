package core

// protoconv: a minimal local protocol converter so that a third-party API that
// only speaks OpenAI Chat Completions can be attached to any local CLI.
//
//   Claude Code  ── Anthropic Messages ──┐
//   Codex        ── OpenAI Responses  ───┼─▶ 127.0.0.1:<port>/<id>/… ─▶ <upstream>/chat/completions
//   Gemini CLI   ── Gemini generateContent┘
//
// A provider opts in with api_format = "openai_chat". Agents call
// ProviderConfig.ForProtocol(<what the CLI speaks>) and get back a copy whose
// BaseURL points at the converter; the converter injects the real key.
// The upstream is always called with stream=true and the result is either
// re-streamed in the CLI's format or aggregated for non-streaming requests.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Protocols a CLI can speak (ForProtocol argument).
const (
	ProtocolAnthropic  = "anthropic"   // Claude Code: <base>/v1/messages
	ProtocolResponses  = "responses"   // Codex: <base>/responses (base ends with /v1)
	ProtocolGemini     = "gemini"      // Gemini CLI: <base>/v1beta/models/<m>:streamGenerateContent
	ProtocolOpenAIChat = "openai_chat" // OpenCode etc.: <base>/chat/completions
)

// APIFormatOpenAIChat marks a provider whose upstream only speaks Chat Completions.
const APIFormatOpenAIChat = "openai_chat"

// protoConvPlaceholderKey is what the CLI sends to the local converter; the
// converter ignores it and uses the provider's real key upstream.
const protoConvPlaceholderKey = "conest-local"

// ForProtocol returns the provider as seen by a CLI that speaks `protocol`.
// When the provider's upstream speaks a different protocol (api_format =
// "openai_chat" and the CLI is not OpenAI-chat), a shared local converter is
// started and the returned copy points at it. Otherwise p is returned as is.
func (p ProviderConfig) ForProtocol(protocol string) ProviderConfig {
	if p.APIFormat != APIFormatOpenAIChat || protocol == ProtocolOpenAIChat || p.BaseURL == "" {
		return p
	}
	base, err := protoConvRoute(p.BaseURL, p.APIKey, p.Model)
	if err != nil {
		slog.Error("protoconv: start failed, using upstream directly", "error", err)
		return p
	}
	out := p
	out.APIKey = protoConvPlaceholderKey
	out.Thinking = ""
	switch protocol {
	case ProtocolResponses:
		out.BaseURL = base + "/v1"
		out.CodexWireAPI = "responses"
	default:
		out.BaseURL = base
	}
	return out
}

// ── shared server ──────────────────────────────────────────────

type protoConvTarget struct {
	upstream string // base URL; we append /chat/completions
	apiKey   string
	model    string // forced model ("" = pass the CLI's model through)
}

var protoConv struct {
	mu      sync.Mutex
	baseURL string
	targets map[string]protoConvTarget
}

func protoConvRoute(upstream, apiKey, model string) (string, error) {
	protoConv.mu.Lock()
	defer protoConv.mu.Unlock()
	if protoConv.baseURL == "" {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return "", err
		}
		protoConv.targets = map[string]protoConvTarget{}
		srv := &http.Server{Handler: http.HandlerFunc(serveProtoConv), ReadTimeout: 10 * time.Minute}
		go func() { _ = srv.Serve(ln) }()
		protoConv.baseURL = fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port)
		slog.Info("protoconv: started", "local", protoConv.baseURL)
	}
	sum := sha256.Sum256([]byte(upstream + "\x00" + apiKey + "\x00" + model))
	id := hex.EncodeToString(sum[:6])
	protoConv.targets[id] = protoConvTarget{upstream: strings.TrimRight(upstream, "/"), apiKey: apiKey, model: model}
	return protoConv.baseURL + "/" + id, nil
}

// NewProtoConvHandler returns a handler for a single upstream (tests, reuse).
func NewProtoConvHandler(upstream, apiKey, model string) http.Handler {
	t := protoConvTarget{upstream: strings.TrimRight(upstream, "/"), apiKey: apiKey, model: model}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.serve(w, r, r.URL.Path) })
}

func serveProtoConv(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	id, rest, _ := strings.Cut(path, "/")
	protoConv.mu.Lock()
	t, ok := protoConv.targets[id]
	protoConv.mu.Unlock()
	if !ok {
		http.Error(w, "unknown route", http.StatusNotFound)
		return
	}
	t.serve(w, r, "/"+rest)
}

func (t protoConvTarget) serve(w http.ResponseWriter, r *http.Request, path string) {
	switch {
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/messages/count_tokens"):
		body, _ := io.ReadAll(io.LimitReader(r.Body, 32<<20))
		pcWriteJSON(w, map[string]any{"input_tokens": pcEstimateTokens(len(body))})
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/messages"):
		t.handleAnthropic(w, r)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/responses"):
		t.handleResponses(w, r)
	case r.Method == http.MethodPost && strings.Contains(path, ":countTokens"):
		body, _ := io.ReadAll(io.LimitReader(r.Body, 32<<20))
		pcWriteJSON(w, map[string]any{"totalTokens": pcEstimateTokens(len(body))})
	case r.Method == http.MethodPost && (strings.Contains(path, ":generateContent") || strings.Contains(path, ":streamGenerateContent")):
		t.handleGemini(w, r, strings.Contains(path, ":streamGenerateContent"))
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/models"):
		model := t.model
		pcWriteJSON(w, map[string]any{"object": "list", "data": []map[string]any{{"id": model, "object": "model"}}})
	default:
		http.Error(w, "unsupported path "+path, http.StatusNotFound)
	}
}

// estimateTokens: ~4 bytes per token, the usual rough heuristic; only used
// for count_tokens which CLIs treat as an estimate.
func pcEstimateTokens(n int) int { return n/4 + 1 }

func pcWriteJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func pcWriteError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":  "error",
		"error": map[string]any{"type": "api_error", "message": msg, "code": status},
	})
}

// ── upstream (chat completions, always streamed) ───────────────

type pcToolCall struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Func struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type pcMsg struct {
	Role       string       `json:"role"`
	Content    any          `json:"content,omitempty"`
	ToolCalls  []pcToolCall `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
}

type pcReq struct {
	Model       string           `json:"model"`
	Messages    []pcMsg          `json:"messages"`
	Tools       []map[string]any `json:"tools,omitempty"`
	ToolChoice  any              `json:"tool_choice,omitempty"`
	MaxTokens   int              `json:"max_tokens,omitempty"`
	Temperature *float64         `json:"temperature,omitempty"`
	TopP        *float64         `json:"top_p,omitempty"`
	Stop        []string         `json:"stop,omitempty"`
	Stream      bool             `json:"stream"`
	StreamOpts  map[string]any   `json:"stream_options,omitempty"`
}

// upstreamEvents receives the parsed upstream stream.
type upstreamEvents struct {
	text     func(string)
	tool     func(index int, id, name, argsDelta string)
	finish   func(reason string)
	usage    func(in, out int)
	finished bool
}

func pcFuncTool(name, desc string, params any) map[string]any {
	if params == nil {
		params = map[string]any{"type": "object", "properties": map[string]any{}}
	}
	return map[string]any{"type": "function", "function": map[string]any{
		"name": name, "description": desc, "parameters": params,
	}}
}

func (t protoConvTarget) callUpstream(r *http.Request, req pcReq, ev *upstreamEvents) (int, string) {
	if t.model != "" {
		req.Model = t.model
	}
	req.Stream = true
	req.StreamOpts = map[string]any{"include_usage": true}
	body, _ := json.Marshal(req)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, t.upstream+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return http.StatusBadGateway, err.Error()
	}
	hreq.Header.Set("Content-Type", "application/json")
	hreq.Header.Set("Accept", "text/event-stream")
	if t.apiKey != "" {
		hreq.Header.Set("Authorization", "Bearer "+t.apiKey)
	}
	resp, err := protoConvClient.Do(hreq)
	if err != nil {
		return http.StatusBadGateway, "upstream: " + err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return resp.StatusCode, fmt.Sprintf("upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "event-stream") {
		// Server ignored stream=true: parse one JSON completion.
		var c struct {
			Choices []struct {
				Message struct {
					Content   string       `json:"content"`
					ToolCalls []pcToolCall `json:"tool_calls"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Usage struct {
				Prompt     int `json:"prompt_tokens"`
				Completion int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
			return http.StatusBadGateway, "upstream decode: " + err.Error()
		}
		if len(c.Choices) > 0 {
			ch := c.Choices[0]
			if ch.Message.Content != "" {
				ev.text(ch.Message.Content)
			}
			for i, tc := range ch.Message.ToolCalls {
				ev.tool(i, tc.ID, tc.Func.Name, tc.Func.Arguments)
			}
			ev.usage(c.Usage.Prompt, c.Usage.Completion)
			ev.finish(ch.FinishReason)
		}
		return 0, ""
	}
	// Idle timeout once the stream has started: no data for protoConvIdle → cancel,
	// the read fails and the CLI gets an error instead of hanging.
	idle := time.AfterFunc(protoConvIdle, cancel)
	defer idle.Stop()
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64<<10), 16<<20)
	finish, done := "", false
	for sc.Scan() {
		idle.Reset(protoConvIdle)
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			done = true
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index int    `json:"index"`
						ID    string `json:"id"`
						Func  struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Usage *struct {
				Prompt     int `json:"prompt_tokens"`
				Completion int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Usage != nil {
			ev.usage(chunk.Usage.Prompt, chunk.Usage.Completion)
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.Content != "" {
				ev.text(ch.Delta.Content)
			}
			for _, tc := range ch.Delta.ToolCalls {
				ev.tool(tc.Index, tc.ID, tc.Func.Name, tc.Func.Arguments)
			}
			if ch.FinishReason != nil && *ch.FinishReason != "" {
				finish = *ch.FinishReason
			}
		}
	}
	// An interrupted upstream must surface as an error to the CLI, not as a clean end_turn.
	if err := sc.Err(); err != nil {
		return http.StatusBadGateway, "upstream stream interrupted: " + err.Error()
	}
	if !done && finish == "" {
		return http.StatusBadGateway, "upstream stream ended before finish_reason / [DONE]"
	}
	ev.finish(finish)
	return 0, ""
}

// protoConvIdle — 来源：沿用下面 ResponseHeaderTimeout 的 10 分钟（首字节前最多等多久，两段数据之间也最多等这么久）。
// A variable so tests can shorten it.
var protoConvIdle = 10 * time.Minute

// protoConvClient bounds connecting and waiting for the first response byte only;
// a long streamed answer is never cut off (cancellation comes from the CLI's request context).
var protoConvClient = &http.Client{Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 30 * time.Second}).DialContext, // 来源：沿用 net/http DefaultTransport 的拨号超时
	TLSHandshakeTimeout:   10 * time.Second,                                     // 来源：沿用 net/http DefaultTransport
	ResponseHeaderTimeout: 10 * time.Minute,                                     // 来源：沿用改动前整次请求的 10 分钟上限，现在只管到首字节
	ForceAttemptHTTP2:     true,
}}

// pcSSE writes server-sent events and flushes after each one.
type pcSSE struct {
	w       http.ResponseWriter
	started bool
}

func (s *pcSSE) start() {
	if s.started {
		return
	}
	s.started = true
	s.w.Header().Set("Content-Type", "text/event-stream")
	s.w.Header().Set("Cache-Control", "no-cache")
	s.w.WriteHeader(http.StatusOK)
}

func (s *pcSSE) event(name string, v any) {
	s.start()
	b, _ := json.Marshal(v)
	if name != "" {
		fmt.Fprintf(s.w, "event: %s\n", name)
	}
	fmt.Fprintf(s.w, "data: %s\n\n", b)
	if f, ok := s.w.(http.Flusher); ok {
		f.Flush()
	}
}

func pcArgs(s string) map[string]any {
	var m map[string]any
	if json.Unmarshal([]byte(s), &m) != nil || m == nil {
		m = map[string]any{}
	}
	return m
}

func pcJSON(v any) string {
	if v == nil {
		return "{}"
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// ── Anthropic Messages ─────────────────────────────────────────

func anthropicText(v any) string {
	switch c := v.(type) {
	case string:
		return c
	case []any:
		var sb strings.Builder
		for _, b := range c {
			if m, ok := b.(map[string]any); ok {
				if s, ok := m["text"].(string); ok {
					if sb.Len() > 0 {
						sb.WriteString("\n")
					}
					sb.WriteString(s)
				}
			}
		}
		return sb.String()
	}
	return ""
}

func anthropicToChat(in map[string]any) pcReq {
	var req pcReq
	req.Model, _ = in["model"].(string)
	if mt, ok := in["max_tokens"].(float64); ok {
		req.MaxTokens = int(mt)
	}
	if v, ok := in["temperature"].(float64); ok {
		req.Temperature = &v
	}
	if v, ok := in["top_p"].(float64); ok {
		req.TopP = &v
	}
	if ss, ok := in["stop_sequences"].([]any); ok {
		for _, s := range ss {
			if str, ok := s.(string); ok {
				req.Stop = append(req.Stop, str)
			}
		}
	}
	if sys := anthropicText(in["system"]); sys != "" {
		req.Messages = append(req.Messages, pcMsg{Role: "system", Content: sys})
	}
	msgs, _ := in["messages"].([]any)
	for _, raw := range msgs {
		m, _ := raw.(map[string]any)
		role, _ := m["role"].(string)
		if s, ok := m["content"].(string); ok {
			req.Messages = append(req.Messages, pcMsg{Role: role, Content: s})
			continue
		}
		blocks, _ := m["content"].([]any)
		var parts []map[string]any
		var text strings.Builder
		var calls []pcToolCall
		var toolMsgs []pcMsg
		for _, rb := range blocks {
			b, _ := rb.(map[string]any)
			switch b["type"] {
			case "text":
				s, _ := b["text"].(string)
				text.WriteString(s)
				parts = append(parts, map[string]any{"type": "text", "text": s})
			case "image":
				if src, ok := b["source"].(map[string]any); ok {
					url := ""
					if src["type"] == "base64" {
						url = fmt.Sprintf("data:%v;base64,%v", src["media_type"], src["data"])
					} else if u, ok := src["url"].(string); ok {
						url = u
					}
					if url != "" {
						parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}})
					}
				}
			case "tool_use":
				var tc pcToolCall
				tc.ID, _ = b["id"].(string)
				tc.Type = "function"
				tc.Func.Name, _ = b["name"].(string)
				tc.Func.Arguments = pcJSON(b["input"])
				calls = append(calls, tc)
			case "tool_result":
				id, _ := b["tool_use_id"].(string)
				content := anthropicText(b["content"])
				if isErr, _ := b["is_error"].(bool); isErr {
					content = "ERROR: " + content
				}
				toolMsgs = append(toolMsgs, pcMsg{Role: "tool", ToolCallID: id, Content: content})
			}
		}
		req.Messages = append(req.Messages, toolMsgs...)
		if role == "assistant" {
			if text.Len() > 0 || len(calls) > 0 {
				msg := pcMsg{Role: "assistant", ToolCalls: calls}
				if text.Len() > 0 {
					msg.Content = text.String()
				}
				req.Messages = append(req.Messages, msg)
			}
			continue
		}
		if len(parts) == 0 {
			continue
		}
		hasImage := false
		for _, p := range parts {
			if p["type"] == "image_url" {
				hasImage = true
			}
		}
		if hasImage {
			req.Messages = append(req.Messages, pcMsg{Role: role, Content: parts})
		} else {
			req.Messages = append(req.Messages, pcMsg{Role: role, Content: text.String()})
		}
	}
	tools, _ := in["tools"].([]any)
	for _, rt := range tools {
		tm, _ := rt.(map[string]any)
		name, _ := tm["name"].(string)
		if name == "" || tm["input_schema"] == nil {
			continue // server tools (web_search …) have no upstream equivalent
		}
		desc, _ := tm["description"].(string)
		req.Tools = append(req.Tools, pcFuncTool(name, desc, tm["input_schema"]))
	}
	if tc, ok := in["tool_choice"].(map[string]any); ok && len(req.Tools) > 0 {
		switch tc["type"] {
		case "any":
			req.ToolChoice = "required"
		case "none":
			req.ToolChoice = "none"
		case "tool":
			req.ToolChoice = map[string]any{"type": "function", "function": map[string]any{"name": tc["name"]}}
		}
	}
	return req
}

func anthropicStopReason(finish string) string {
	switch finish {
	case "length":
		return "max_tokens"
	case "tool_calls", "function_call":
		return "tool_use"
	default:
		return "end_turn"
	}
}

func (t protoConvTarget) handleAnthropic(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&in); err != nil {
		pcWriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	stream, _ := in["stream"].(bool)
	req := anthropicToChat(in)
	model := req.Model
	msgID := fmt.Sprintf("msg_conv_%d", time.Now().UnixNano())

	type block struct {
		kind  string // text | tool
		text  strings.Builder
		id    string
		name  string
		args  strings.Builder
		index int // anthropic content index
	}
	var blocks []*block
	toolByIdx := map[int]*block{}
	var cur *block
	inTok, outTok := 0, 0
	stop := ""
	sse := &pcSSE{w: w}
	closeCur := func() {
		if cur != nil && stream {
			sse.event("content_block_stop", map[string]any{"type": "content_block_stop", "index": cur.index})
		}
		cur = nil
	}
	// message_start is sent lazily so an upstream HTTP error can still be
	// returned as a real status code (the CLI then shows e.g. a 401).
	started := false
	startMsg := func() {
		if started || !stream {
			return
		}
		started = true
		sse.event("message_start", map[string]any{"type": "message_start", "message": map[string]any{
			"id": msgID, "type": "message", "role": "assistant", "model": model, "content": []any{},
			"stop_reason": nil, "usage": map[string]any{"input_tokens": 0, "output_tokens": 0},
		}})
	}
	ev := &upstreamEvents{
		text: func(s string) {
			startMsg()
			if cur == nil || cur.kind != "text" {
				closeCur()
				cur = &block{kind: "text", index: len(blocks)}
				blocks = append(blocks, cur)
				if stream {
					sse.event("content_block_start", map[string]any{"type": "content_block_start", "index": cur.index,
						"content_block": map[string]any{"type": "text", "text": ""}})
				}
			}
			cur.text.WriteString(s)
			if stream {
				sse.event("content_block_delta", map[string]any{"type": "content_block_delta", "index": cur.index,
					"delta": map[string]any{"type": "text_delta", "text": s}})
			}
		},
		tool: func(i int, id, name, args string) {
			startMsg()
			b := toolByIdx[i]
			if b == nil {
				closeCur()
				if id == "" {
					id = fmt.Sprintf("toolu_conv_%d_%d", time.Now().UnixNano(), i)
				}
				b = &block{kind: "tool", id: id, name: name, index: len(blocks)}
				blocks = append(blocks, b)
				toolByIdx[i] = b
				cur = b
				if stream {
					sse.event("content_block_start", map[string]any{"type": "content_block_start", "index": b.index,
						"content_block": map[string]any{"type": "tool_use", "id": b.id, "name": b.name, "input": map[string]any{}}})
				}
			}
			if args != "" {
				b.args.WriteString(args)
				if stream {
					sse.event("content_block_delta", map[string]any{"type": "content_block_delta", "index": b.index,
						"delta": map[string]any{"type": "input_json_delta", "partial_json": args}})
				}
			}
		},
		usage:  func(i, o int) { inTok, outTok = i, o },
		finish: func(f string) { stop = anthropicStopReason(f) },
	}
	status, msg := t.callUpstream(r, req, ev)
	if status != 0 {
		if stream && sse.started {
			sse.event("error", map[string]any{"type": "error", "error": map[string]any{"type": "api_error", "message": msg}})
			return
		}
		pcWriteError(w, status, msg)
		return
	}
	if len(toolByIdx) > 0 {
		stop = "tool_use"
	}
	if stream {
		startMsg()
		closeCur()
		sse.event("message_delta", map[string]any{"type": "message_delta",
			"delta": map[string]any{"stop_reason": stop, "stop_sequence": nil},
			"usage": map[string]any{"input_tokens": inTok, "output_tokens": outTok}})
		sse.event("message_stop", map[string]any{"type": "message_stop"})
		return
	}
	content := []any{}
	for _, b := range blocks {
		if b.kind == "text" {
			content = append(content, map[string]any{"type": "text", "text": b.text.String()})
		} else {
			content = append(content, map[string]any{"type": "tool_use", "id": b.id, "name": b.name, "input": pcArgs(b.args.String())})
		}
	}
	pcWriteJSON(w, map[string]any{"id": msgID, "type": "message", "role": "assistant", "model": model,
		"content": content, "stop_reason": stop, "stop_sequence": nil,
		"usage": map[string]any{"input_tokens": inTok, "output_tokens": outTok}})
}

// ── OpenAI Responses ───────────────────────────────────────────

func responsesContentText(v any) (string, []map[string]any, bool) {
	if s, ok := v.(string); ok {
		return s, nil, false
	}
	var sb strings.Builder
	var parts []map[string]any
	hasImage := false
	arr, _ := v.([]any)
	for _, raw := range arr {
		p, _ := raw.(map[string]any)
		switch p["type"] {
		case "input_text", "output_text", "text":
			s, _ := p["text"].(string)
			sb.WriteString(s)
			parts = append(parts, map[string]any{"type": "text", "text": s})
		case "input_image":
			if u, ok := p["image_url"].(string); ok && u != "" {
				hasImage = true
				parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": u}})
			}
		}
	}
	return sb.String(), parts, hasImage
}

// responsesToChat converts a Responses request. customTools records tools of
// type "custom" (freeform input) so their calls can be returned as
// custom_tool_call items.
func responsesToChat(in map[string]any) (pcReq, map[string]bool) {
	var req pcReq
	custom := map[string]bool{}
	req.Model, _ = in["model"].(string)
	if v, ok := in["max_output_tokens"].(float64); ok {
		req.MaxTokens = int(v)
	}
	if v, ok := in["temperature"].(float64); ok {
		req.Temperature = &v
	}
	if v, ok := in["top_p"].(float64); ok {
		req.TopP = &v
	}
	if s, _ := in["instructions"].(string); s != "" {
		req.Messages = append(req.Messages, pcMsg{Role: "system", Content: s})
	}
	var pendingCalls []pcToolCall
	flushCalls := func() {
		if len(pendingCalls) > 0 {
			req.Messages = append(req.Messages, pcMsg{Role: "assistant", ToolCalls: pendingCalls})
			pendingCalls = nil
		}
	}
	switch input := in["input"].(type) {
	case string:
		req.Messages = append(req.Messages, pcMsg{Role: "user", Content: input})
	case []any:
		for _, raw := range input {
			it, _ := raw.(map[string]any)
			typ, _ := it["type"].(string)
			if typ == "" && it["role"] != nil {
				typ = "message"
			}
			switch typ {
			case "message":
				role, _ := it["role"].(string)
				if role == "developer" {
					role = "system"
				}
				text, parts, hasImage := responsesContentText(it["content"])
				if role == "assistant" && len(pendingCalls) > 0 {
					// merge text into the pending tool-call message
					req.Messages = append(req.Messages, pcMsg{Role: "assistant", Content: text, ToolCalls: pendingCalls})
					pendingCalls = nil
					continue
				}
				flushCalls()
				if hasImage {
					req.Messages = append(req.Messages, pcMsg{Role: role, Content: parts})
				} else {
					req.Messages = append(req.Messages, pcMsg{Role: role, Content: text})
				}
			case "function_call", "custom_tool_call":
				var tc pcToolCall
				tc.ID, _ = it["call_id"].(string)
				tc.Type = "function"
				tc.Func.Name, _ = it["name"].(string)
				if typ == "custom_tool_call" {
					s, _ := it["input"].(string)
					tc.Func.Arguments = pcJSON(map[string]any{"input": s})
				} else {
					tc.Func.Arguments, _ = it["arguments"].(string)
				}
				pendingCalls = append(pendingCalls, tc)
			case "function_call_output", "custom_tool_call_output":
				flushCalls()
				id, _ := it["call_id"].(string)
				out := ""
				switch o := it["output"].(type) {
				case string:
					out = o
				default:
					t, _, _ := responsesContentText(o)
					if t == "" {
						t = pcJSON(o)
					}
					out = t
				}
				req.Messages = append(req.Messages, pcMsg{Role: "tool", ToolCallID: id, Content: out})
			}
			// reasoning / web_search_call / … items have no chat equivalent: dropped.
		}
	}
	flushCalls()
	tools, _ := in["tools"].([]any)
	for _, raw := range tools {
		tm, _ := raw.(map[string]any)
		name, _ := tm["name"].(string)
		desc, _ := tm["description"].(string)
		switch tm["type"] {
		case "function":
			req.Tools = append(req.Tools, pcFuncTool(name, desc, tm["parameters"]))
		case "custom":
			custom[name] = true
			req.Tools = append(req.Tools, pcFuncTool(name, desc+"\nPut the full raw input in the `input` string.",
				map[string]any{"type": "object", "properties": map[string]any{"input": map[string]any{"type": "string"}}, "required": []string{"input"}}))
		}
	}
	if s, ok := in["tool_choice"].(string); ok && len(req.Tools) > 0 && (s == "required" || s == "none") {
		req.ToolChoice = s
	}
	return req, custom
}

func (t protoConvTarget) handleResponses(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&in); err != nil {
		pcWriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	stream, _ := in["stream"].(bool)
	req, custom := responsesToChat(in)
	respID := fmt.Sprintf("resp_conv_%d", time.Now().UnixNano())
	sse := &pcSSE{w: w}
	seq := 0
	emit := func(typ string, v map[string]any) {
		if !stream {
			return
		}
		v["type"] = typ
		v["sequence_number"] = seq
		seq++
		sse.event(typ, v)
	}
	base := map[string]any{"id": respID, "object": "response", "created_at": time.Now().Unix(),
		"model": req.Model, "status": "in_progress", "output": []any{}}
	created := false
	startResp := func() {
		if !created {
			created = true
			emit("response.created", map[string]any{"response": base})
		}
	}

	type item struct {
		kind  string
		id    string
		text  strings.Builder
		call  string
		name  string
		args  strings.Builder
		index int
	}
	var items []*item
	var curText *item
	toolByIdx := map[int]*item{}
	inTok, outTok := 0, 0
	finishItem := func(it *item) map[string]any {
		if it.kind == "message" {
			return map[string]any{"type": "message", "id": it.id, "status": "completed", "role": "assistant",
				"content": []any{map[string]any{"type": "output_text", "text": it.text.String(), "annotations": []any{}}}}
		}
		if custom[it.name] {
			return map[string]any{"type": "custom_tool_call", "id": it.id, "status": "completed", "call_id": it.call,
				"name": it.name, "input": fmt.Sprint(pcArgs(it.args.String())["input"])}
		}
		return map[string]any{"type": "function_call", "id": it.id, "status": "completed", "call_id": it.call,
			"name": it.name, "arguments": it.args.String()}
	}
	closeText := func() {
		if curText == nil {
			return
		}
		emit("response.output_text.done", map[string]any{"item_id": curText.id, "output_index": curText.index, "content_index": 0, "text": curText.text.String()})
		emit("response.content_part.done", map[string]any{"item_id": curText.id, "output_index": curText.index, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": curText.text.String(), "annotations": []any{}}})
		emit("response.output_item.done", map[string]any{"output_index": curText.index, "item": finishItem(curText)})
		curText = nil
	}
	ev := &upstreamEvents{
		text: func(s string) {
			startResp()
			if curText == nil {
				curText = &item{kind: "message", id: fmt.Sprintf("msg_%d", len(items)), index: len(items)}
				items = append(items, curText)
				emit("response.output_item.added", map[string]any{"output_index": curText.index, "item": map[string]any{
					"type": "message", "id": curText.id, "status": "in_progress", "role": "assistant", "content": []any{}}})
				emit("response.content_part.added", map[string]any{"item_id": curText.id, "output_index": curText.index, "content_index": 0,
					"part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}}})
			}
			curText.text.WriteString(s)
			emit("response.output_text.delta", map[string]any{"item_id": curText.id, "output_index": curText.index, "content_index": 0, "delta": s})
		},
		tool: func(i int, id, name, args string) {
			startResp()
			it := toolByIdx[i]
			if it == nil {
				closeText()
				if id == "" {
					id = fmt.Sprintf("call_conv_%d_%d", time.Now().UnixNano(), i)
				}
				it = &item{kind: "call", id: fmt.Sprintf("fc_%d", len(items)), call: id, name: name, index: len(items)}
				items = append(items, it)
				toolByIdx[i] = it
				typ := "function_call"
				if custom[name] {
					typ = "custom_tool_call"
				}
				emit("response.output_item.added", map[string]any{"output_index": it.index, "item": map[string]any{
					"type": typ, "id": it.id, "status": "in_progress", "call_id": it.call, "name": it.name, "arguments": ""}})
			}
			if args != "" {
				it.args.WriteString(args)
				if !custom[it.name] {
					emit("response.function_call_arguments.delta", map[string]any{"item_id": it.id, "output_index": it.index, "delta": args})
				}
			}
		},
		usage:  func(i, o int) { inTok, outTok = i, o },
		finish: func(string) {},
	}
	status, msg := t.callUpstream(r, req, ev)
	if status != 0 {
		if stream && sse.started {
			emit("response.failed", map[string]any{"response": map[string]any{"id": respID, "status": "failed",
				"error": map[string]any{"code": "upstream_error", "message": msg}}})
			return
		}
		pcWriteError(w, status, msg)
		return
	}
	startResp()
	closeText()
	output := []any{}
	for _, it := range items {
		done := finishItem(it)
		output = append(output, done)
		if it.kind == "call" {
			if !custom[it.name] {
				emit("response.function_call_arguments.done", map[string]any{"item_id": it.id, "output_index": it.index, "arguments": it.args.String()})
			}
			emit("response.output_item.done", map[string]any{"output_index": it.index, "item": done})
		}
	}
	final := map[string]any{"id": respID, "object": "response", "created_at": base["created_at"], "model": req.Model,
		"status": "completed", "output": output,
		"usage": map[string]any{"input_tokens": inTok, "output_tokens": outTok, "total_tokens": inTok + outTok,
			"input_tokens_details": map[string]any{"cached_tokens": 0}, "output_tokens_details": map[string]any{"reasoning_tokens": 0}}}
	if stream {
		emit("response.completed", map[string]any{"response": final})
		return
	}
	pcWriteJSON(w, final)
}

// ── Gemini generateContent ─────────────────────────────────────

// geminiSchema lower-cases Gemini's upper-case OpenAPI type names (OBJECT →
// object) so the schema is valid JSON Schema for the upstream.
func geminiSchema(v any) any {
	switch s := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(s))
		for k, val := range s {
			if k == "type" {
				if str, ok := val.(string); ok {
					out[k] = strings.ToLower(str)
					continue
				}
			}
			out[k] = geminiSchema(val)
		}
		return out
	case []any:
		out := make([]any, len(s))
		for i, val := range s {
			out[i] = geminiSchema(val)
		}
		return out
	}
	return v
}

func geminiToChat(in map[string]any, model string) pcReq {
	req := pcReq{Model: model}
	if si, ok := in["systemInstruction"].(map[string]any); ok {
		var sb strings.Builder
		parts, _ := si["parts"].([]any)
		for _, raw := range parts {
			p, _ := raw.(map[string]any)
			if s, ok := p["text"].(string); ok {
				sb.WriteString(s)
			}
		}
		if sb.Len() > 0 {
			req.Messages = append(req.Messages, pcMsg{Role: "system", Content: sb.String()})
		}
	}
	if gc, ok := in["generationConfig"].(map[string]any); ok {
		if v, ok := gc["maxOutputTokens"].(float64); ok {
			req.MaxTokens = int(v)
		}
		if v, ok := gc["temperature"].(float64); ok {
			req.Temperature = &v
		}
		if v, ok := gc["topP"].(float64); ok {
			req.TopP = &v
		}
	}
	pending := map[string][]string{} // function name → unanswered call ids (FIFO)
	callN := 0
	contents, _ := in["contents"].([]any)
	for _, raw := range contents {
		c, _ := raw.(map[string]any)
		role, _ := c["role"].(string)
		parts, _ := c["parts"].([]any)
		var text strings.Builder
		var images []map[string]any
		var calls []pcToolCall
		var toolMsgs []pcMsg
		for _, rp := range parts {
			p, _ := rp.(map[string]any)
			if thought, _ := p["thought"].(bool); thought {
				continue
			}
			if s, ok := p["text"].(string); ok {
				text.WriteString(s)
			}
			if d, ok := p["inlineData"].(map[string]any); ok {
				images = append(images, map[string]any{"type": "image_url", "image_url": map[string]any{
					"url": fmt.Sprintf("data:%v;base64,%v", d["mimeType"], d["data"])}})
			}
			if fc, ok := p["functionCall"].(map[string]any); ok {
				var tc pcToolCall
				tc.ID, _ = fc["id"].(string)
				if tc.ID == "" {
					callN++
					tc.ID = fmt.Sprintf("call_g%d", callN)
				}
				tc.Type = "function"
				tc.Func.Name, _ = fc["name"].(string)
				tc.Func.Arguments = pcJSON(fc["args"])
				pending[tc.Func.Name] = append(pending[tc.Func.Name], tc.ID)
				calls = append(calls, tc)
			}
			if fr, ok := p["functionResponse"].(map[string]any); ok {
				name, _ := fr["name"].(string)
				id, _ := fr["id"].(string)
				if q := pending[name]; len(q) > 0 {
					if id == "" {
						id = q[0]
					}
					pending[name] = q[1:]
				}
				toolMsgs = append(toolMsgs, pcMsg{Role: "tool", ToolCallID: id, Content: pcJSON(fr["response"])})
			}
		}
		if role == "model" {
			msg := pcMsg{Role: "assistant", ToolCalls: calls}
			if text.Len() > 0 {
				msg.Content = text.String()
			}
			if text.Len() > 0 || len(calls) > 0 {
				req.Messages = append(req.Messages, msg)
			}
			continue
		}
		req.Messages = append(req.Messages, toolMsgs...)
		if len(images) > 0 {
			content := append([]map[string]any{{"type": "text", "text": text.String()}}, images...)
			req.Messages = append(req.Messages, pcMsg{Role: "user", Content: content})
		} else if text.Len() > 0 {
			req.Messages = append(req.Messages, pcMsg{Role: "user", Content: text.String()})
		}
	}
	tools, _ := in["tools"].([]any)
	for _, raw := range tools {
		tm, _ := raw.(map[string]any)
		decls, _ := tm["functionDeclarations"].([]any)
		for _, rd := range decls {
			d, _ := rd.(map[string]any)
			name, _ := d["name"].(string)
			desc, _ := d["description"].(string)
			params := d["parametersJsonSchema"]
			if params == nil {
				params = geminiSchema(d["parameters"])
			}
			req.Tools = append(req.Tools, pcFuncTool(name, desc, params))
		}
	}
	return req
}

func geminiFinish(f string) string {
	switch f {
	case "length":
		return "MAX_TOKENS"
	default:
		return "STOP"
	}
}

func (t protoConvTarget) handleGemini(w http.ResponseWriter, r *http.Request, stream bool) {
	var in map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&in); err != nil {
		pcWriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	// /v1beta/models/<model>:streamGenerateContent
	model := r.URL.Path
	if i := strings.LastIndex(model, "/models/"); i >= 0 {
		model = model[i+len("/models/"):]
	}
	model, _, _ = strings.Cut(model, ":")
	req := geminiToChat(in, model)
	sse := &pcSSE{w: w}
	var text strings.Builder
	type call struct {
		id, name string
		args     strings.Builder
	}
	calls := map[int]*call{}
	var order []int
	inTok, outTok := 0, 0
	finish := ""
	usage := func() map[string]any {
		return map[string]any{"promptTokenCount": inTok, "candidatesTokenCount": outTok, "totalTokenCount": inTok + outTok}
	}
	ev := &upstreamEvents{
		text: func(s string) {
			text.WriteString(s)
			if stream {
				sse.event("", map[string]any{"candidates": []any{map[string]any{"index": 0,
					"content": map[string]any{"role": "model", "parts": []any{map[string]any{"text": s}}}}}, "modelVersion": model})
			}
		},
		tool: func(i int, id, name, args string) {
			c := calls[i]
			if c == nil {
				c = &call{id: id, name: name}
				calls[i] = c
				order = append(order, i)
			}
			c.args.WriteString(args)
		},
		usage:  func(i, o int) { inTok, outTok = i, o },
		finish: func(f string) { finish = f },
	}
	status, msg := t.callUpstream(r, req, ev)
	if status != 0 {
		if stream && sse.started {
			sse.event("", map[string]any{"error": map[string]any{"code": status, "message": msg, "status": "UNAVAILABLE"}})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": status, "message": msg}})
		return
	}
	var callParts []any
	for _, i := range order {
		c := calls[i]
		fc := map[string]any{"name": c.name, "args": pcArgs(c.args.String())}
		if c.id != "" {
			fc["id"] = c.id
		}
		callParts = append(callParts, map[string]any{"functionCall": fc})
	}
	if stream {
		parts := callParts
		if parts == nil {
			parts = []any{map[string]any{"text": ""}}
		}
		sse.event("", map[string]any{"candidates": []any{map[string]any{"index": 0, "finishReason": geminiFinish(finish),
			"content": map[string]any{"role": "model", "parts": parts}}}, "usageMetadata": usage(), "modelVersion": model})
		return
	}
	parts := []any{}
	if text.Len() > 0 {
		parts = append(parts, map[string]any{"text": text.String()})
	}
	parts = append(parts, callParts...)
	pcWriteJSON(w, map[string]any{"candidates": []any{map[string]any{"index": 0, "finishReason": geminiFinish(finish),
		"content": map[string]any{"role": "model", "parts": parts}}}, "usageMetadata": usage(), "modelVersion": model})
}
