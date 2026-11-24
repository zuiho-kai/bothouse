package core

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
)

var arcadeAccountNumber = regexp.MustCompile("^[A-Za-z0-9_]{4,24}$")

func (m *ManagementServer) SetFriendShares(f func(string, string, bool) ([]string, error)) {
	m.friendShares = f
}

func (m *ManagementServer) handleFriendShares(w http.ResponseWriter, r *http.Request, project, number string) {
	if m.token == "" {
		mgmtError(w, http.StatusForbidden, "project sharing requires management authentication")
		return
	}
	if m.friendShares == nil {
		mgmtError(w, http.StatusServiceUnavailable, "project sharing unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if number != "" {
			mgmtError(w, http.StatusNotFound, "unknown sharing endpoint")
			return
		}
	case http.MethodPut, http.MethodDelete:
		if !arcadeAccountNumber.MatchString(number) {
			mgmtError(w, http.StatusBadRequest, "invalid Agent Arcade account number")
			return
		}
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET, PUT or DELETE only")
		return
	}
	recipients, err := m.friendShares(project, strings.ToLower(number), r.Method == http.MethodPut)
	if errors.Is(err, ErrProjectNotFound) {
		mgmtError(w, http.StatusNotFound, "unknown project")
		return
	}
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "could not read or save project recipients")
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"numbers": recipients})
}
