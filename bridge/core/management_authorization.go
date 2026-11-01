package core

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// Mounted under the existing authenticated management routes. No public API
// accepts source-authenticated/visible flags or substitutes a bot for a human.
func (m *ManagementServer) handleProjectAuthorization(w http.ResponseWriter, r *http.Request, e *Engine, rest string) {
	// The legacy management server can run without a token. That mode cannot
	// attest an administrator and must not expose evidence or mint grants.
	if m.token == "" {
		mgmtError(w, http.StatusForbidden, "authorization controls require management authentication")
		return
	}
	a, err := e.ProactiveAuthorization()
	if err != nil {
		mgmtError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	switch {
	case rest == "" && r.Method == http.MethodGet:
		b, err := a.Snapshot()
		if err != nil {
			mgmtError(w, http.StatusInternalServerError, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, json.RawMessage(b))
	case rest == "policy" && r.Method == http.MethodGet:
		mgmtJSON(w, http.StatusOK, a.Policy())
	case rest == "policy" && r.Method == http.MethodPut:
		var p ProactivePolicy
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&p); err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Authority is derived from this authenticated entry, not caller's claimed name.
		p.Authority = "management:administrator"
		err = a.ReplacePolicy(p.Version, p)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, ErrAuthorizationStale) {
				status = http.StatusConflict
			}
			mgmtError(w, status, err.Error())
			return
		}
		if err = e.SyncAuthorizationNotices(); err != nil {
			mgmtError(w, http.StatusInternalServerError, "policy committed; task notice pending")
			return
		}
		mgmtJSON(w, http.StatusOK, a.Policy())
	case strings.HasPrefix(rest, "renew/") && r.Method == http.MethodPost:
		id, err := e.RenewTaskAuthorization(strings.TrimPrefix(rest, "renew/"))
		if err != nil {
			mgmtError(w, http.StatusConflict, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]string{"decision_id": id})
	case strings.HasPrefix(rest, "revoke/") && r.Method == http.MethodPost:
		id := strings.TrimPrefix(rest, "revoke/")
		if err = a.Revoke(id, "management:administrator"); err != nil {
			mgmtError(w, http.StatusConflict, err.Error())
			return
		}
		if err = e.SyncAuthorizationNotices(); err != nil {
			mgmtError(w, http.StatusInternalServerError, "withdrawal committed; task notice pending")
			return
		}
		mgmtOK(w, "authorization withdrawn")
	default:
		mgmtError(w, http.StatusNotFound, "not found")
	}
}
