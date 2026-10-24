package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Device represents an external client or pet device connected to bothouse.
type Device struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Type         string         `json:"type"` // e.g. "desktop_pet", "mobile", "tray"
	Version      string         `json:"version"`
	Enabled      bool           `json:"enabled"`
	Status       string         `json:"status"` // "online", "offline"
	LastSeen     time.Time      `json:"last_seen"`
	RegisteredAt time.Time      `json:"registered_at"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// RoleInfo represents the status of a role/engine in bothouse.
type RoleInfo struct {
	Name          string   `json:"name"`
	AgentType     string   `json:"agent_type"`
	Model         string   `json:"model"`
	Online        bool     `json:"online"`
	Busy          bool     `json:"busy"`
	CurrentTask   string   `json:"current_task"`
	Paused        bool     `json:"paused"`
	Platforms     []string `json:"platforms"`
	SessionsCount int      `json:"sessions_count"`
}

// ── Roles API ──────────────────────────────────────────────────

func (m *ManagementServer) handleRoles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	m.rolesMu.RLock()
	defer m.rolesMu.RUnlock()

	roles := make([]RoleInfo, 0, len(m.engines))
	for name, e := range m.engines {
		platNames := make([]string, len(e.platforms))
		for i, p := range e.platforms {
			platNames[i] = p.Name()
		}

		model := e.agent.Name()
		if ms, ok := e.agent.(ModelSwitcher); ok {
			if cur := ms.GetModel(); cur != "" {
				model = cur
			}
		}

		busy := false
		currentTask := "空闲"

		// Check active interactive sessions or sessions marked busy
		e.interactiveMu.Lock()
		activeCount := len(e.interactiveStates)
		e.interactiveMu.Unlock()

		if activeCount > 0 {
			busy = true
			currentTask = "处理交互任务中"
		} else {
			allSessions := e.sessions.AllSessions()
			for _, sess := range allSessions {
				if sess.Busy() {
					busy = true
					currentTask = "处理会话消息中"
					break
				}
			}
		}

		// Also check team status if available
		if e.team != nil {
			e.team.mu.Lock()
			for _, s := range e.team.seen {
				if s.busy {
					busy = true
					if s.task != "" {
						currentTask = s.task
					} else {
						currentTask = "忙碌中"
					}
					break
				}
			}
			e.team.mu.Unlock()
		}

		online := len(e.platforms) > 0 || !e.startedAt.IsZero()
		paused := m.pausedRoles[name]

		roles = append(roles, RoleInfo{
			Name:          name,
			AgentType:     e.agent.Name(),
			Model:         model,
			Online:        online,
			Busy:          busy,
			CurrentTask:   currentTask,
			Paused:        paused,
			Platforms:     platNames,
			SessionsCount: len(e.sessions.AllSessions()),
		})
	}

	mgmtJSON(w, http.StatusOK, map[string]any{"roles": roles})
}

func (m *ManagementServer) handleRoleRoutes(w http.ResponseWriter, r *http.Request) {
	// Parse: /api/v1/roles/{name}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/roles/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		mgmtError(w, http.StatusBadRequest, "role name required")
		return
	}

	roleName := parts[0]
	m.mu.RLock()
	engine, exists := m.engines[roleName]
	m.mu.RUnlock()
	if !exists {
		mgmtError(w, http.StatusNotFound, fmt.Sprintf("role not found: %s", roleName))
		return
	}

	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "restart":
		if r.Method != http.MethodPost {
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}

		// Close existing interactive sessions to force restart
		engine.interactiveMu.Lock()
		for key, state := range engine.interactiveStates {
			if state.agentSession != nil {
				_ = state.agentSession.Close()
			}
			delete(engine.interactiveStates, key)
		}
		engine.interactiveMu.Unlock()

		mgmtJSON(w, http.StatusOK, map[string]any{
			"role":    roleName,
			"status":  "restarted",
			"message": fmt.Sprintf("role %s restarted", roleName),
		})

	case "pause":
		if r.Method != http.MethodPost {
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}

		m.rolesMu.Lock()
		m.pausedRoles[roleName] = !m.pausedRoles[roleName]
		isPaused := m.pausedRoles[roleName]
		m.rolesMu.Unlock()

		// If heartbeat scheduler exists, pause or resume as well
		if m.heartbeatScheduler != nil {
			if isPaused {
				_ = m.heartbeatScheduler.Pause(roleName)
			} else {
				_ = m.heartbeatScheduler.Resume(roleName)
			}
		}

		mgmtJSON(w, http.StatusOK, map[string]any{
			"role":    roleName,
			"paused":  isPaused,
			"message": fmt.Sprintf("role %s pause state set to %v", roleName, isPaused),
		})

	default:
		mgmtError(w, http.StatusNotFound, "unknown role action")
	}
}

// ── Devices API ────────────────────────────────────────────────

func (m *ManagementServer) handleDevices(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		m.devicesMu.RLock()
		defer m.devicesMu.RUnlock()

		now := time.Now()
		list := make([]Device, 0, len(m.devices))
		for _, dev := range m.devices {
			dCopy := *dev
			// If not seen for over 3 minutes, report as offline
			if now.Sub(dCopy.LastSeen) > 3*time.Minute {
				dCopy.Status = "offline"
			}
			list = append(list, dCopy)
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"devices": list})

	case http.MethodPost:
		m.handleDeviceRegister(w, r)

	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or POST only")
	}
}

func (m *ManagementServer) handleDeviceRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string         `json:"id"`
		Name     string         `json:"name"`
		Type     string         `json:"type"`
		Version  string         `json:"version"`
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if req.ID == "" {
		req.ID = fmt.Sprintf("dev-%d", time.Now().UnixNano())
	}
	if req.Name == "" {
		req.Name = req.ID
	}
	if req.Type == "" {
		req.Type = "external"
	}

	now := time.Now()
	m.devicesMu.Lock()
	existing, ok := m.devices[req.ID]
	if ok {
		existing.Name = req.Name
		existing.Type = req.Type
		if req.Version != "" {
			existing.Version = req.Version
		}
		existing.LastSeen = now
		existing.Status = "online"
		if req.Metadata != nil {
			existing.Metadata = req.Metadata
		}
	} else {
		existing = &Device{
			ID:           req.ID,
			Name:         req.Name,
			Type:         req.Type,
			Version:      req.Version,
			Enabled:      true,
			Status:       "online",
			LastSeen:     now,
			RegisteredAt: now,
			Metadata:     req.Metadata,
		}
		m.devices[req.ID] = existing
	}
	dCopy := *existing
	m.devicesMu.Unlock()

	mgmtJSON(w, http.StatusOK, map[string]any{
		"device":  dCopy,
		"message": "device registered",
	})
}

func (m *ManagementServer) handleDeviceRoutes(w http.ResponseWriter, r *http.Request) {
	// Parse: /api/v1/devices/{id}[/{action}]
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/devices/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		mgmtError(w, http.StatusBadRequest, "device id required")
		return
	}

	if parts[0] == "register" {
		if r.Method != http.MethodPost {
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		m.handleDeviceRegister(w, r)
		return
	}

	deviceID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	m.devicesMu.Lock()
	dev, ok := m.devices[deviceID]
	if !ok {
		m.devicesMu.Unlock()
		mgmtError(w, http.StatusNotFound, fmt.Sprintf("device not found: %s", deviceID))
		return
	}

	switch action {
	case "heartbeat":
		if r.Method != http.MethodPost {
			m.devicesMu.Unlock()
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		dev.LastSeen = time.Now()
		dev.Status = "online"
		dCopy := *dev
		m.devicesMu.Unlock()

		mgmtJSON(w, http.StatusOK, map[string]any{
			"device":  dCopy,
			"message": "heartbeat acknowledged",
		})

	case "":
		switch r.Method {
		case http.MethodGet:
			dCopy := *dev
			if time.Since(dCopy.LastSeen) > 3*time.Minute {
				dCopy.Status = "offline"
			}
			m.devicesMu.Unlock()
			mgmtJSON(w, http.StatusOK, map[string]any{"device": dCopy})

		case http.MethodPatch:
			var patch struct {
				Enabled  *bool          `json:"enabled"`
				Name     *string        `json:"name"`
				Metadata map[string]any `json:"metadata"`
			}
			if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
				m.devicesMu.Unlock()
				mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
				return
			}
			if patch.Enabled != nil {
				dev.Enabled = *patch.Enabled
			}
			if patch.Name != nil && *patch.Name != "" {
				dev.Name = *patch.Name
			}
			if patch.Metadata != nil {
				dev.Metadata = patch.Metadata
			}
			dCopy := *dev
			m.devicesMu.Unlock()
			mgmtJSON(w, http.StatusOK, map[string]any{"device": dCopy, "message": "device updated"})

		case http.MethodDelete:
			delete(m.devices, deviceID)
			m.devicesMu.Unlock()
			mgmtOK(w, "device deleted")

		default:
			m.devicesMu.Unlock()
			mgmtError(w, http.StatusMethodNotAllowed, "GET, PATCH or DELETE only")
		}

	default:
		m.devicesMu.Unlock()
		mgmtError(w, http.StatusNotFound, "unknown device action")
	}
}
