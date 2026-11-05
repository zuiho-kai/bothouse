package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
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

type dshState struct {
	Rooms []struct {
		ID   json.Number `json:"id"`
		Name string      `json:"name"`
	} `json:"rooms"`
	Members  []dshStateMember    `json:"members"`
	Thinking map[string][]string `json:"thinking"`
}

// dshRoles lists DSH's own members as roles; nil when DSH is not running or does not answer
// (the page then shows the bridge roles alone, as before).
func (m *ManagementServer) dshRoles(ctx context.Context) []RoleInfo {
	target, launchToken, err := runningDSHWeb()
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, dshRolesTimeout)
	defer cancel()
	st, err := fetchDSHState(ctx, &dshProxyTransport{p: m.dshProxyHandler(), target: target, launchToken: launchToken}, target)
	if err != nil {
		return nil
	}
	return dshStateRoles(st)
}

func fetchDSHState(ctx context.Context, rt http.RoundTripper, target string) (*dshState, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+target+"/collab/api/state", nil)
	if err != nil {
		return nil, err
	}
	req.Host = target // DSH's Host fence admits loopback only
	res, err := rt.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("dsh state: HTTP %d", res.StatusCode)
	}
	var st dshState
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&st); err != nil {
		return nil, err
	}
	return &st, nil
}

// dshStateRoles turns DSH's members into roles. Only kind "dsh" (members DSH runs itself): "bot"
// members are bridge roles already listed from the engines, and "human" is the owner.
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
		if mb.Kind != "dsh" || mb.ID == "" {
			continue
		}
		agentType := "dsh"
		if mb.CLI != "" {
			agentType = mb.CLI
		}
		model := "DSH 默认"
		if mb.Model != nil && *mb.Model != "" {
			model = *mb.Model
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
