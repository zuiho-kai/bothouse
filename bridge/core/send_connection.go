package core

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

// ValidateConnectionTarget checks the destination options for a named connection send.
func (req SendRequest) ValidateConnectionTarget() error {
	if strings.TrimSpace(req.SessionKey) == "" || req.SessionFromEnv {
		return fmt.Errorf("--connection requires an explicit --session")
	}
	if req.Channel != "" || req.DM || req.WorkDir != "" || req.CWD != "" || req.TaskText != nil {
		return fmt.Errorf("--connection cannot be combined with --channel, --dm, --cwd or --task")
	}
	if req.MentionAssigner != 0 || req.AskUser {
		return fmt.Errorf("--connection cannot be combined with --mention-assigner or --ask-user")
	}
	return nil
}

func (s *APIServer) resolveConnectionSend(w http.ResponseWriter, engine *Engine, req SendRequest) (*sendTarget, string) {
	connections, err := readCloudWebConnections(s.dataDir)
	if err != nil {
		slog.Error("send: read Cloud Web connections", "error", err)
		http.Error(w, "could not read saved Cloud Web connections", http.StatusInternalServerError)
		return nil, ""
	}
	var profile cloudWebConnectionInfo
	for _, c := range connections {
		if strings.EqualFold(c.Name, req.Connection) {
			if profile.ID != "" {
				http.Error(w, fmt.Sprintf("saved connection name %q is ambiguous", req.Connection), http.StatusConflict)
				return nil, ""
			}
			profile = c.cloudWebConnectionInfo
		}
	}
	if profile.ID == "" {
		http.Error(w, fmt.Sprintf("saved connection %q not found", req.Connection), http.StatusNotFound)
		return nil, ""
	}

	var platform Platform
	for _, candidate := range engine.platforms {
		if p, ok := candidate.(interface{ ConnectionProfileID() string }); ok && p.ConnectionProfileID() == profile.ID {
			if platform != nil {
				http.Error(w, fmt.Sprintf("connection %q has multiple attachments on this project", profile.Name), http.StatusConflict)
				return nil, ""
			}
			platform = candidate
		}
	}
	if platform == nil {
		http.Error(w, fmt.Sprintf("connection %q is not attached to the running project", profile.Name), http.StatusBadRequest)
		return nil, ""
	}
	if session, ok := strings.CutPrefix(req.SessionKey, platform.Name()+":"); !ok || session == "" {
		http.Error(w, fmt.Sprintf("--session must use the %q platform for connection %q", platform.Name(), profile.Name), http.StatusBadRequest)
		return nil, ""
	}
	target, err := engine.resolveSendTargetOnPlatform(req.SessionKey, false, platform)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return nil, ""
	}
	return &target, profile.Name
}
