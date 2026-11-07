package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// handleDSHMembersAPI forwards only the dedicated owner-only member endpoints.
func (m *ManagementServer) handleDSHMembersAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodPatch && r.Method != http.MethodDelete {
		mgmtError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if r.Method != http.MethodGet && !dshSameOrigin(r) {
		mgmtError(w, http.StatusForbidden, "cross-origin request refused")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/dsh/")
	var target string
	switch {
	case path == "members" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		target = "/collab/api/panel/members"
	case strings.HasPrefix(path, "members/") && (r.Method == http.MethodPatch || r.Method == http.MethodDelete):
		id := strings.TrimPrefix(path, "members/")
		if id == "" || strings.Contains(id, "/") {
			mgmtError(w, http.StatusBadRequest, "invalid member id")
			return
		}
		target = "/collab/api/panel/members/" + url.PathEscape(id)
	case path == "model-routes" && r.Method == http.MethodGet:
		target = "/collab/api/models"
	case path == "cli-options" && r.Method == http.MethodPost:
		target = "/collab/api/panel/cli-options"
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "method or path not allowed")
		return
	}
	c, state := m.dshClient()
	if state.Status != "running" {
		mgmtError(w, http.StatusServiceUnavailable, dshUnavailableReason(state))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		mgmtError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, "http://"+c.target+target, bytes.NewReader(body))
	if err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid request")
		return
	}
	req.Host = c.target
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.rt.RoundTrip(req)
	if errors.Is(err, errDSHWebNotRunning) {
		// Gone behind a zero (unknown) pid: the same 503 as a host known to be stopped.
		mgmtError(w, http.StatusServiceUnavailable, "DSH source unavailable")
		return
	}
	if err != nil {
		mgmtError(w, http.StatusBadGateway, "连不上 DSH：请求 "+target+" 失败（"+err.Error()+"）。")
		return
	}
	defer resp.Body.Close()
	var result map[string]any
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&result)
	if decodeErr != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// A 2xx with an unreadable body is a broken answer; a non-2xx often has an empty body
		// (404 from a plugin that never mounted), and the status is the real reason.
		mgmtError(w, http.StatusBadGateway, "invalid DSH response")
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := result["error"].(string)
		if msg == "" {
			msg = dshStatusReason(r.Context(), target, resp.StatusCode)
		}
		status := resp.StatusCode
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		mgmtError(w, status, msg)
		return
	}
	mgmtJSON(w, http.StatusOK, result)
}
