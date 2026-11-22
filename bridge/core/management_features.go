package core

// 功能开关 (#1861): the panel page and `bothouse features list` read one registry
// (config/features.go) through these two endpoints. core cannot import config, so the list and
// the write come in as funcs (cmd/cc-connect/features.go).

import (
	"net/http"
	"strings"
)

// FeatureList is what both endpoints answer: the registry's states (config.FeatureState, opaque
// here) and the config language, which picks the Chinese or English names.
type FeatureList struct {
	Features any    `json:"features"`
	Lang     string `json:"lang"`
}

// SetFeatureFuncs wires the 功能开关 page: list reads every switch, set writes one to config.toml
// and reports whether it needs a restart.
func (m *ManagementServer) SetFeatureFuncs(list func() (FeatureList, error), set func(project, key string, on bool) (bool, error)) {
	m.featureList = list
	m.featureSet = set
}

// handleFeatures: GET /features lists; POST /features {project, key, on} flips one switch, reloads
// the running roles so a hot switch acts at once, and answers the new list.
func (m *ManagementServer) handleFeatures(w http.ResponseWriter, r *http.Request) {
	if m.featureList == nil || m.featureSet == nil {
		mgmtError(w, http.StatusServiceUnavailable, "feature switches not available")
		return
	}
	out := map[string]any{}
	if r.Method != http.MethodGet {
		var req struct {
			Project string `json:"project"`
			Key     string `json:"key"`
			On      *bool  `json:"on"`
		}
		if !decodeBody(w, r, &req) {
			return
		}
		if strings.TrimSpace(req.Key) == "" || req.On == nil {
			mgmtError(w, http.StatusBadRequest, "key and on are required")
			return
		}
		restart, err := m.featureSet(req.Project, req.Key, *req.On)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		out["restart_required"] = restart
		if _, err := m.reloadRunning(); err != nil {
			out["reload_error"] = err.Error()
		}
	}
	list, err := m.featureList()
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out["features"], out["lang"] = list.Features, list.Lang
	mgmtJSON(w, http.StatusOK, out)
}

// SetFeatureList wires GET /features on the local socket (`bothouse features list`).
func (s *APIServer) SetFeatureList(list func() (FeatureList, error)) {
	s.featureList = list
}

func (s *APIServer) handleFeatures(w http.ResponseWriter, r *http.Request) {
	if s.featureList == nil {
		http.Error(w, "feature switches not available", http.StatusServiceUnavailable)
		return
	}
	list, err := s.featureList()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	apiJSON(w, http.StatusOK, list)
}
