package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// PlatformStatus represents the readiness of a platform connected to an engine.
type PlatformStatus struct {
	Name  string `json:"name"`
	Ready bool   `json:"ready"`
}

// RoleQuotaWindow represents a measured quota window (e.g. 5-hour limit, weekly limit).
type RoleQuotaWindow struct {
	Name              string `json:"name"`
	Label             string `json:"label,omitempty"`
	UsedPercent       int    `json:"used_percent"`
	RemainingPercent  int    `json:"remaining_percent"`
	WindowSeconds     int    `json:"window_seconds,omitempty"`
	ResetAfterSeconds int    `json:"reset_after_seconds,omitempty"`
}

// RoleQuota holds the cached quota window snapshot for a role.
type RoleQuota struct {
	Windows []RoleQuotaWindow `json:"windows,omitempty"`
}

// RoleInfo represents the status of a role/engine in bothouse.
type RoleInfo struct {
	Name          string           `json:"name"`
	DisplayName   string           `json:"display_name"` // Engine.DisplayName: team_name, else the project name
	AgentType     string           `json:"agent_type"`
	Model         string           `json:"model"`
	Online        bool             `json:"online"`
	Busy          bool             `json:"busy"`
	CurrentTask   string           `json:"current_task"`
	Paused        bool             `json:"paused"`
	Platforms     []PlatformStatus `json:"platforms"`
	SessionsCount int              `json:"sessions_count"`
	Quota         *RoleQuota       `json:"quota,omitempty"`
}

// roleQuotaFromReport formats the cached UsageReport into RoleQuota without doing I/O.
// Returns nil when report has no usable windows.
func roleQuotaFromReport(report *UsageReport) *RoleQuota {
	if report == nil {
		return nil
	}
	primary, secondary := selectUsageWindows(report)
	var windows []RoleQuotaWindow
	for _, w := range []*UsageWindow{primary, secondary} {
		if w == nil {
			continue
		}
		seconds := w.WindowSeconds
		if seconds <= 0 && w.Name != "" {
			switch strings.ToLower(strings.TrimSpace(w.Name)) {
			case "5h":
				// 沿用 engine.go selectUsageWindows 标准 5 小时窗口秒数
				seconds = 18000
			case "weekly", "week":
				// 沿用 engine.go selectUsageWindows 标准 7 天周窗口秒数
				seconds = 604800
			}
		}

		label := usageWindowShortLabel(LangChinese, seconds)
		name := usageWindowLabel(LangChinese, seconds)
		if label == "" {
			if w.Name != "" {
				label = w.Name
			} else if seconds > 0 {
				label = fmt.Sprintf("%ds", seconds)
			} else {
				label = "额度"
			}
		}
		if name == "" || name == "额度窗口" {
			if w.Name != "" {
				name = w.Name
			} else {
				name = label
			}
		}

		used := w.UsedPercent
		if used < 0 {
			used = 0
		}
		if used > 100 {
			used = 100
		}
		remaining := 100 - used
		if remaining < 0 {
			remaining = 0
		}
		if remaining > 100 {
			remaining = 100
		}

		windows = append(windows, RoleQuotaWindow{
			Name:              name,
			Label:             label,
			UsedPercent:       used,
			RemainingPercent:  remaining,
			WindowSeconds:     seconds,
			ResetAfterSeconds: w.ResetAfterSeconds,
		})
	}
	if len(windows) == 0 {
		return nil
	}
	return &RoleQuota{Windows: windows}
}

// ── Roles API ──────────────────────────────────────────────────

func (m *ManagementServer) handleRoles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	roles := make([]RoleInfo, 0, len(m.engines))
	for name, e := range m.engines {
		// 1. Online status and per-platform readiness
		online := false
		var platforms []PlatformStatus
		e.platformLifecycleMu.Lock()
		for _, p := range e.platforms {
			ready := e.platformReady[p]
			if ready {
				online = true
			}
			platforms = append(platforms, PlatformStatus{
				Name:  p.Name(),
				Ready: ready,
			})
		}
		e.platformLifecycleMu.Unlock()
		if platforms == nil {
			platforms = []PlatformStatus{}
		}

		// 2. Active model resolution via replyFooterModel
		var activeSession AgentSession
		e.interactiveMu.Lock()
		for _, state := range e.interactiveStates {
			if state == nil {
				continue
			}
			state.mu.Lock()
			sess := state.agentSession
			state.mu.Unlock()
			if sess != nil {
				activeSession = sess
				break
			}
		}
		e.interactiveMu.Unlock()

		model := replyFooterModel(activeSession, e.agent)
		if model == "" {
			model = "未知"
		}

		// 3. Busy status & current task from Session.Busy()
		busy := false
		currentTask := "空闲"

		if e.team != nil {
			e.team.mu.Lock()
			for _, ts := range e.team.seen {
				if ts.relay != nil {
					ts.relay.mu.Lock()
					relayBusy := ts.relay.entry.Busy
					relayTask := ts.relay.entry.Task
					ts.relay.mu.Unlock()
					if relayBusy {
						busy = true
						if relayTask != "" {
							currentTask = relayTask
						} else {
							currentTask = "忙碌中"
						}
						break
					}
					continue
				}

				if ts.session != nil && ts.session.Busy() {
					busy = true
					if ts.task != "" {
						currentTask = ts.task
					} else {
						currentTask = "处理会话消息中"
					}
					break
				}
			}
			e.team.mu.Unlock()
		}

		if !busy {
			for _, sess := range e.sessions.AllSessions() {
				if sess.Busy() {
					busy = true
					currentTask = "处理会话消息中"
					break
				}
			}
		}

		paused := e.IsPaused()

		var quota *RoleQuota
		if report := e.CachedQuotaReport(activeSession, model); report != nil {
			quota = roleQuotaFromReport(report)
		}

		roles = append(roles, RoleInfo{
			Name:          name,
			DisplayName:   e.DisplayName(),
			AgentType:     e.agent.Name(),
			Model:         model,
			Online:        online,
			Busy:          busy,
			CurrentTask:   currentTask,
			Paused:        paused,
			Platforms:     platforms,
			SessionsCount: len(e.sessions.AllSessions()),
			Quota:         quota,
		})
	}

	mgmtJSON(w, http.StatusOK, map[string]any{"roles": roles})
}

func (m *ManagementServer) handleRoleRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/roles/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		mgmtError(w, http.StatusNotFound, "not found")
		return
	}

	roleName := parts[0]
	action := parts[1]

	m.mu.RLock()
	e, ok := m.engines[roleName]
	m.mu.RUnlock()

	if !ok {
		mgmtError(w, http.StatusNotFound, fmt.Sprintf("role %q not found", roleName))
		return
	}

	switch action {
	case "restart":
		if r.Method != http.MethodPost {
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}

		// Clean up interactive states safely via cleanupInteractiveState without holding interactiveMu during teardown
		e.interactiveMu.Lock()
		keys := make([]string, 0, len(e.interactiveStates))
		for k := range e.interactiveStates {
			keys = append(keys, k)
		}
		e.interactiveMu.Unlock()

		for _, k := range keys {
			e.cleanupInteractiveState(k)
		}

		mgmtJSON(w, http.StatusOK, map[string]any{
			"role":    roleName,
			"status":  "restarted",
			"message": fmt.Sprintf("role %s restarted", e.DisplayName()),
		})

	case "pause":
		if r.Method != http.MethodPost {
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}

		var req struct {
			Paused bool `json:"paused"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid request body: expected JSON with paused boolean")
			return
		}

		e.SetPaused(req.Paused)

		// Also update heartbeat scheduler if configured
		if m.heartbeatScheduler != nil {
			if req.Paused {
				_ = m.heartbeatScheduler.Pause(roleName)
			} else {
				_ = m.heartbeatScheduler.Resume(roleName)
			}
		}

		mgmtJSON(w, http.StatusOK, map[string]any{
			"role":    roleName,
			"paused":  req.Paused,
			"message": fmt.Sprintf("role %s pause state set to %v", e.DisplayName(), req.Paused),
		})

	default:
		mgmtError(w, http.StatusNotFound, "unknown role action")
	}
}

// ── Devices API (Adapter listing from bridge server) ────────────

func (m *ManagementServer) handleDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	adapters := m.listBridgeAdapters()
	if adapters == nil {
		adapters = []map[string]any{}
	}

	mgmtJSON(w, http.StatusOK, map[string]any{"devices": adapters})
}
