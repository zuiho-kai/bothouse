package core

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"time"
)

// 来源：沿用 dsh/collab/team-status.mjs 的 2 秒 presence 刷新周期。
const roleStateRefresh = 2 * time.Second

type roleSnapshot struct {
	Roles []RoleState `json:"roles"`
	DSH   dshStatus   `json:"dsh"`
	Time  time.Time   `json:"time"`
}

type dshRoleUpdate struct {
	state  *dshState
	status dshStatus
	event  *RoleEvent
}

func (m *ManagementServer) handleRoleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		mgmtError(w, http.StatusInternalServerError, "streaming unavailable")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	events, unsubscribe := m.roleEvents.subscribe()
	defer unsubscribe()
	updates := make(chan dshRoleUpdate)
	done := make(chan struct{})
	go func() { defer close(done); m.watchDSHRoleEvents(ctx, updates) }()
	defer func() { cancel(); <-done }()

	// DSH watcher emits its initial state even when stopped/unavailable.
	var dsh dshRoleUpdate
	select {
	case <-ctx.Done():
		return
	case dsh = <-updates:
	}
	snapshot := func() roleSnapshot {
		roles := m.bridgeRoleStates()
		if dsh.state != nil {
			roles = append(roles, dshRoleStates(dsh.state)...)
		}
		return roleSnapshot{Roles: roles, DSH: dsh.status, Time: time.Now().UTC()}
	}
	sse := pcSSE{w: w}
	w.Header().Set("X-Accel-Buffering", "no")
	previous := snapshot()
	sse.event("snapshot", previous)

	sendChanges := func() {
		next := snapshot()
		old := map[string]RoleState{}
		for _, role := range previous.Roles {
			old[role.RoleKey] = role
		}
		for _, role := range next.Roles {
			if !reflect.DeepEqual(old[role.RoleKey], role) {
				sse.event(role.Status, RoleEvent{Type: role.Status, RoleKey: role.RoleKey, Status: role.Status, Time: next.Time, Role: role})
			}
		}
		// Snapshots reconcile additions/removals and source availability atomically.
		if len(next.Roles) != len(previous.Roles) || !reflect.DeepEqual(next.DSH, previous.DSH) {
			sse.event("snapshot", next)
		} else {
			for key := range old {
				found := false
				for _, role := range next.Roles {
					if role.RoleKey == key {
						found = true
						break
					}
				}
				if !found {
					sse.event("snapshot", next)
					break
				}
			}
		}
		previous = next
	}
	sendEvent := func(ev RoleEvent) {
		for _, role := range snapshot().Roles {
			if role.RoleKey != ev.RoleKey {
				continue
			}
			ev.Role = role
			if ev.Type != "speech" {
				ev.Role = roleWithEvent(role, ev)
			}
			if ev.Text != "" {
				speech := ev
				speech.Type = "speech"
				sse.event("speech", speech)
			}
			if ev.Type != "speech" {
				ev.Text = ""
				sse.event(ev.Type, ev)
			}
			for i := range previous.Roles {
				if previous.Roles[i].RoleKey == ev.RoleKey {
					previous.Roles[i] = ev.Role
				}
			}
			return
		}
	}
	ticker := time.NewTicker(roleStateRefresh)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			} // slow client: reconnect to recover state
			sendEvent(ev)
		case update := <-updates:
			if update.state != nil {
				dsh.state = update.state
			}
			dsh.status = update.status
			sendChanges()
			if update.event != nil {
				sendEvent(*update.event)
			}
		case <-ticker.C:
			sendChanges()
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			if err := http.NewResponseController(w).Flush(); err != nil {
				return
			}
		}
	}
}

func (m *ManagementServer) watchDSHRoleEvents(ctx context.Context, out chan<- dshRoleUpdate) {
	send := func(u dshRoleUpdate) bool {
		select {
		case out <- u:
			return true
		case <-ctx.Done():
			return false
		}
	}
	for ctx.Err() == nil {
		c, status := m.dshClient()
		if status.Status != "running" {
			if !send(dshRoleUpdate{status: status}) {
				return
			}
		} else {
			if err := streamDSHRoleEvents(ctx, c, send); err != nil && ctx.Err() == nil {
				if !send(dshRoleUpdate{status: dshStatus{Status: "error", Error: "DSH role events disconnected"}}) {
					return
				}
			}
		}
		timer := time.NewTimer(dshRolesTimeout)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func streamDSHRoleEvents(ctx context.Context, c dshAPI, send func(dshRoleUpdate) bool) error {
	// Subscribe before reading state: events occurring during GET /state stay in the
	// HTTP stream, so the initial snapshot cannot miss a transition in that window.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+c.target+"/collab/api/events", nil)
	if err != nil {
		return err
	}
	req.Host = c.target
	// Bound the initial headers using the existing DSH read timeout; keep the
	// established event stream alive until its subscriber disconnects.
	streamCtx, cancelStream := context.WithCancel(ctx)
	defer cancelStream()
	req = req.WithContext(streamCtx)
	headerTimer := time.AfterFunc(dshRolesTimeout, cancelStream)
	res, err := c.rt.RoundTrip(req)
	headerTimer.Stop()
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("DSH events: HTTP %d", res.StatusCode)
	}
	stateCtx, cancel := context.WithTimeout(ctx, dshRolesTimeout)
	var st dshState
	err = c.get(stateCtx, "/collab/api/state", &st)
	cancel()
	if err != nil {
		return err
	}
	running := dshStatus{Status: "running"}
	if !send(dshRoleUpdate{state: cloneDSHRoleState(st), status: running}) {
		return ctx.Err()
	}
	scanner := bufio.NewScanner(res.Body)
	// 来源：沿用 dshAPI.get 的 4 MiB 响应读取上限，消息可包含长文本。
	scanner.Buffer(nil, 4<<20)
	var data []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			continue
		}
		if line != "" || len(data) == 0 {
			continue
		}
		var event struct {
			Type    string           `json:"type"`
			Members []dshStateMember `json:"members"`
			Room    json.Number      `json:"room_id"`
			Rooms   []dshStateRoom   `json:"rooms"`
			Message struct {
				Author    string      `json:"author"`
				Kind      string      `json:"author_kind"`
				Room      json.Number `json:"room_id"`
				Text      string      `json:"text"`
				CreatedAt float64     `json:"created_at"`
			} `json:"message"`
		}
		raw := strings.Join(data, "\n")
		data = nil
		// thinking.members contains IDs; members.members contains full member rows.
		var envelope struct {
			Type    string          `json:"type"`
			Members json.RawMessage `json:"members"`
		}
		if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
			return fmt.Errorf("decode DSH event: %w", err)
		}
		var ids []string
		if envelope.Type == "thinking" {
			var thinking struct {
				Room    json.Number `json:"room_id"`
				Members []string    `json:"members"`
			}
			if err := json.Unmarshal([]byte(raw), &thinking); err != nil {
				return err
			}
			ids = thinking.Members
			if st.Thinking == nil {
				st.Thinking = map[string][]string{}
			}
			before := st.Thinking[thinking.Room.String()]
			st.Thinking[thinking.Room.String()] = ids
			if !send(dshRoleUpdate{state: cloneDSHRoleState(st), status: running}) {
				return ctx.Err()
			}
			for _, id := range before {
				stillBusy := false
				for _, active := range ids {
					if id == active {
						stillBusy = true
						break
					}
				}
				if !stillBusy {
					ev := RoleEvent{Type: "celebrate", RoleKey: "dsh:" + id, SessionKey: thinking.Room.String(), Status: "celebrate", Time: time.Now().UTC()}
					if !send(dshRoleUpdate{status: running, event: &ev}) {
						return ctx.Err()
					}
				}
			}
			continue
		}
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			return err
		}
		switch event.Type {
		case "members":
			st.Members = event.Members
		case "rooms":
			st.Rooms = event.Rooms
		case "message":
			msg := event.Message
			if msg.Kind != "role" {
				continue
			}
			found := false
			for _, member := range st.Members {
				if member.ID == msg.Author && member.Kind != "human" {
					found = true
					break
				}
			}
			if !found {
				continue
			}
			status := "idle"
			for _, role := range dshRoleStates(&st) {
				if role.RoleKey == "dsh:"+msg.Author {
					status = role.Status
					break
				}
			}
			ev := RoleEvent{Type: "speech", RoleKey: "dsh:" + msg.Author, SessionKey: msg.Room.String(), Status: status, Text: msg.Text, Time: time.Unix(0, int64(msg.CreatedAt*float64(time.Second))).UTC()}
			if !send(dshRoleUpdate{status: running, event: &ev}) {
				return ctx.Err()
			}
			continue
		default:
			continue
		}
		if !send(dshRoleUpdate{state: cloneDSHRoleState(st), status: running}) {
			return ctx.Err()
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return io.EOF
}

// A watcher keeps parsing while its consumer reads the previous snapshot.
func cloneDSHRoleState(st dshState) *dshState {
	st.Members = append([]dshStateMember{}, st.Members...)
	st.Rooms = append([]dshStateRoom{}, st.Rooms...)
	thinking := make(map[string][]string, len(st.Thinking))
	for room, ids := range st.Thinking {
		thinking[room] = append([]string{}, ids...)
	}
	st.Thinking = thinking
	return &st
}
