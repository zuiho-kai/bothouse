package core

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeChatUpstream streams a chat completion: text "Hel"+"lo", then (if tool) a tool call
// split over two chunks. It records the last request body.
type fakeChatUpstream struct {
	mu   sync.Mutex
	last map[string]any
	auth string
	tool bool
	srv  *httptest.Server
}

func newFakeChatUpstream(t *testing.T, tool bool) *fakeChatUpstream {
	f := &fakeChatUpstream{tool: tool}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.last, f.auth = body, r.Header.Get("Authorization")
		f.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		send := func(v any) {
			b, _ := json.Marshal(v)
			fmt.Fprintf(w, "data: %s\n\n", b)
		}
		delta := func(d map[string]any, finish any) map[string]any {
			return map[string]any{"choices": []any{map[string]any{"index": 0, "delta": d, "finish_reason": finish}}}
		}
		send(delta(map[string]any{"role": "assistant", "content": "Hel"}, nil))
		send(delta(map[string]any{"content": "lo"}, nil))
		finish := "stop"
		if f.tool {
			send(delta(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call_1", "type": "function",
				"function": map[string]any{"name": "read_file", "arguments": `{"pa`}}}}, nil))
			send(delta(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": `th":"a.txt"}`}}}}, nil))
			finish = "tool_calls"
		}
		send(delta(map[string]any{}, finish))
		send(map[string]any{"choices": []any{}, "usage": map[string]any{"prompt_tokens": 11, "completion_tokens": 7}})
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeChatUpstream) lastReq() map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.last
}

func post(t *testing.T, url string, body any) (*http.Response, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(out)
}

// sseEvents parses "event:"/"data:" pairs.
func sseEvents(s string) []map[string]any {
	var out []map[string]any
	sc := bufio.NewScanner(strings.NewReader(s))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "data: ") {
			var m map[string]any
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &m) == nil {
				out = append(out, m)
			}
		}
	}
	return out
}

func TestProtoConvAnthropicStreamWithTools(t *testing.T) {
	up := newFakeChatUpstream(t, true)
	conv := httptest.NewServer(NewProtoConvHandler(up.srv.URL+"/v1", "sk-real", "qwen3-0.6b"))
	defer conv.Close()
	resp, body := post(t, conv.URL+"/v1/messages", map[string]any{
		"model": "claude-sonnet-4-6", "max_tokens": 100, "stream": true,
		"system": []any{map[string]any{"type": "text", "text": "You are Ju."}},
		"messages": []any{
			map[string]any{"role": "user", "content": "read a.txt"},
			map[string]any{"role": "assistant", "content": []any{
				map[string]any{"type": "text", "text": "ok"},
				map[string]any{"type": "tool_use", "id": "toolu_0", "name": "read_file", "input": map[string]any{"path": "b.txt"}}}},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "tool_result", "tool_use_id": "toolu_0", "content": "B!"},
				map[string]any{"type": "text", "text": "now a.txt"}}},
		},
		"tools": []any{map[string]any{"name": "read_file", "description": "read", "input_schema": map[string]any{"type": "object"}},
			map[string]any{"type": "web_search_20250305", "name": "web_search"}},
	})
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "event-stream") {
		t.Fatalf("status %d %s", resp.StatusCode, body)
	}
	// upstream request
	req := up.lastReq()
	if up.auth != "Bearer sk-real" || req["model"] != "qwen3-0.6b" || req["stream"] != true {
		t.Errorf("upstream req model=%v auth=%q", req["model"], up.auth)
	}
	msgs := req["messages"].([]any)
	roles := []string{}
	for _, m := range msgs {
		roles = append(roles, m.(map[string]any)["role"].(string))
	}
	if strings.Join(roles, ",") != "system,user,assistant,tool,user" {
		t.Errorf("roles = %v", roles)
	}
	asst := msgs[2].(map[string]any)
	if asst["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)["arguments"] != `{"path":"b.txt"}` {
		t.Errorf("assistant tool call = %v", asst)
	}
	if tm := msgs[3].(map[string]any); tm["tool_call_id"] != "toolu_0" || tm["content"] != "B!" {
		t.Errorf("tool msg = %v", tm)
	}
	if n := len(req["tools"].([]any)); n != 1 {
		t.Errorf("server tools must be dropped, got %d tools", n)
	}
	// response events
	evs := sseEvents(body)
	var types []string
	text, args := "", ""
	stop := ""
	for _, e := range evs {
		types = append(types, e["type"].(string))
		if d, ok := e["delta"].(map[string]any); ok {
			if d["type"] == "text_delta" {
				text += d["text"].(string)
			}
			if d["type"] == "input_json_delta" {
				args += d["partial_json"].(string)
			}
			if s, ok := d["stop_reason"].(string); ok {
				stop = s
			}
		}
	}
	if types[0] != "message_start" || types[len(types)-1] != "message_stop" {
		t.Errorf("event order = %v", types)
	}
	if text != "Hello" || args != `{"path":"a.txt"}` || stop != "tool_use" {
		t.Errorf("text=%q args=%q stop=%q", text, args, stop)
	}
	if !strings.Contains(body, `"input_tokens":11`) || !strings.Contains(body, `"output_tokens":7`) {
		t.Errorf("usage missing: %s", body)
	}
}

func TestProtoConvAnthropicNonStream(t *testing.T) {
	up := newFakeChatUpstream(t, false)
	conv := httptest.NewServer(NewProtoConvHandler(up.srv.URL+"/v1", "", ""))
	defer conv.Close()
	_, body := post(t, conv.URL+"/v1/messages", map[string]any{"model": "m", "max_tokens": 5,
		"messages": []any{map[string]any{"role": "user", "content": "hi"}}})
	var out map[string]any
	_ = json.Unmarshal([]byte(body), &out)
	c := out["content"].([]any)[0].(map[string]any)
	if c["text"] != "Hello" || out["stop_reason"] != "end_turn" || out["type"] != "message" {
		t.Fatalf("non-stream = %s", body)
	}
	if up.lastReq()["model"] != "m" {
		t.Errorf("empty forced model must pass the CLI's model through")
	}
	_, body = post(t, conv.URL+"/v1/messages/count_tokens", map[string]any{"messages": []any{}})
	if !strings.Contains(body, "input_tokens") {
		t.Errorf("count_tokens = %s", body)
	}
}

func TestProtoConvResponsesStream(t *testing.T) {
	up := newFakeChatUpstream(t, true)
	conv := httptest.NewServer(NewProtoConvHandler(up.srv.URL+"/v1", "k", "deepseek-chat"))
	defer conv.Close()
	_, body := post(t, conv.URL+"/v1/responses", map[string]any{
		"model": "gpt-5", "stream": true, "instructions": "be brief",
		"input": []any{
			map[string]any{"type": "message", "role": "developer", "content": []any{map[string]any{"type": "input_text", "text": "dev note"}}},
			map[string]any{"type": "message", "role": "user", "content": []any{map[string]any{"type": "input_text", "text": "hi"}}},
			map[string]any{"type": "function_call", "call_id": "c0", "name": "shell", "arguments": `{"cmd":"ls"}`},
			map[string]any{"type": "function_call_output", "call_id": "c0", "output": "a.txt"},
			map[string]any{"type": "custom_tool_call", "call_id": "c1", "name": "apply_patch", "input": "*** Begin Patch"},
			map[string]any{"type": "custom_tool_call_output", "call_id": "c1", "output": "done"},
			map[string]any{"type": "reasoning", "summary": []any{}},
		},
		"tools": []any{
			map[string]any{"type": "function", "name": "read_file", "parameters": map[string]any{"type": "object"}},
			map[string]any{"type": "custom", "name": "apply_patch", "description": "patch"},
			map[string]any{"type": "web_search"},
		},
	})
	req := up.lastReq()
	msgs := req["messages"].([]any)
	var roles []string
	for _, m := range msgs {
		roles = append(roles, m.(map[string]any)["role"].(string))
	}
	if strings.Join(roles, ",") != "system,system,user,assistant,tool,assistant,tool" {
		t.Errorf("roles = %v", roles)
	}
	if args := msgs[5].(map[string]any)["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)["arguments"]; args != `{"input":"*** Begin Patch"}` {
		t.Errorf("custom tool call history = %v", args)
	}
	if n := len(req["tools"].([]any)); n != 2 {
		t.Errorf("tools = %d, want function + custom", n)
	}
	evs := sseEvents(body)
	var types []string
	var completed map[string]any
	text := ""
	for _, e := range evs {
		types = append(types, e["type"].(string))
		if e["type"] == "response.output_text.delta" {
			text += e["delta"].(string)
		}
		if e["type"] == "response.completed" {
			completed = e["response"].(map[string]any)
		}
	}
	if types[0] != "response.created" || types[len(types)-1] != "response.completed" || text != "Hello" {
		t.Fatalf("events=%v text=%q", types, text)
	}
	out := completed["output"].([]any)
	if len(out) != 2 || out[0].(map[string]any)["type"] != "message" {
		t.Fatalf("output = %v", out)
	}
	fc := out[1].(map[string]any)
	if fc["type"] != "function_call" || fc["call_id"] != "call_1" || fc["arguments"] != `{"path":"a.txt"}` {
		t.Errorf("function_call = %v", fc)
	}
	if u := completed["usage"].(map[string]any); u["input_tokens"].(float64) != 11 || u["total_tokens"].(float64) != 18 {
		t.Errorf("usage = %v", u)
	}
}

func TestProtoConvGeminiStream(t *testing.T) {
	up := newFakeChatUpstream(t, true)
	conv := httptest.NewServer(NewProtoConvHandler(up.srv.URL+"/v1", "k", "m"))
	defer conv.Close()
	resp, body := post(t, conv.URL+"/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse", map[string]any{
		"systemInstruction": map[string]any{"parts": []any{map[string]any{"text": "sys"}}},
		"contents": []any{
			map[string]any{"role": "user", "parts": []any{map[string]any{"text": "list"}}},
			map[string]any{"role": "model", "parts": []any{map[string]any{"functionCall": map[string]any{"name": "ls", "args": map[string]any{"dir": "."}}}}},
			map[string]any{"role": "user", "parts": []any{map[string]any{"functionResponse": map[string]any{"name": "ls", "response": map[string]any{"output": "a.txt"}}}}},
		},
		"tools": []any{map[string]any{"functionDeclarations": []any{map[string]any{"name": "ls",
			"parameters": map[string]any{"type": "OBJECT", "properties": map[string]any{"dir": map[string]any{"type": "STRING"}}}}}}},
		"generationConfig": map[string]any{"maxOutputTokens": 50},
	})
	if resp.StatusCode != 200 {
		t.Fatalf("status %d %s", resp.StatusCode, body)
	}
	req := up.lastReq()
	msgs := req["messages"].([]any)
	call := msgs[2].(map[string]any)["tool_calls"].([]any)[0].(map[string]any)
	tool := msgs[3].(map[string]any)
	if tool["role"] != "tool" || tool["tool_call_id"] != call["id"] {
		t.Errorf("functionResponse not paired with call: %v / %v", call, tool)
	}
	params := req["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)["parameters"].(map[string]any)
	if params["type"] != "object" || params["properties"].(map[string]any)["dir"].(map[string]any)["type"] != "string" {
		t.Errorf("schema types not lower-cased: %v", params)
	}
	if req["max_tokens"].(float64) != 50 {
		t.Errorf("max tokens = %v", req["max_tokens"])
	}
	evs := sseEvents(body)
	text := ""
	var last map[string]any
	for _, e := range evs {
		cand := e["candidates"].([]any)[0].(map[string]any)
		for _, p := range cand["content"].(map[string]any)["parts"].([]any) {
			if s, ok := p.(map[string]any)["text"].(string); ok {
				text += s
			}
		}
		last = cand
	}
	if text != "Hello" || last["finishReason"] != "STOP" {
		t.Fatalf("text=%q last=%v", text, last)
	}
	fc := last["content"].(map[string]any)["parts"].([]any)[0].(map[string]any)["functionCall"].(map[string]any)
	if fc["name"] != "read_file" || fc["args"].(map[string]any)["path"] != "a.txt" {
		t.Errorf("functionCall = %v", fc)
	}
	// non-streaming generateContent
	_, body = post(t, conv.URL+"/v1beta/models/x:generateContent", map[string]any{"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "hi"}}}}})
	if !strings.Contains(body, `"text":"Hello"`) || !strings.Contains(body, `"promptTokenCount":11`) {
		t.Errorf("generateContent = %s", body)
	}
}

func TestProtoConvUpstreamError(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":"bad key"}`))
	}))
	defer bad.Close()
	conv := httptest.NewServer(NewProtoConvHandler(bad.URL, "k", "m"))
	defer conv.Close()
	resp, body := post(t, conv.URL+"/v1/messages", map[string]any{"messages": []any{}, "stream": true})
	if resp.StatusCode != 401 || !strings.Contains(body, "bad key") {
		t.Fatalf("status %d body %s", resp.StatusCode, body)
	}
}

func TestForProtocolRoutesThroughSharedConverter(t *testing.T) {
	up := newFakeChatUpstream(t, false)
	p := ProviderConfig{Name: "x", BaseURL: up.srv.URL + "/v1", APIKey: "sk-real", Model: "qwen", APIFormat: APIFormatOpenAIChat, Thinking: "disabled"}
	if same := (ProviderConfig{BaseURL: "https://a", APIKey: "k"}).ForProtocol(ProtocolAnthropic); same.BaseURL != "https://a" {
		t.Fatal("native provider must be unchanged")
	}
	if same := p.ForProtocol(ProtocolOpenAIChat); same.BaseURL != p.BaseURL {
		t.Fatal("openai-chat CLI must use upstream directly")
	}
	a := p.ForProtocol(ProtocolAnthropic)
	if !strings.HasPrefix(a.BaseURL, "http://127.0.0.1:") || a.APIKey == "sk-real" || a.Thinking != "" {
		t.Fatalf("anthropic view = %+v", a)
	}
	r := p.ForProtocol(ProtocolResponses)
	if !strings.HasSuffix(r.BaseURL, "/v1") || r.CodexWireAPI != "responses" {
		t.Fatalf("responses view = %+v", r)
	}
	_, body := post(t, a.BaseURL+"/v1/messages", map[string]any{"messages": []any{map[string]any{"role": "user", "content": "hi"}}})
	if !strings.Contains(body, "Hello") || up.auth != "Bearer sk-real" {
		t.Fatalf("through shared converter: %s auth=%q", body, up.auth)
	}
	_, body = post(t, r.BaseURL+"/responses", map[string]any{"input": "hi"})
	if !strings.Contains(body, `"status":"completed"`) {
		t.Fatalf("responses through shared converter: %s", body)
	}
}

// M1: an upstream that dies mid-stream must reach the CLI as an error, not as end_turn.
func TestProtoConvUpstreamInterrupted(t *testing.T) {
	for _, mode := range []string{"hijack", "no-done"} {
		up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, `data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}`+"\n\n")
			w.(http.Flusher).Flush()
			if mode == "hijack" {
				conn, _, _ := w.(http.Hijacker).Hijack()
				conn.Close() // connection drops mid-stream
			}
			// "no-done": handler returns without finish_reason or [DONE]
		}))
		conv := httptest.NewServer(NewProtoConvHandler(up.URL, "k", "m"))
		_, body := post(t, conv.URL+"/v1/messages", map[string]any{"stream": true, "messages": []any{map[string]any{"role": "user", "content": "hi"}}})
		if !strings.Contains(body, `"type":"error"`) || strings.Contains(body, "message_stop") || strings.Contains(body, "end_turn") {
			t.Errorf("%s: interrupted stream must end in an error event:\n%s", mode, body)
		}
		_, body = post(t, conv.URL+"/v1/responses", map[string]any{"stream": true, "input": "hi"})
		if !strings.Contains(body, "response.failed") || strings.Contains(body, "response.completed") {
			t.Errorf("%s: responses must fail:\n%s", mode, body)
		}
		conv.Close()
		up.Close()
	}
}

// M1: once the stream has started, silence longer than protoConvIdle ends it with an error.
func TestProtoConvIdleTimeout(t *testing.T) {
	old := protoConvIdle
	protoConvIdle = 150 * time.Millisecond
	defer func() { protoConvIdle = old }()
	release := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}`+"\n\n")
		w.(http.Flusher).Flush()
		select { // then nothing
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer up.Close()
	defer close(release)
	conv := httptest.NewServer(NewProtoConvHandler(up.URL, "k", "m"))
	defer conv.Close()
	start := time.Now()
	_, body := post(t, conv.URL+"/v1/messages", map[string]any{"stream": true, "messages": []any{map[string]any{"role": "user", "content": "hi"}}})
	if !strings.Contains(body, `"type":"error"`) || time.Since(start) > 3*time.Second {
		t.Fatalf("idle stream must end in an error quickly (%v):\n%s", time.Since(start), body)
	}
}
