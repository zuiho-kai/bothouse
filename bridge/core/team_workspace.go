package core

// Team mode D (Discord side): every chat channel of the team lead gets a 「工作区1」
// channel in the same category, so the chat channel stays free for talking with the
// user while big work moves to a workspace. More workspaces (「工作区n+1」) are only
// created on request — by the lead or by the role doing the work (POST
// /team/workspace/new, `bothouse workspace new`), never automatically.
//
// Source: user 2026-10-24 00:50「默认给我们频道建立工作区1，我们预期是一个频道管理全部工作……
// 如果工作区1频道繁忙的话，在聊天的频道会新建工作区n+1去分配工作……这个由工作角色或者主角色决定」;
// 00:52「做成产品功能」. Ported from the operator script ws-handoff (contrib/lead/ws-handoff).
//
// The parent → workspaces relation lives in <data_dir>/team_workspaces.json so any
// project of the process can answer WorkspaceParent.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// TeamChannel is one guild text channel as seen by the team workspace logic.
type TeamChannel struct {
	ID       string
	Name     string
	ParentID string // category ("" = no category)
}

// ErrNotTeamChannel: the channel cannot have workspaces (DM, thread, voice, …).
var ErrNotTeamChannel = errors.New("not a guild text channel")

// TeamWorkspaceChannels is implemented by platforms that can create workspace
// channels (only Discord for now).
type TeamWorkspaceChannels interface {
	// TeamGuildChannels returns channelID itself and every text channel of its guild.
	// It returns ErrNotTeamChannel (wrapped) when channelID is not a guild text channel.
	TeamGuildChannels(ctx context.Context, channelID string) (self TeamChannel, all []TeamChannel, err error)
	// CreateTeamWorkspaceChannel creates a text channel named name in the same guild
	// and category as besideChannelID.
	CreateTeamWorkspaceChannel(ctx context.Context, besideChannelID, name string) (TeamChannel, error)
}

const (
	teamWorkspaceFile   = "team_workspaces.json"
	teamWorkspacePrefix = "工作区" // naming 「工作区n」: user 00:50「工作区1」「工作区n+1」
	teamWorkspacePlat   = "discord"
)

// 「工作区」 without a number is the name the old ws-handoff script used.
var teamWorkspaceName = regexp.MustCompile(`^` + teamWorkspacePrefix + `(\d*)$`)

// Retry while the platform is still connecting at start (same bound as the board retirement).
var (
	teamWorkspaceStartTries = 30
	teamWorkspaceStartEvery = 10 * time.Second
)

// TeamWorkspace is one workspace channel of a chat channel.
type TeamWorkspace struct {
	Name    string    `json:"name"`
	ID      string    `json:"id"`
	Created time.Time `json:"created,omitzero"`
}

type teamWorkspaceState struct {
	// Parents: "discord:<chat channel id>" → its workspaces in creation order.
	Parents map[string][]TeamWorkspace `json:"parents"`
}

type teamWorkspaces struct {
	mu   sync.Mutex
	seen map[string]bool // chat keys handled since start (ensured or not eligible)
}

// teamWorkspaceStore serializes every read/write of the state files of this process.
var teamWorkspaceStore struct {
	mu    sync.Mutex
	cache map[string]*teamWorkspaceState // path → state
}

func teamWorkspacePath(dataDir string) string {
	return filepath.Join(dataDir, teamWorkspaceFile)
}

// loadTeamWorkspacesLocked returns the cached state for path; caller holds teamWorkspaceStore.mu.
func loadTeamWorkspacesLocked(path string) *teamWorkspaceState {
	if st := teamWorkspaceStore.cache[path]; st != nil {
		return st
	}
	st := &teamWorkspaceState{Parents: map[string][]TeamWorkspace{}}
	if raw, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(raw, st); err != nil {
			slog.Warn("team workspace: bad state file", "path", path, "error", err)
		}
		if st.Parents == nil {
			st.Parents = map[string][]TeamWorkspace{}
		}
	}
	if teamWorkspaceStore.cache == nil {
		teamWorkspaceStore.cache = map[string]*teamWorkspaceState{}
	}
	teamWorkspaceStore.cache[path] = st
	return st
}

func saveTeamWorkspacesLocked(path string, st *teamWorkspaceState) error {
	out, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(path, out, 0o600)
}

// teamChatKey normalizes "discord:123", "discord:123:user" or a bare "123" to "discord:123".
func teamChatKey(channel string) string {
	if !strings.Contains(channel, ":") {
		return teamWorkspacePlat + ":" + channel
	}
	return chatOf(channel)
}

func teamChannelID(chatKey string) string {
	_, id, _ := strings.Cut(chatKey, ":")
	return id
}

// WorkspaceParent returns the chat channel a workspace channel belongs to. channelID may be
// a bare Discord channel ID or a session key ("discord:<id>[:user]"); parentID has the same
// form as the input (bare ID in, bare ID out). ok is false for channels that are not a
// recorded workspace. Used by the unified exit (team mode C).
func (e *Engine) WorkspaceParent(channelID string) (parentID string, ok bool) {
	if e == nil || e.dataDir == "" || channelID == "" {
		return "", false
	}
	key := teamChatKey(channelID)
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	plat, _, _ := strings.Cut(key, ":")
	id := teamChannelID(key)
	for parent, list := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != plat {
			continue
		}
		for _, w := range list {
			if w.ID == id {
				if strings.Contains(channelID, ":") {
					return parent, true
				}
				return teamChannelID(parent), true
			}
		}
	}
	return "", false
}

// TeamWorkspacesOf returns the recorded workspaces of a chat channel (bare ID or session key).
func (e *Engine) TeamWorkspacesOf(channel string) []TeamWorkspace {
	if e == nil || e.dataDir == "" {
		return nil
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	return append([]TeamWorkspace(nil), st.Parents[teamChatKey(channel)]...)
}

// SetTeamWorkspaces turns team mode D on or off. It only acts on the team lead
// (team_status_inject); on start it backfills 「工作区1」 for the lead's existing channels.
func (e *Engine) SetTeamWorkspaces(on bool) {
	if !on || !e.isTeamLead() {
		e.teamWS = nil
		return
	}
	if e.teamWS != nil {
		return
	}
	e.teamWS = &teamWorkspaces{seen: map[string]bool{}}
	go e.backfillTeamWorkspaces()
}

func (e *Engine) teamWorkspacePlatform() (TeamWorkspaceChannels, bool) {
	p, ok := e.platformForName(teamWorkspacePlat).(TeamWorkspaceChannels)
	return p, ok
}

// backfillTeamWorkspaces ensures 「工作区1」 for every Discord channel the lead already has a
// session in. Channels that fail because the platform is not connected yet are retried.
func (e *Engine) backfillTeamWorkspaces() {
	tick := time.NewTicker(teamWorkspaceStartEvery)
	defer tick.Stop()
	for try := 0; try < teamWorkspaceStartTries; try++ {
		if e.teamWS == nil {
			return
		}
		pending := 0
		for _, chat := range e.teamLeadChats() {
			if err := e.ensureTeamWorkspace(chat); err != nil {
				pending++
				slog.Warn("team workspace: ensure failed, will retry", "chat", chat, "error", err)
			}
		}
		if pending == 0 {
			return
		}
		select {
		case <-e.ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// teamLeadChats lists the distinct Discord chats ("discord:<id>") of the lead's sessions.
func (e *Engine) teamLeadChats() []string {
	if e.sessions == nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, k := range e.sessions.UserKeys() {
		if !strings.HasPrefix(k, teamWorkspacePlat+":") {
			continue
		}
		c := chatOf(k)
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

// teamWorkspaceNoteChat ensures 「工作区1」 for a channel the lead sees for the first time.
func (e *Engine) teamWorkspaceNoteChat(sessionKey string) {
	ws := e.teamWS
	if ws == nil || !strings.HasPrefix(sessionKey, teamWorkspacePlat+":") {
		return
	}
	chat := chatOf(sessionKey)
	ws.mu.Lock()
	done := ws.seen[chat]
	ws.mu.Unlock()
	if done {
		return
	}
	go func() {
		if err := e.ensureTeamWorkspace(chat); err != nil {
			slog.Warn("team workspace: ensure failed", "chat", chat, "error", err)
		}
	}()
}

// ensureTeamWorkspace makes sure chat has 「工作区1」. A nil error means done (created,
// already there, or the channel cannot have workspaces).
func (e *Engine) ensureTeamWorkspace(chat string) error {
	ws := e.teamWS
	if ws == nil {
		return nil
	}
	ws.mu.Lock()
	if ws.seen[chat] {
		ws.mu.Unlock()
		return nil
	}
	ws.mu.Unlock()
	_, created, err := e.teamWorkspaceOp(chat, false)
	if errors.Is(err, ErrNotTeamChannel) || errors.Is(err, errTeamIsWorkspace) {
		err = nil
	}
	if err != nil {
		return err
	}
	ws.mu.Lock()
	ws.seen[chat] = true
	ws.mu.Unlock()
	if created != nil {
		slog.Info("team workspace: created", "chat", chat, "name", created.Name, "id", created.ID)
	}
	return nil
}

var teamWorkspaceOpMu sync.Mutex

var errTeamIsWorkspace = errors.New("channel is a workspace")

// NewTeamWorkspace creates the next workspace 「工作区n+1」 of the chat channel of
// sessionKey. Called from a workspace channel, it adds to that workspace's chat channel.
func (e *Engine) NewTeamWorkspace(sessionKey string) (parent string, w TeamWorkspace, err error) {
	if e.teamWS == nil {
		return "", TeamWorkspace{}, fmt.Errorf("team workspaces are off for project %q (team_workspaces, lead only)", e.name)
	}
	chat := teamChatKey(sessionKey)
	if p, ok := e.WorkspaceParent(chat); ok {
		chat = p
	}
	_, created, err := e.teamWorkspaceOp(chat, true)
	if errors.Is(err, errTeamIsWorkspace) {
		err = fmt.Errorf("team workspace: %s is itself a workspace channel; call this from its chat channel", chat)
	}
	if err != nil {
		return chat, TeamWorkspace{}, err
	}
	return chat, *created, nil
}

// teamWorkspaceOp reconciles chat's recorded workspaces with the guild and then either ensures
// 「工作区1」 (next=false) or creates the next 「工作区n+1」 (next=true). It returns the
// workspaces after the operation and the one it created (nil if none).
func (e *Engine) teamWorkspaceOp(chat string, next bool) ([]TeamWorkspace, *TeamWorkspace, error) {
	plat, ok := e.teamWorkspacePlatform()
	if !ok || e.dataDir == "" {
		return nil, nil, fmt.Errorf("team workspace: no discord platform or data dir")
	}
	// One operation at a time, from listing the guild to saving, so two calls never both
	// create 「工作区1」 or read a guild listing taken before the other's create.
	teamWorkspaceOpMu.Lock()
	defer teamWorkspaceOpMu.Unlock()
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	self, guild, err := plat.TeamGuildChannels(ctx, teamChannelID(chat))
	if err != nil {
		return nil, nil, err
	}

	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)

	claimed := map[string]string{} // workspace id → parent chat
	for parent, list := range st.Parents {
		for _, w := range list {
			claimed[w.ID] = parent
		}
	}
	if _, isChild := claimed[self.ID]; isChild || teamWorkspaceName.MatchString(self.Name) {
		return nil, nil, errTeamIsWorkspace
	}

	byID := map[string]TeamChannel{}
	for _, c := range guild {
		byID[c.ID] = c
	}
	// Drop recorded workspaces whose channel was deleted; keep the record's name up to date.
	changed := false
	var list []TeamWorkspace
	for _, w := range st.Parents[chat] {
		c, ok := byID[w.ID]
		if !ok {
			changed = true
			continue
		}
		if c.Name != w.Name {
			w.Name, changed = c.Name, true
		}
		list = append(list, w)
	}
	hasNum := func(n int) bool {
		for _, w := range list {
			if teamWorkspaceNum(w.Name) == n {
				return true
			}
		}
		return false
	}
	// Adopt an unclaimed 「工作区1」 already in the same category (e.g. made by ws-handoff).
	if !hasNum(1) {
		for _, c := range guild {
			if c.ParentID == self.ParentID && c.ID != self.ID && claimed[c.ID] == "" && teamWorkspaceNum(c.Name) == 1 {
				list = append(list, TeamWorkspace{Name: c.Name, ID: c.ID})
				claimed[c.ID] = chat
				changed = true
				break
			}
		}
	}

	var name string
	switch {
	case !hasNum(1):
		name = teamWorkspacePrefix + "1"
	case next:
		// n+1 over this chat's workspaces and every 「工作区n」 in the category, so names don't clash.
		top := 0
		for _, w := range list {
			top = max(top, teamWorkspaceNum(w.Name))
		}
		for _, c := range guild {
			if c.ParentID == self.ParentID {
				top = max(top, teamWorkspaceNum(c.Name))
			}
		}
		name = teamWorkspacePrefix + strconv.Itoa(top+1)
	}
	var created *TeamWorkspace
	if name != "" {
		c, err := plat.CreateTeamWorkspaceChannel(ctx, self.ID, name)
		if err != nil {
			if changed {
				st.Parents[chat] = list
				_ = saveTeamWorkspacesLocked(path, st)
			}
			return list, nil, err
		}
		created = &TeamWorkspace{Name: c.Name, ID: c.ID, Created: time.Now().UTC()}
		list = append(list, *created)
		changed = true
	}
	if changed {
		if len(list) == 0 {
			delete(st.Parents, chat)
		} else {
			st.Parents[chat] = list
		}
		if err := saveTeamWorkspacesLocked(path, st); err != nil {
			return list, created, fmt.Errorf("team workspace: save state: %w", err)
		}
	}
	return list, created, nil
}

// teamWorkspaceNum returns n for 「工作区n」 (1 for the unnumbered 「工作区」), 0 otherwise.
func teamWorkspaceNum(name string) int {
	m := teamWorkspaceName.FindStringSubmatch(name)
	if m == nil {
		return 0
	}
	if m[1] == "" {
		return 1
	}
	n, _ := strconv.Atoi(m[1])
	return n
}
