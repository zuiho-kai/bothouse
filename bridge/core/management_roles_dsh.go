package core

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// DSH members on the roles page. The panel's engines are bridge roles only; members created in DSH
// itself (the channels page) live in DSH's own store and are read from the running `dsh web` through
// the same signed-in transport the /dsh/ proxy uses. Read-only: DSH has no pause or restart for its
// members, so the page offers no controls for them.

const dshRolesTimeout = 3 * time.Second

// dshStateMember is the part of /collab/api/state members (hub.memberView + presence) the page shows.
type dshStateMember struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Online   bool     `json:"online"`
	Model    dshModel `json:"model"`
	CLI      string   `json:"cli"`
	Busy     bool     `json:"busy"`
	BusyTask string   `json:"busy_task"`
	BusyChat *string  `json:"busy_chat"`
}

type dshModel string

func (m *dshModel) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*m = ""
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var v string
		if err := json.Unmarshal(b, &v); err != nil {
			return err
		}
		*m = dshModel(v)
		return nil
	}
	var v struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*m = dshModel(v.Model)
	return nil
}

type dshStatus struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}
type dshStateRoom struct {
	ID   json.Number `json:"id"`
	Name string      `json:"name"`
	Kind string      `json:"kind"`
}

type dshState struct {
	Rooms    []dshStateRoom      `json:"rooms"`
	Members  []dshStateMember    `json:"members"`
	Thinking map[string][]string `json:"thinking"`
}

// dshRoles lists DSH members and reports whether their state was available.
func (m *ManagementServer) dshRoles(ctx context.Context) ([]RoleInfo, dshStatus) {
	ctx, cancel := context.WithTimeout(ctx, dshRolesTimeout)
	defer cancel()
	c, status := m.dshClient()
	if status.Status != "running" {
		return nil, status
	}
	var st dshState
	if err := c.get(ctx, "/collab/api/state", &st); err != nil {
		if errors.Is(err, errDSHWebNotRunning) {
			// A zero (unknown) pid is not judged stale up front; a host that is really gone
			// behind it shows here, as a refused dial — stopped, the same as a dead pid.
			return nil, dshStatus{Status: "stopped"}
		}
		return nil, dshStatus{Status: "error", Error: dshStateReadError(context.WithoutCancel(ctx), c.target, err)}
	}
	return dshStateRoles(&st), status
}

// dshAPI calls the running `dsh web` signed in as its owner (the /dsh/ proxy's cookie).
type dshAPI struct {
	rt     http.RoundTripper
	target string
}

func (m *ManagementServer) dshClient() (dshAPI, dshStatus) {
	target, launchToken, err := runningDSHWeb()
	if errors.Is(err, errDSHWebNotRunning) {
		// Discovery may heal a missing or malformed file from its log first. If it
		// could not, an existing unreadable file is an error, not a stopped host.
		if _, _, valid := readDSHWebState(); !valid {
			if _, statErr := os.Stat(dshWebStatePath()); statErr == nil || !os.IsNotExist(statErr) {
				return dshAPI{}, dshStatus{Status: "error", Error: dshHostStateReadable}
			}
		}
		return dshAPI{}, dshStatus{Status: "stopped"}
	}
	if err != nil {
		return dshAPI{}, dshStatus{Status: "error", Error: dshHostStateReadable}
	}
	return dshAPI{rt: &dshProxyTransport{p: m.dshProxyHandler(), target: target, launchToken: launchToken}, target: target}, dshStatus{Status: "running"}
}

func (c dshAPI) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+c.target+path, nil)
	if err != nil {
		return err
	}
	req.Host = c.target // DSH's Host fence admits loopback only
	res, err := c.rt.RoundTrip(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return &dshHTTPError{Path: path, Code: res.StatusCode}
	}
	return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out)
}

// dshStateRoles turns DSH's members into roles: every member that is an agent, i.e. kind "dsh"
// (members DSH runs itself) or "bot" (roles that registered into DSH, e.g. this machine's bots).
// The criterion is the hub's own routable() (dsh/collab/hub.mjs): kind != "human"; "human" is the
// owner, who is not routed. A "bot" member may also be an engine here — the same person seen from
// the bridge side and from DSH's side — so callers that count DSH members add to bridge counts
// should dedupe by id.
func dshStateRoles(st *dshState) []RoleInfo {
	roomName := map[string]string{}
	for _, r := range st.Rooms {
		roomName[r.ID.String()] = r.Name
	}
	thinkingIn := map[string]string{}
	for room, ids := range st.Thinking {
		for _, id := range ids {
			if _, ok := thinkingIn[id]; !ok {
				thinkingIn[id] = roomName[room]
			}
		}
	}
	roles := []RoleInfo{}
	for _, mb := range st.Members {
		if mb.ID == "" || mb.Kind == "human" {
			continue
		}
		agentType := "dsh" // the row is DSH's view of the agent, so the page labels it ·DSH
		if mb.Kind == "dsh" && mb.CLI != "" {
			agentType = mb.CLI
		}
		model := string(mb.Model)
		task := "空闲"
		busy := false
		if mb.Online {
			if room, ok := thinkingIn[mb.ID]; ok {
				busy = true
				task = "处理会话消息中"
				if room != "" {
					task = "在 #" + room + " 处理消息"
				}
			}
			if mb.Busy {
				busy = true
				switch {
				case mb.BusyTask != "":
					task = mb.BusyTask
				case mb.BusyChat != nil && *mb.BusyChat != "":
					task = "在 " + *mb.BusyChat + " 忙"
				case task == "空闲":
					task = "忙碌中"
				}
			}
		}
		name := mb.Name
		if name == "" {
			name = mb.ID
		}
		roles = append(roles, RoleInfo{
			Name:        "dsh:" + mb.ID,
			DisplayName: name,
			AgentType:   agentType,
			Model:       model,
			Online:      mb.Online,
			Busy:        busy,
			CurrentTask: task,
			Platforms:   []PlatformStatus{{Name: "dsh", Ready: mb.Online}},
			Source:      "dsh",
		})
	}
	sort.SliceStable(roles, func(i, j int) bool { return roles[i].DisplayName < roles[j].DisplayName })
	return roles
}

// ── DSH summary for the overview and sessions pages ───────────────

// DSHLastMessage mirrors the panel's session LastMessage (web/src/api/sessions.ts).
type DSHLastMessage struct {
	Role      string `json:"role"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
}

// DSHChannel is one DSH channel (chat, workspace or private chat) shown as a session.
type DSHChannel struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Kind        string          `json:"kind"`
	UpdatedAt   string          `json:"updated_at"`
	LastMessage *DSHLastMessage `json:"last_message"`
	Error       string          `json:"error,omitempty"`
}

// DSHSummary reports availability separately from successfully read members and channels.
type DSHSummary struct {
	Running  bool         `json:"running"`
	Status   string       `json:"status"`
	Error    string       `json:"error,omitempty"`
	Members  []RoleInfo   `json:"members"`
	Channels []DSHChannel `json:"channels"`
}

// dshSummaryChannels caps the per-channel last-message reads (one request each).
const dshSummaryChannels = 50

func (m *ManagementServer) handleDSHSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	mgmtJSON(w, http.StatusOK, m.dshSummary(r.Context()))
}

func (m *ManagementServer) dshSummary(ctx context.Context) DSHSummary {
	out := DSHSummary{Members: []RoleInfo{}, Channels: []DSHChannel{}}
	ctx, cancel := context.WithTimeout(ctx, dshRolesTimeout)
	defer cancel()
	c, status := m.dshClient()
	out.Status, out.Error = status.Status, status.Error
	if status.Status != "running" {
		return out
	}
	var st dshState
	if err := c.get(ctx, "/collab/api/state", &st); err != nil {
		out.Status, out.Error = "error", dshStateReadError(context.WithoutCancel(ctx), c.target, err)
		if errors.Is(err, errDSHWebNotRunning) {
			out.Status, out.Error = "stopped", "" // see dshRoles: gone behind a zero pid
		}
		return out
	}
	out.Running = true
	out.Members = dshStateRoles(&st)
	rooms := st.Rooms
	if len(rooms) > dshSummaryChannels {
		rooms = rooms[:dshSummaryChannels]
	}
	out.Channels = make([]DSHChannel, len(rooms))
	var wg sync.WaitGroup
	for i, room := range rooms {
		out.Channels[i] = DSHChannel{ID: room.ID.String(), Name: room.Name, Kind: room.Kind}
		wg.Add(1)
		go func(ch *DSHChannel) {
			defer wg.Done()
			var page struct {
				Messages []struct {
					AuthorKind string  `json:"author_kind"`
					Name       string  `json:"name"`
					Text       string  `json:"text"`
					CreatedAt  float64 `json:"created_at"`
				} `json:"messages"`
			}
			if c.get(ctx, "/api/rooms/"+ch.ID+"/messages?limit=1", &page) != nil {
				ch.Error = "DSH channel messages could not be read"
				return
			}
			if len(page.Messages) == 0 {
				return
			}
			last := page.Messages[len(page.Messages)-1]
			ts := time.Unix(0, int64(last.CreatedAt*1e9)).UTC().Format(time.RFC3339)
			role := "assistant"
			if last.AuthorKind == "user" {
				role = "user"
			}
			ch.UpdatedAt = ts
			ch.LastMessage = &DSHLastMessage{Role: role, Name: last.Name, Content: strings.TrimSpace(last.Text), Timestamp: ts}
		}(&out.Channels[i])
	}
	wg.Wait()
	sort.SliceStable(out.Channels, func(i, j int) bool { return out.Channels[i].UpdatedAt > out.Channels[j].UpdatedAt })
	return out
}
