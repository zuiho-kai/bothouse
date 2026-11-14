package qq

// Issue #819: real ACP stdio adapter -> real Engine -> real QQ WebSocket.
// Only the ACP subprocess and OneBot peer are synthetic. Media can use the
// deployed tool's local /send API or an ACP agent_message_chunk image block.
import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/agent/acp"
	"github.com/chenhg5/cc-connect/core"
)

type qqACPScript struct {
	Text            string
	Error           string
	Disconnect      bool
	Tool            bool
	ImageData       []byte
	NativeImageData []byte
	StopReason      string
}

type qqACPTurn struct {
	Key     string
	Session string
	Prompt  string
	Script  chan qqACPScript
}

// Run this test binary as the fake ACP server. Each process serves one real
// adapter session; HTTP gates let the parent hold model responses indefinitely
// without sleeps. The scanner remains available for session/cancel.
func TestQQFaultACPProcess(t *testing.T) {
	if os.Getenv("QQ_FAULT_ACP") == "" {
		return
	}
	ctx, stop := context.WithTimeout(context.Background(), 30*time.Second)
	defer stop()
	enc := json.NewEncoder(os.Stdout)
	var outMu, turnMu sync.Mutex
	var turns sync.WaitGroup
	var cancelTurn context.CancelFunc
	emit := func(v any) { outMu.Lock(); defer outMu.Unlock(); _ = enc.Encode(v) }
	update := func(v any) {
		emit(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "qq-fi", "update": v}})
	}
	reply := func(id json.RawMessage, result any) {
		emit(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	}
	client := &http.Client{Timeout: 20 * time.Second}
	defer client.CloseIdleConnections()
	scan := bufio.NewScanner(os.Stdin)
	for scan.Scan() {
		var req map[string]json.RawMessage
		if json.Unmarshal(scan.Bytes(), &req) != nil {
			os.Exit(2)
		}
		var method string
		_ = json.Unmarshal(req["method"], &method)
		id := append(json.RawMessage(nil), req["id"]...)
		switch method {
		case "initialize":
			reply(id, map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}})
		case "session/new":
			reply(id, map[string]any{"sessionId": "qq-fi"})
		case "session/cancel":
			turnMu.Lock()
			if cancelTurn != nil {
				cancelTurn()
			}
			turnMu.Unlock()
			r, _ := client.Post(os.Getenv("QQ_FAULT_CONTROL")+"/cancel", "text/plain", strings.NewReader(os.Getenv("CC_SESSION_KEY")))
			if r != nil {
				_ = r.Body.Close()
			}
		case "session/prompt":
			var params struct{ Prompt []struct{ Text string } }
			_ = json.Unmarshal(req["params"], &params)
			var prompt strings.Builder
			for _, block := range params.Prompt {
				prompt.WriteString(block.Text)
			}
			turnCtx, cancel := context.WithCancel(ctx)
			turnMu.Lock()
			cancelTurn = cancel
			turnMu.Unlock()
			turns.Add(1)
			go func(id json.RawMessage, text string) {
				defer turns.Done()
				defer cancel()
				payload := map[string]string{"Key": os.Getenv("CC_SESSION_KEY"), "Session": fmt.Sprint(os.Getpid()), "Prompt": text}
				body, _ := json.Marshal(payload)
				request, _ := http.NewRequestWithContext(turnCtx, http.MethodPost, os.Getenv("QQ_FAULT_CONTROL")+"/turn", bytes.NewReader(body))
				resp, err := client.Do(request)
				if err != nil {
					reply(id, map[string]any{"stopReason": "cancelled"})
					return
				}
				var script qqACPScript
				err = json.NewDecoder(resp.Body).Decode(&script)
				_ = resp.Body.Close()
				if err != nil {
					os.Exit(2)
				}
				if script.Tool || len(script.ImageData) > 0 {
					update(map[string]any{"sessionUpdate": "tool_call", "toolCallId": "side-effect", "title": "send_image", "status": "in_progress"})
				}
				if len(script.ImageData) > 0 {
					send, _ := json.Marshal(core.SendRequest{Project: os.Getenv("CC_PROJECT"), SessionKey: os.Getenv("CC_SESSION_KEY"), Images: []core.ImageAttachment{{MimeType: "image/png", Data: script.ImageData}}})
					tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
						return (&net.Dialer{}).DialContext(ctx, "unix", os.Getenv("QQ_FAULT_SOCKET"))
					}}
					mediaClient := &http.Client{Transport: tr, Timeout: 3 * time.Second}
					request, _ := http.NewRequestWithContext(turnCtx, http.MethodPost, "http://local/send", bytes.NewReader(send))
					sent, err := mediaClient.Do(request)
					if err != nil {
						os.Exit(2)
					}
					_, _ = io.Copy(io.Discard, sent.Body)
					_ = sent.Body.Close()
					tr.CloseIdleConnections()
					if sent.StatusCode != http.StatusOK {
						os.Exit(2)
					}
					update(map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "side-effect", "status": "completed"})
				}
				if script.Disconnect {
					os.Exit(0)
				}
				if script.Error != "" {
					emit(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32000, "message": script.Error}})
					return
				}
				if len(script.NativeImageData) > 0 {
					// ACP v1 Content: image data is base64, with an explicit MIME type.
					// https://agentclientprotocol.com/protocol/v1/content#image-content
					update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{
						"type": "image", "mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(script.NativeImageData),
					}})
				}
				if script.Text != "" {
					update(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": script.Text}})
				}
				ending := script.StopReason
				if ending == "" {
					ending = "end_turn"
				}
				reply(id, map[string]any{"stopReason": ending})
			}(id, prompt.String())
		default:
			if len(id) > 0 {
				reply(id, map[string]any{})
			}
		}
	}
	stop()
	turns.Wait()
	os.Exit(0)
}

type qqACPHarness struct {
	t         *testing.T
	engine    *core.Engine
	upstream  *faultUpstream
	turns     chan *qqACPTurn
	cancelled chan string
}

func newQQACPHarness(t *testing.T) *qqACPHarness {
	t.Helper()
	h := &qqACPHarness{t: t, upstream: newFaultUpstream(t), turns: make(chan *qqACPTurn), cancelled: make(chan string, 1)}
	done := make(chan struct{})
	control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cancel" {
			data, _ := io.ReadAll(r.Body)
			select {
			case h.cancelled <- string(data):
			case <-r.Context().Done():
			case <-done:
			}
			return
		}
		var call qqACPTurn
		// Decode only serializable fields; a channel cannot be decoded by JSON.
		var wire struct{ Key, Session, Prompt string }
		if json.NewDecoder(r.Body).Decode(&wire) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		call.Key, call.Session, call.Prompt = wire.Key, wire.Session, wire.Prompt
		call.Script = make(chan qqACPScript, 1)
		select {
		case h.turns <- &call:
		case <-r.Context().Done():
			return
		case <-done:
			return
		}
		select {
		case script := <-call.Script:
			_ = json.NewEncoder(w).Encode(script)
		case <-r.Context().Done():
		case <-done:
		}
	}))
	t.Cleanup(func() { close(done); control.Close() })
	// Not t.TempDir(): on macOS its path ($TMPDIR + test name + random suffix) plus run/api.sock
	// can pass the ~104-byte unix socket limit, and bind then fails with "invalid argument".
	dir, err := os.MkdirTemp("", "qqacp")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	api, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := acp.New(map[string]any{"cmd": os.Args[0], "args": []string{"-test.run=^TestQQFaultACPProcess$", "-test.timeout=30s"}, "work_dir": dir,
		"env": map[string]string{"QQ_FAULT_ACP": "1", "QQ_FAULT_CONTROL": control.URL, "QQ_FAULT_SOCKET": api.SocketPath()}})
	if err != nil {
		api.Stop()
		t.Fatal(err)
	}
	// Source: existing share_session_in_channel setting; exercise the shared busy-group path.
	p := &Platform{shareSessionInChannel: true, wsURL: "ws" + strings.TrimPrefix(h.upstream.ts.URL, "http")}
	h.engine = core.NewEngine("qq-fi", agent, []core.Platform{p}, filepath.Join(dir, "sessions.json"), core.LangEnglish)
	h.engine.SetDataDir(dir)
	h.engine.SetDisplayConfig(core.DisplayCfg{Mode: "compact"})
	h.engine.SetReplyFooterEnabled(false)
	h.engine.SetStreamPreviewCfg(core.StreamPreviewCfg{Enabled: false})
	h.engine.SetChannelBoard(false)
	api.RegisterEngine("qq-fi", h.engine)
	api.Start()
	t.Cleanup(func() {
		_ = h.engine.Stop()
		api.Stop()
		t.Log("engine workers and ACP processes joined; local API socket closed")
	})
	if err := h.engine.Start(); err != nil {
		t.Fatal(err)
	}
	return h
}

func (h *qqACPHarness) turn() *qqACPTurn {
	h.t.Helper()
	select {
	case turn := <-h.turns:
		return turn
	// Source: existing core rate-limit jitter can wait up to 15s before retry.
	case <-time.After(20 * time.Second):
		h.t.Fatal("ACP prompt was not reached")
		return nil
	}
}

func (h *qqACPHarness) wait(check func() bool, message string) {
	h.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	h.t.Fatal(message)
}

func (h *qqACPHarness) idle(key string) {
	h.t.Helper()
	h.wait(func() bool { return !h.engine.GetSessions().GetOrCreateActive(key).Busy() }, "turn did not drain")
}

func (h *qqACPHarness) output() string {
	h.upstream.mu.Lock()
	defer h.upstream.mu.Unlock()
	raw, _ := json.Marshal(h.upstream.sent)
	return string(raw)
}

func TestQQACP(t *testing.T) {
	t.Run("queue", func(t *testing.T) {
		h := newQQACPHarness(t)
		h.upstream.push(groupMessage(42, 111, 1, atSegment("10000"), textSegment("hold-model")))
		first := h.turn()
		// Source: existing engine defaultMaxQueuedMessages=5; exceed it with 6 @ messages.
		for n := int64(2); n <= 7; n++ {
			h.upstream.push(groupMessage(42, 111+n, n, atSegment("10000"), textSegment(fmt.Sprint("queued-", n))))
		}
		h.upstream.push(privateMessage(222, 20, textSegment("independent")))
		other := h.turn()
		if other.Key == first.Key || !strings.Contains(other.Prompt, "independent") {
			t.Fatal("slow model blocked or captured another sender", other.Key)
		}
		other.Script <- qqACPScript{Text: "independent-answer"}
		h.idle(other.Key)
		h.wait(func() bool { return h.upstream.count("send_group_msg") >= 6 }, "six pending group messages were not acknowledged")
		if !h.engine.GetSessions().GetOrCreateActive(first.Key).Busy() {
			t.Fatal("slow model was not held")
		}
		first.Script <- qqACPScript{Text: "slow-answer"}
		queued := h.turn()
		if queued.Key != first.Key {
			t.Fatal("queued group prompt changed target")
		}
		for n := 2; n <= 7; n++ {
			if !strings.Contains(queued.Prompt, fmt.Sprint("queued-", n)) {
				t.Fatalf("pending message %d lost from batch", n)
			}
		}
		queued.Script <- qqACPScript{Text: "queue-drained"}
		h.idle(first.Key)
		output := h.output()
		for _, want := range []string{"independent-answer", "slow-answer", "queue-drained"} {
			if !strings.Contains(output, want) {
				t.Fatal("missing", want, output)
			}
		}
		if strings.Contains(strings.ToLower(output), "queue is full") || strings.Contains(output, "消息队列已满") {
			t.Fatal("busy group rejected input", output)
		}
		t.Log("held ACP model; six pending @ messages preserved in one group batch; private sender completed before release")
	})
	t.Run("retry", func(t *testing.T) {
		h := newQQACPHarness(t)
		h.upstream.push(privateMessage(111, 1, textSegment("rate-before-tools")))
		first := h.turn()
		first.Script <- qqACPScript{Error: "429 Too Many Requests; Retry-After: 0"}
		retry := h.turn()
		if retry.Key != first.Key || !strings.Contains(retry.Prompt, "rate-before-tools") {
			t.Fatal("retry changed its owner or request")
		}
		retry.Script <- qqACPScript{Text: "one-core-retry-succeeded"}
		h.idle(retry.Key)
		if !strings.Contains(h.output(), "one-core-retry-succeeded") {
			t.Fatal("retry answer lost")
		}
		if h.upstream.count("send_private_msg") != 1 {
			t.Fatal("internal retry produced extra QQ messages", h.output())
		}
		t.Log("pre-tool 429 used existing core retry; adapter added no retry; one final QQ answer")
	})
	for _, name := range []string{"drop", "limit"} {
		t.Run(name, func(t *testing.T) {
			h := newQQACPHarness(t)
			h.upstream.push(privateMessage(111, 1, textSegment("fault")))
			turn := h.turn()
			script := qqACPScript{Tool: true}
			if name == "drop" {
				script.Disconnect = true
			} else {
				script.Error = "429 Too Many Requests; Retry-After: 0"
			}
			turn.Script <- script
			h.idle(turn.Key)
			select {
			case replay := <-h.turns:
				t.Fatal("post-tool ACP request replayed", replay.Key)
			default:
			}
			if h.upstream.count("send_private_msg") == 0 {
				t.Fatal("failure did not reach QQ")
			}
			h.upstream.push(privateMessage(111, 2, textSegment("after-failure")))
			next := h.turn()
			if !strings.Contains(next.Prompt, "after-failure") {
				t.Fatal("old failed request replayed", next.Prompt)
			}
			next.Script <- qqACPScript{Text: "recovered"}
			h.idle(next.Key)
			if !strings.Contains(h.output(), "recovered") {
				t.Fatal("next turn lost")
			}
			t.Log("ACP failure after tool event surfaced to QQ without replay; next user turn succeeded")
		})
	}
	t.Run("cancel", func(t *testing.T) {
		h := newQQACPHarness(t)
		h.upstream.push(privateMessage(111, 1, textSegment("hold-cancel")))
		first := h.turn()
		h.upstream.push(privateMessage(111, 2, textSegment("/stop")))
		select {
		case key := <-h.cancelled:
			if key != first.Key {
				t.Fatal("cancel crossed sessions", key)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("session/cancel not delivered")
		}
		h.idle(first.Key)
		first.Script <- qqACPScript{Text: "cancelled-answer-must-not-appear"}
		h.upstream.push(privateMessage(111, 3, textSegment("after-cancel")))
		next := h.turn()
		if next.Session != first.Session {
			t.Fatal("cancellation discarded the ACP process")
		}
		next.Script <- qqACPScript{Text: "after-cancel-answer"}
		h.idle(next.Key)
		output := h.output()
		if strings.Contains(output, "cancelled-answer-must-not-appear") || !strings.Contains(output, "after-cancel-answer") {
			t.Fatal("cancelled output leaked or next turn lost", output)
		}
		t.Log("QQ /stop -> ACP session/cancel; cancelled output suppressed; same process served next turn")
	})
	t.Run("media", func(t *testing.T) {
		h := newQQACPHarness(t)
		h.upstream.push(privateMessage(111, 1, textSegment("image-only-A")))
		first := h.turn()
		h.upstream.push(privateMessage(222, 2, textSegment("image-only-B")))
		second := h.turn()
		imageA := image.NewRGBA(image.Rect(0, 0, 1, 1))
		imageA.Set(0, 0, color.RGBA{R: 255, A: 255})
		imageB := image.NewRGBA(image.Rect(0, 0, 1, 1))
		imageB.Set(0, 0, color.RGBA{B: 255, A: 255})
		var pngA, pngB bytes.Buffer
		if err := png.Encode(&pngA, imageA); err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(&pngB, imageB); err != nil {
			t.Fatal(err)
		}
		first.Script <- qqACPScript{ImageData: pngA.Bytes(), Text: "NO_REPLY"}
		second.Script <- qqACPScript{ImageData: pngB.Bytes(), Text: "NO_REPLY"}
		h.idle(first.Key)
		h.idle(second.Key)
		h.upstream.mu.Lock()
		defer h.upstream.mu.Unlock()
		calls := h.upstream.sent["send_private_msg"]
		if len(calls) != 2 {
			t.Fatalf("media-only turns produced %d bubbles, want exactly 2 images: %s", len(calls), mustJSON(calls))
		}
		seen := map[int64]bool{}
		for _, call := range calls {
			raw := mustJSON(call["message"])
			if !strings.Contains(raw, "image") || strings.Contains(raw, "NO_REPLY") {
				t.Fatal("media became text", raw)
			}
			uid := jsonInt64(call, "user_id")
			expected := pngA.Bytes()
			if uid == 222 {
				expected = pngB.Bytes()
			}
			if !strings.Contains(raw, base64.StdEncoding.EncodeToString(expected)) {
				t.Fatal("another sender's image reached", uid, raw)
			}
			seen[uid] = true
		}
		if !seen[111] || !seen[222] {
			t.Fatal("images crossed conversations", seen)
		}
		t.Log("two ACP tools -> real local /send -> core -> two distinct QQ targets; no blank or fallback text")
	})
}

func mustJSON(v any) string { raw, _ := json.Marshal(v); return string(raw) }

// #1749: exercise the real ACP adapter, Engine, and QQ socket for the two
// previously untested media-only endings. Neither case relies on NO_REPLY.
func TestQQACPMediaOnly(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, img); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		script qqACPScript
	}{
		{"tool-empty", qqACPScript{ImageData: pngData.Bytes()}},
		{"native", qqACPScript{NativeImageData: pngData.Bytes()}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newQQACPHarness(t)
			h.upstream.push(privateMessage(111, 1, textSegment("return only the image")))
			turn := h.turn()
			turn.Script <- tc.script
			h.idle(turn.Key)
			h.upstream.mu.Lock()
			defer h.upstream.mu.Unlock()
			calls := h.upstream.sent["send_private_msg"]
			if len(calls) != 1 {
				t.Fatalf("media-only ACP turn produced %d bubbles, want exactly one image: %s", len(calls), mustJSON(calls))
			}
			call := calls[0]
			if uid := jsonInt64(call, "user_id"); uid != 111 {
				t.Fatalf("image went to user_id=%d, want 111", uid)
			}
			segments, ok := call["message"].([]any)
			if !ok || len(segments) != 1 {
				t.Fatalf("expected one image segment, got %s", mustJSON(call["message"]))
			}
			segment, _ := segments[0].(map[string]any)
			data, _ := segment["data"].(map[string]any)
			if segment["type"] != "image" || data["file"] != "base64://"+base64.StdEncoding.EncodeToString(pngData.Bytes()) {
				t.Fatalf("native/side-channel image was lost or replaced by text: %s", mustJSON(segments))
			}
		})
	}
}

// Media output must not turn a real empty/error result into success, and an
// uncertain image receipt must never cause the model prompt to be replayed.
func TestQQMediaErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		script qqACPScript
		reject bool
		want   string
	}{
		{"empty", qqACPScript{}, false, "no public answer"},
		{"tool-only", qqACPScript{Tool: true}, false, "no public answer"},
		{"cancelled", qqACPScript{Tool: true, NativeImageData: []byte("synthetic-image"), StopReason: "cancelled"}, false, "did not complete successfully"},
		{"receipt", qqACPScript{NativeImageData: []byte("synthetic-image")}, true, "retcode=1200"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newQQACPHarness(t)
			if tc.reject {
				h.upstream.mu.Lock()
				h.upstream.respond = func(_ string, n int) map[string]any {
					if n == 1 {
						return map[string]any{"status": "failed", "retcode": 1200, "message": "429 rate limit"}
					}
					return nil
				}
				h.upstream.mu.Unlock()
			}
			h.upstream.push(privateMessage(111, 1, textSegment("media result")))
			turn := h.turn()
			turn.Script <- tc.script
			h.idle(turn.Key)
			wantCalls := 1
			if tc.reject {
				wantCalls++ // the attempted image plus one visible delivery error
			}
			if got := h.upstream.count("send_private_msg"); got != wantCalls {
				t.Fatalf("got %d sends, want %d: %s", got, wantCalls, h.output())
			}
			if !strings.Contains(h.output(), tc.want) {
				t.Fatalf("failure was hidden: want %q in %s", tc.want, h.output())
			}
			if !tc.reject && strings.Contains(h.output(), "base64://") {
				t.Fatal("unsuccessful ACP prompt published an image", h.output())
			}
			select {
			case <-h.turns:
				t.Fatal("media/error turn was replayed")
			default:
			}
		})
	}
}
