package core

import (
	"sort"
	"strings"
	"sync"
	"time"
)

// RoleSessionState keeps session identity separate from the role's aggregate state.
type RoleSessionState struct {
	SessionKey string `json:"session_key"`
	Status     string `json:"status"`
	Busy       bool   `json:"busy"`
}

type RoleState struct {
	RoleKey     string             `json:"role_key"`
	Source      string             `json:"source"`
	Name        string             `json:"name"`
	DisplayName string             `json:"display_name"`
	Online      bool               `json:"online"`
	Status      string             `json:"status"`
	BusyCount   int                `json:"busy_count"`
	Sessions    []RoleSessionState `json:"sessions"`
}

type RoleEvent struct {
	Type       string `json:"type"`
	RoleKey    string `json:"role_key"`
	SessionKey string `json:"session_key"`
	Status     string `json:"status"`
	Text       string `json:"text,omitempty"`
	// DSH message identity (#1355): one upstream message keeps its id for life, and
	// revision moves on every in-place edit or draft commit. update marks a frame that
	// revises a message already sent on this stream; draft marks a reply still streaming.
	MessageID int64   `json:"message_id,omitempty"`
	Revision  float64 `json:"revision,omitempty"`
	Draft     bool    `json:"draft,omitempty"`
	Update    bool    `json:"update,omitempty"`
	// Category names the frame's kind without a top-level `kind`: card frames are
	// progress cards or cards, drafts are text not yet settled. A top-level `kind`
	// would collide with the task board's event shape in dsh/collab/desk.mjs.
	Category string    `json:"category,omitempty"`
	Time     time.Time `json:"time"`
	Role     RoleState `json:"role"`
}

// roleMessageLog remembers what this connection already sent for each message id.
// A frame repeating the same revision and text is a duplicate; a different revision
// or text for a known id is an update, never a new bubble. Revision alone cannot
// decide: created_at and changed_at are both milliseconds, and a commit can land in
// the same millisecond as the last streamed edit.
type roleMessageLog map[int64]struct {
	revision float64
	text     string
}

func (l roleMessageLog) accept(ev *RoleEvent) bool {
	if ev.Type != "speech" || ev.MessageID == 0 {
		return true
	}
	prev, seen := l[ev.MessageID]
	if seen {
		if prev.revision == ev.Revision && prev.text == ev.Text {
			return false
		}
		ev.Update = true
	}
	l[ev.MessageID] = struct {
		revision float64
		text     string
	}{ev.Revision, ev.Text}
	return true
}

// The broker remembers only the thinking phase. Busy truth stays in Session/team state.
// Subscribers own reading; the broker alone closes channels. A slow consumer reconnects
// for a fresh snapshot instead of blocking an agent or silently losing an event.
type roleEventBroker struct {
	mu          sync.Mutex
	thinking    map[string]map[string]bool
	subscribers map[chan RoleEvent]struct{}
}

func newRoleEventBroker() *roleEventBroker {
	return &roleEventBroker{thinking: map[string]map[string]bool{}, subscribers: map[chan RoleEvent]struct{}{}}
}

func (b *roleEventBroker) subscribe() (<-chan RoleEvent, func()) {
	// 来源：沿用 agent/qoder/session.go 的事件通道容量。
	ch := make(chan RoleEvent, 64)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if _, ok := b.subscribers[ch]; ok {
			delete(b.subscribers, ch)
			close(ch)
		}
	}
}

func (b *roleEventBroker) publish(ev RoleEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ev.Status == "thinking" {
		if b.thinking[ev.RoleKey] == nil {
			b.thinking[ev.RoleKey] = map[string]bool{}
		}
		b.thinking[ev.RoleKey][ev.SessionKey] = true
	} else {
		delete(b.thinking[ev.RoleKey], ev.SessionKey)
		if len(b.thinking[ev.RoleKey]) == 0 {
			delete(b.thinking, ev.RoleKey)
		}
	}
	for ch := range b.subscribers {
		select {
		case ch <- ev:
		default:
			delete(b.subscribers, ch)
			close(ch)
		}
	}
}

func (b *roleEventBroker) phase(role, session string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.thinking[role][session] {
		return "thinking"
	}
	return "working"
}

func (e *Engine) publishRoleEvent(session, status, text string) {
	if b := e.roleEvents.Load(); b != nil {
		b.publish(RoleEvent{Type: status, RoleKey: "bridge:" + e.name, SessionKey: session, Status: status, Text: text, Time: time.Now().UTC()})
	}
}

func (e *Engine) observeRoleAgentEvent(session string, ev Event, textParts []string) {
	if e.roleEvents.Load() == nil {
		return
	}
	switch ev.Type {
	case EventThinking:
		e.publishRoleEvent(session, "thinking", "") // reasoning text is private, never forwarded
	case EventToolUse, EventPermissionRequest:
		e.publishRoleEvent(session, "working", "")
	case EventError:
		e.publishRoleEvent(session, "error", "")
	case EventResult:
		if !ev.Done {
			return
		}
		_, quota := QuotaExhaustedReset(ev)
		if ev.Error != nil || quota {
			e.publishRoleEvent(session, "error", "")
			return
		}
		text := ev.Content
		if text == "" {
			text = strings.Join(textParts, "")
		}
		if isSilentReply(text) {
			text = ""
		} else if stripped, ok := stripTrailingSilent(text); ok {
			text = stripped
		}
		e.publishRoleEvent(session, "celebrate", text)
	}
}

func mergeRoleState(role *RoleState) {
	// 来源：#421 交接规定 error > working > thinking > celebrate > idle。
	priority := map[string]int{"idle": 0, "celebrate": 1, "thinking": 2, "working": 3, "error": 4}
	role.Status, role.BusyCount = "idle", 0
	sort.Slice(role.Sessions, func(i, j int) bool { return role.Sessions[i].SessionKey < role.Sessions[j].SessionKey })
	for _, s := range role.Sessions {
		if s.Busy {
			role.BusyCount++
		}
		if priority[s.Status] > priority[role.Status] {
			role.Status = s.Status
		}
	}
}

func (m *ManagementServer) bridgeRoleStates() []RoleState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	roles := make([]RoleState, 0, len(m.engines))
	for name, e := range m.engines {
		role := RoleState{RoleKey: "bridge:" + name, Source: "bridge", Name: name, DisplayName: e.DisplayName(), Sessions: []RoleSessionState{}}
		e.platformLifecycleMu.Lock()
		for _, ready := range e.platformReady {
			role.Online = role.Online || ready
		}
		e.platformLifecycleMu.Unlock()
		byKey := map[string]RoleSessionState{}
		keys, _ := e.sessions.SessionKeyMap()
		for _, session := range e.sessions.AllSessions() {
			key := keys[session.ID]
			if key == "" {
				key = session.ID
			}
			s := RoleSessionState{SessionKey: key, Status: "idle", Busy: session.Busy()}
			if s.Busy {
				s.Status = m.roleEvents.phase(role.RoleKey, key)
			}
			prev, exists := byKey[key]
			if !exists || !prev.Busy {
				byKey[key] = s
			}
		}
		// Workspaces and relay sessions can use another SessionManager. Reuse the same
		// team.seen source as GET /roles, deduping against the primary manager by key.
		if e.team != nil {
			e.team.mu.Lock()
			for key, ts := range e.team.seen {
				busy := ts.session != nil && ts.session.Busy()
				if ts.relay != nil {
					ts.relay.mu.Lock()
					busy = ts.relay.entry.Busy
					ts.relay.mu.Unlock()
				}
				if busy {
					byKey[key] = RoleSessionState{SessionKey: key, Status: m.roleEvents.phase(role.RoleKey, key), Busy: true}
				}
			}
			e.team.mu.Unlock()
		}
		for _, s := range byKey {
			role.Sessions = append(role.Sessions, s)
		}
		mergeRoleState(&role)
		roles = append(roles, role)
	}
	sort.Slice(roles, func(i, j int) bool { return roles[i].RoleKey < roles[j].RoleKey })
	return roles
}

func dshRoleStates(st *dshState) []RoleState {
	roles := []RoleState{}
	for _, mb := range st.Members {
		if mb.ID == "" || mb.Kind == "human" {
			continue
		}
		role := RoleState{RoleKey: "dsh:" + mb.ID, Source: "dsh", Name: mb.ID, DisplayName: mb.Name, Online: mb.Online, Sessions: []RoleSessionState{}}
		if role.DisplayName == "" {
			role.DisplayName = mb.ID
		}
		for room, members := range st.Thinking {
			for _, id := range members {
				if mb.Online && id == mb.ID {
					role.Sessions = append(role.Sessions, RoleSessionState{SessionKey: room, Status: "thinking", Busy: true})
					break
				}
			}
		}
		// Presence exposes only one busy_chat label, not a stable room ID. Do not
		// count it as an extra session when thinking already identifies active rooms.
		if mb.Online && mb.Busy && len(role.Sessions) == 0 {
			key := ""
			if mb.BusyChat != nil {
				key = *mb.BusyChat
			}
			role.Sessions = append(role.Sessions, RoleSessionState{SessionKey: key, Status: "working", Busy: true})
		}
		if mb.Error != "" {
			role.Sessions = append(role.Sessions, RoleSessionState{Status: "error"})
		}
		mergeRoleState(&role)
		// Presence confirms work even when room-level thinking identifies the
		// same sessions. It changes the role phase without inventing another room.
		if mb.Online && mb.Busy && role.Status != "error" {
			role.Status = "working"
		}
		roles = append(roles, role)
	}
	sort.Slice(roles, func(i, j int) bool { return roles[i].RoleKey < roles[j].RoleKey })
	return roles
}

func roleWithEvent(role RoleState, ev RoleEvent) RoleState {
	role.Sessions = append([]RoleSessionState{}, role.Sessions...)
	found := false
	for i := range role.Sessions {
		if role.Sessions[i].SessionKey == ev.SessionKey {
			role.Sessions[i].Status = ev.Status
			role.Sessions[i].Busy = ev.Status == "working" || ev.Status == "thinking"
			found = true
		}
	}
	if !found {
		role.Sessions = append(role.Sessions, RoleSessionState{SessionKey: ev.SessionKey, Status: ev.Status, Busy: ev.Status == "working" || ev.Status == "thinking"})
	}
	mergeRoleState(&role)
	return role
}
