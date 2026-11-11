package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ProviderProxy is a lightweight local reverse proxy that rewrites
// incompatible Anthropic API fields for third-party providers.
//
// Some providers (e.g. SiliconFlow) don't support thinking.type "adaptive"
// sent by Claude Code 2.x. The proxy rewrites the thinking field to
// the configured override value before forwarding.
type ProviderProxy struct {
	targetURL        string
	thinkingOverride string
	listener         net.Listener
	server           *http.Server
	once             sync.Once
}

// NewProviderProxy creates and starts a local reverse proxy for the
// given upstream URL. thinkingOverride controls what thinking.type to
// rewrite "adaptive" to (e.g. "disabled" or "enabled").
// Returns the local URL to use as ANTHROPIC_BASE_URL.
func NewProviderProxy(targetURL, thinkingOverride string) (*ProviderProxy, string, error) {
	return newProviderProxy(targetURL, thinkingOverride, false)
}

// NewSystemFoldProxy starts a proxy that turns role=system turns in the middle
// of the conversation into user turns (see foldSystemTurns). Local models
// served by llama.cpp / LM Studio reject them: the Qwen chat template raises
// "System message must be at the beginning".
func NewSystemFoldProxy(targetURL string) (*ProviderProxy, string, error) {
	return newProviderProxy(targetURL, "", true)
}

func newProviderProxy(targetURL, thinkingOverride string, foldSystem bool) (*ProviderProxy, string, error) {
	target, err := url.Parse(strings.TrimRight(targetURL, "/"))
	if err != nil {
		return nil, "", fmt.Errorf("providerproxy: parse target: %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, "", fmt.Errorf("providerproxy: listen: %w", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	origDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		origDirector(req)
		req.Host = target.Host
		// The proxy and its upstream are both on this machine: do not add
		// X-Forwarded-For. magpie treats a request carrying it as one from another
		// machine and answers 403 without a gateway key, which Claude Code shows
		// as "Not logged in" (#1455: DS workspaces through magpie). A nil entry
		// tells ReverseProxy not to set the header.
		req.Header["X-Forwarded-For"] = nil
	}
	proxy.FlushInterval = -1 // flush SSE events immediately

	override := thinkingOverride
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/messages") {
			rewriteThinkingInRequest(r, override)
			if foldSystem {
				foldSystemTurnsInRequest(r)
			}
		}
		proxy.ServeHTTP(w, r)
	})

	pp := &ProviderProxy{
		targetURL:        targetURL,
		thinkingOverride: thinkingOverride,
		listener:         listener,
		server: &http.Server{
			Handler:      mux,
			ReadTimeout:  10 * time.Minute,
			WriteTimeout: 10 * time.Minute,
		},
	}

	go func() {
		if err := pp.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("providerproxy: serve error", "error", err)
		}
	}()

	localURL := fmt.Sprintf("http://127.0.0.1:%d", listener.Addr().(*net.TCPAddr).Port)
	slog.Info("providerproxy: started", "target", targetURL, "local", localURL, "thinking", thinkingOverride, "fold_system", foldSystem)
	return pp, localURL, nil
}

// Close shuts down the proxy.
func (pp *ProviderProxy) Close() {
	pp.once.Do(func() {
		pp.server.Close()
	})
}

// rewriteThinkingInRequest reads the request body and rewrites
// thinking.type "adaptive" to the given override value.
func rewriteThinkingInRequest(r *http.Request, override string) {
	if r.Body == nil || override == "" {
		return
	}
	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		return
	}

	modified := false
	if thinking, ok := data["thinking"].(map[string]any); ok {
		if t, ok := thinking["type"].(string); ok && t == "adaptive" {
			thinking["type"] = override
			if override == "disabled" {
				delete(thinking, "budget_tokens")
			}
			modified = true
			slog.Debug("providerproxy: rewrote thinking adaptive →", "override", override)
		}
	}

	if !modified {
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		return
	}

	newBody, err := json.Marshal(data)
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(newBody))
	r.ContentLength = int64(len(newBody))
}

// foldSystemTurnsInRequest applies foldSystemTurns to a /messages request body.
func foldSystemTurnsInRequest(r *http.Request) {
	if r.Body == nil {
		return
	}
	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err == nil {
		var data map[string]any
		if json.Unmarshal(body, &data) == nil && foldSystemTurns(data) {
			if nb, err := json.Marshal(data); err == nil {
				body = nb
			}
		}
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
}

// foldSystemTurns rewrites every role=system entry of data["messages"] into a
// user turn wrapped in <system-reminder>, then merges neighbouring user turns
// so roles still alternate. The top-level "system" field is left alone.
// Reports whether anything changed.
func foldSystemTurns(data map[string]any) bool {
	msgs, ok := data["messages"].([]any)
	if !ok {
		return false
	}
	blocks := func(content any) []any {
		switch c := content.(type) {
		case string:
			return []any{map[string]any{"type": "text", "text": c}}
		case []any:
			return c
		}
		return nil
	}
	changed := false
	out := make([]any, 0, len(msgs))
	for _, raw := range msgs {
		m, ok := raw.(map[string]any)
		if !ok {
			out = append(out, raw)
			continue
		}
		if m["role"] == "system" {
			changed = true
			var sb strings.Builder
			for _, b := range blocks(m["content"]) {
				if bm, ok := b.(map[string]any); ok && bm["type"] == "text" {
					if t, _ := bm["text"].(string); t != "" {
						if sb.Len() > 0 {
							sb.WriteString("\n")
						}
						sb.WriteString(t)
					}
				}
			}
			m = map[string]any{"role": "user", "content": []any{map[string]any{
				"type": "text", "text": "<system-reminder>\n" + sb.String() + "\n</system-reminder>"}}}
		}
		if n := len(out); changed && n > 0 && m["role"] == "user" {
			if prev, ok := out[n-1].(map[string]any); ok && prev["role"] == "user" {
				merged := append(append([]any{}, blocks(prev["content"])...), blocks(m["content"])...)
				out[n-1] = map[string]any{"role": "user", "content": merged}
				continue
			}
		}
		out = append(out, m)
	}
	if changed {
		data["messages"] = out
	}
	return changed
}
