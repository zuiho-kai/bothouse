package core

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// Only a role-owned text provider can accept this work. The existing protocol
// converter supplies the model transport. No agent session or tools are started.
func handleProjectTextTask(w http.ResponseWriter, r *http.Request, e *Engine) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "use GET or POST")
		return
	}
	var provider *ProviderConfig
	if switcher, ok := e.agent.(ProviderSwitcher); ok && !e.IsPaused() {
		provider = switcher.GetActiveProvider()
	}
	if !textTaskProvider(provider) {
		mgmtJSON(w, http.StatusOK, map[string]string{"defer": "backend"})
		return
	}
	if r.Method == http.MethodGet {
		mgmtJSON(w, http.StatusOK, map[string]bool{"available": true})
		return
	}
	var input struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || strings.TrimSpace(input.Text) == "" || utf8.RuneCountInString(input.Text) > 7000 {
		mgmtError(w, http.StatusBadRequest, "invalid task text")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	target := protoConvTarget{strings.TrimRight(provider.BaseURL, "/"), provider.APIKey, provider.Model}
	var out strings.Builder
	var finish string
	var toolRequested, overflow bool
	events := upstreamEvents{
		text: func(part string) {
			if out.Len()+len(part) > 16<<10 {
				overflow = true
				cancel()
				return
			}
			out.WriteString(part)
		},
		tool:   func(_ int, _, _, _ string) { toolRequested = true; cancel() },
		usage:  func(int, int) {},
		finish: func(reason string) { finish = reason },
	}
	req := pcReq{Model: provider.Model, ToolChoice: "none", MaxTokens: 4096, Messages: []pcMsg{
		{Role: "system", Content: "You have no tools. Deliver only text based on the current assignment. For an external action return exactly [NEEDS_WORKER]. For missing source material return exactly [NEEDS_INPUT]. Never claim an external action was performed."},
		{Role: "user", Content: input.Text},
	}}
	// A redirect cannot move the assignment to another endpoint or repeat the POST.
	client := &http.Client{Transport: protoConvClient.Transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	status, _ := target.callUpstreamWithClient(r.WithContext(ctx), req, &events, client)
	if toolRequested || finish == "tool_calls" || finish == "function_call" {
		mgmtJSON(w, http.StatusOK, map[string]string{"defer": "external"})
		return
	}
	if status != 0 {
		// The provider may already have accepted the POST. An ambiguous response
		// must not offer the user a duplicate generation.
		mgmtJSON(w, http.StatusOK, map[string]string{"error": "receipt_unknown"})
		return
	}
	if overflow || finish != "stop" || strings.TrimSpace(out.String()) == "" {
		mgmtError(w, http.StatusBadGateway, "text executor did not deliver a complete reply")
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]string{"text": out.String()})
}

func textTaskProvider(p *ProviderConfig) bool {
	if p == nil || p.APIFormat != APIFormatOpenAIChat || p.Model == "" || len(p.Env) != 0 || len(p.CodexHTTPHeaders) != 0 {
		return false
	}
	u, err := url.Parse(p.BaseURL)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	return u.Scheme == "https" || u.Scheme == "http" && (u.Hostname() == "localhost" || net.ParseIP(u.Hostname()).IsLoopback())
}
