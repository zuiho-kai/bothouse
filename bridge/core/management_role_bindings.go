package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// RolePluginBinding is a role-local setting. It does not toggle DSH's global plugin switch.
type RolePluginBinding struct {
	PluginID   string `json:"plugin_id"`
	Enabled    bool   `json:"enabled"`
	AvatarPack string `json:"avatar_pack,omitempty"`
}

type RoleBindings struct {
	Bindings map[string][]RolePluginBinding `json:"bindings"`
}

func validateRoleBindings(bindings RoleBindings) error {
	if bindings.Bindings == nil {
		return errors.New("bindings must be a JSON object (use {} to unbind all roles)")
	}
	for role, plugins := range bindings.Bindings {
		source, name, ok := strings.Cut(role, ":")
		if !ok || (source != "bridge" && source != "dsh") || strings.TrimSpace(name) == "" || strings.TrimSpace(role) != role {
			return fmt.Errorf("invalid role key %q: expected bridge:name or dsh:id", role)
		}
		seen := map[string]bool{}
		for _, plugin := range plugins {
			if strings.TrimSpace(plugin.PluginID) == "" || strings.TrimSpace(plugin.PluginID) != plugin.PluginID {
				return fmt.Errorf("%s: plugin_id is required", role)
			}
			if seen[plugin.PluginID] {
				return fmt.Errorf("%s: duplicate plugin_id %q", role, plugin.PluginID)
			}
			seen[plugin.PluginID] = true
		}
	}
	return nil
}

func (m *ManagementServer) handleRoleBindings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		mgmtError(w, http.StatusMethodNotAllowed, "GET or PUT only")
		return
	}
	if r.Method == http.MethodPut && !m.requirePluginWrites(w) {
		return
	}
	if m.wizardDataDir == "" {
		mgmtError(w, http.StatusServiceUnavailable, "bothouse data directory is not configured")
		return
	}
	path := filepath.Join(m.wizardDataDir, "plugins", "role-bindings.json")
	m.roleBindingsMu.Lock()
	defer m.roleBindingsMu.Unlock()
	if r.Method == http.MethodGet {
		bindings := RoleBindings{Bindings: map[string][]RolePluginBinding{}}
		raw, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			mgmtError(w, http.StatusInternalServerError, "read role bindings: "+err.Error())
			return
		}
		if err == nil {
			if err = json.Unmarshal(raw, &bindings); err == nil {
				err = validateRoleBindings(bindings)
			}
			if err != nil {
				mgmtError(w, http.StatusInternalServerError, "invalid stored role bindings: "+err.Error())
				return
			}
		}
		mgmtJSON(w, http.StatusOK, bindings)
		return
	}
	var bindings RoleBindings
	// 来源：沿用 dshAPI.get 的 4 MiB 外部 JSON 读取上限。
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&bindings); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid bindings: "+err.Error())
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		mgmtError(w, http.StatusBadRequest, "expected one JSON object")
		return
	}
	if err := validateRoleBindings(bindings); err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	// An explicit empty list is an unbind too; never insert recommended defaults.
	for role, plugins := range bindings.Bindings {
		if len(plugins) == 0 {
			delete(bindings.Bindings, role)
		}
	}
	raw, err := json.MarshalIndent(bindings, "", "  ")
	if err == nil {
		err = os.MkdirAll(filepath.Dir(path), 0o700)
	}
	if err == nil {
		err = AtomicWriteFile(path, append(raw, '\n'), 0o600)
	}
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "save role bindings: "+err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, bindings)
}
