package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	Online   bool    `json:"online"`
	Model    *string `json:"model"`
	CLI      string  `json:"cli"`
	Busy     bool    `json:"busy"`
	BusyTask string  `json:"busy_task"`
	BusyChat *string `json:"busy_chat"`
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

// dshRoles lists DSH's members as roles, minus those already among local (the bridge roles on
// this panel); nil when DSH is not running or does not answer (the page then shows the bridge
// roles alone, as before).
func (m *ManagementServer) dshRoles(ctx context.Context, local []RoleInfo) []RoleInfo {
	ctx, cancel := context.WithTimeout(ctx, dshRolesTimeout)
	defer cancel()
	c, ok := m.dshClient()
	if !ok {
		return nil
	}
	var st dshState
	if c.get(ctx, "/collab/api/state", &st) != nil {
		return nil
	}
	return dshStateRoles(&st, local)
}

// dshAPI calls the running `dsh web` signed in as its owner (the /dsh/ proxy's cookie).
type dshAPI struct {
	rt     http.RoundTripper
	target string
}

func (m *ManagementServer) dshClient() (dshAPI, bool) {
	target, launchToken, err := runningDSHWeb()
	if err != nil {
		return dshAPI{}, false
	}
	return dshAPI{rt: &dshProxyTransport{p: m.dshProxyHandler(), target: target, launchToken: launchToken}, target: target}, true
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
		return fmt.Errorf("dsh %s: HTTP %d", path, res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out)
}

// dshStateRoles turns DSH's members into roles: kind "dsh" (members DSH runs itself) and kind
// "bot" (bridge roles registered over cloud_web, #159), except a bot that is one of local, the
// bridge roles this panel already lists from its engines; "human" is the owner. A bot registers
// as its project (or ?bot=) with its team name, so it matches a local role by project name or by
// display name.
func dshStateRoles(st *dshState, local []RoleInfo) []RoleInfo {
	localKeys := map[string]bool{}
	for _, r := range local {
		for _, k := range []string{r.Name, r.DisplayName} {
			if k = strings.ToLower(strings.TrimSpace(k)); k != "" {
				localKeys[k] = true
			}
		}
	}
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
		if mb.ID == "" {
			continue
		}
		switch mb.Kind {
		case "dsh":
		case "bot":
			if localKeys[strings.ToLower(mb.ID)] || localKeys[strings.ToLower(strings.TrimSpace(mb.Name))] {
				continue
			}
		default:
			continue
		}
		agentType := "dsh"
		if mb.CLI != "" {
			agentType = mb.CLI
		}
		model := "DSH 默认"
		if mb.Model != nil && *mb.Model != "" {
			model = *mb.Model
		} else if mb.Kind == "bot" {
			model = "" // a bridge role's model lives in its own bridge; DSH does not report it
		}
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
}

// DSHSummary is GET /api/v1/dsh/summary: running=false when DSH is not up (everything else empty).
type DSHSummary struct {
	Running  bool         `json:"running"`
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
	c, ok := m.dshClient()
	if !ok {
		return out
	}
	var st dshState
	if c.get(ctx, "/collab/api/state", &st) != nil {
		return out
	}
	out.Running = true
	out.Members = dshStateRoles(&st, m.bridgeRoles())
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
			if c.get(ctx, "/api/rooms/"+ch.ID+"/messages?limit=1", &page) != nil || len(page.Messages) == 0 {
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
