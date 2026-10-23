package core

// Team mode D: a chat channel of the team lead gets workspace channels in the same
// category, so the chat channel stays free for talking with the user while big work moves
// to a workspace. Workspaces are only created on request — by the lead or by the role doing
// the work (POST /team/workspace/new, `bothouse workspace new`), never automatically: the
// first request makes 「工作区1」, later ones 「工作区n+1」 (team mode E, user 2026-10-24 on
// creating 工作区1 when the lead first sees a channel:「先不用，干活了再建」).
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

// ErrTeamWorkspacePermanent marks a platform error that retrying will not fix (Discord 4xx
// other than 429: no Manage Channels permission, channel deleted; Feishu: no im:chat). Each
// platform maps its own errors to it. The chat is then not
// retried until restart (code review of PR #135, item 2: no request flood per message).
var ErrTeamWorkspacePermanent = errors.New("permanent platform error")

// ErrTeamWorkspaceNotLeadChat: "new" was asked for a channel that is not a chat channel of
// the team lead on a platform with workspaces (code review of PR #135, item 3).
var ErrTeamWorkspaceNotLeadChat = errors.New("not a chat channel of the team lead on a platform with workspaces")

// TeamWorkspaceChannels is implemented by platforms that can create workspace channels
// (Discord, Feishu, cloud_web; team mode E, user 01:26「应该支持我们现有的dsh，discord，飞书，
// 自建平台」). Naming, n+1, backfill, the on/off switch and the lead check stay in core; the
// platform of a chat is the first segment of its session key ("<platform>:<id>").
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
	// teamWorkspaceBarePlat is the platform of a bare channel ID (no "<platform>:"), the
	// form team mode D's API and the unified exit already accept for Discord.
	teamWorkspaceBarePlat = "discord"
)

// 「工作区」 without a number is the name the old ws-handoff script used. A second chat channel in
// a category whose plain 「工作区n」 already belong to another chat channel gets
// 「<chat channel name>-工作区n」 instead, so two channels never share a workspace name
// (PM decision 2026-10-24 on team mode D, item 4: avoid same-name confusion).
var teamWorkspaceName = regexp.MustCompile(`^(?:(.+)-)?` + teamWorkspacePrefix + `(\d*)$`)

// TeamWorkspace is one workspace channel of a chat channel.
type TeamWorkspace struct {
	Name    string    `json:"name"`
	ID      string    `json:"id"`
	Created time.Time `json:"created,omitzero"`
}

type teamWorkspaceState struct {
	// Parents: "<platform>:<chat channel id>" → its workspaces in creation order.
	Parents map[string][]TeamWorkspace `json:"parents"`
}

type teamWorkspaces struct {
	mu       sync.Mutex
	inflight map[string]bool  // chat keys with an operation running (one per chat at a time)
	failed   map[string]error // chat keys with a permanent platform error, not retried until restart
}

func newTeamWorkspaces() *teamWorkspaces {
	return &teamWorkspaces{inflight: map[string]bool{}, failed: map[string]error{}}
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

// teamChatKey normalizes "<platform>:123", "<platform>:123:user" to "<platform>:123" and a
// bare Discord "123" to "discord:123".
func teamChatKey(channel string) string {
	if !strings.Contains(channel, ":") {
		return teamWorkspaceBarePlat + ":" + channel
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
// (team_status_inject) and creates nothing by itself.
func (e *Engine) SetTeamWorkspaces(on bool) {
	if !on || !e.isTeamLead() {
		e.teamWS = nil
		return
	}
	if e.teamWS != nil {
		return
	}
	e.teamWS = newTeamWorkspaces()
}

// teamWorkspacePlatform returns the platform of chat ("<platform>:<id>") when it can have
// workspaces.
func (e *Engine) teamWorkspacePlatform(chat string) (TeamWorkspaceChannels, bool) {
	name, _, found := strings.Cut(chat, ":")
	if !found || name == "" {
		return nil, false
	}
	p, ok := e.platformForName(name).(TeamWorkspaceChannels)
	return p, ok
}

// teamLeadChats lists the distinct chats ("<platform>:<id>") of the lead's sessions on
// platforms that can have workspaces.
func (e *Engine) teamLeadChats() []string {
	if e.sessions == nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, k := range e.sessions.UserKeys() {
		c := chatOf(k)
		if seen[c] {
			continue
		}
		if _, ok := e.teamWorkspacePlatform(c); ok {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

// isTeamLeadChat: the lead has a session in chat or chat already has recorded workspaces.
func (e *Engine) isTeamLeadChat(chat string) bool {
	if len(e.TeamWorkspacesOf(chat)) > 0 {
		return true
	}
	for _, c := range e.teamLeadChats() {
		if c == chat {
			return true
		}
	}
	return false
}

var teamWorkspaceOpMu sync.Mutex

var errTeamIsWorkspace = errors.New("channel is a workspace")

// ErrTeamWorkspaceBusy: an operation for the same chat channel is already running.
var ErrTeamWorkspaceBusy = errors.New("a workspace is already being created for this chat channel")

// NewTeamWorkspace creates the next workspace of the chat channel of sessionKey: 「工作区1」
// when it has none (or adopts an unclaimed one), else 「工作区n+1」. Called from a workspace
// channel, it adds to that workspace's chat channel. Only one call per chat channel runs at
// a time (ErrTeamWorkspaceBusy), and after a permanent platform error the chat is not
// retried until restart, so the platform's failure note (Feishu) goes out once (code review
// of PR #139, item 2).
func (e *Engine) NewTeamWorkspace(sessionKey string) (parent string, w TeamWorkspace, err error) {
	ws := e.teamWS
	if ws == nil {
		return "", TeamWorkspace{}, fmt.Errorf("team workspaces are off for project %q (team_workspaces, lead only)", e.name)
	}
	if _, ok := e.teamWorkspacePlatform(chatOf(sessionKey)); !ok {
		return "", TeamWorkspace{}, fmt.Errorf("team workspace: session key %q: %w", sessionKey, ErrTeamWorkspaceNotLeadChat)
	}
	chat := chatOf(sessionKey)
	if p, ok := e.WorkspaceParent(chat); ok {
		chat = p
	}
	if !e.isTeamLeadChat(chat) {
		return chat, TeamWorkspace{}, fmt.Errorf("team workspace: %s: %w", chat, ErrTeamWorkspaceNotLeadChat)
	}
	ws.mu.Lock()
	if ferr := ws.failed[chat]; ferr != nil {
		ws.mu.Unlock()
		return chat, TeamWorkspace{}, fmt.Errorf("team workspace: %s: failed earlier, restart to retry: %w", chat, ferr)
	}
	if ws.inflight[chat] {
		ws.mu.Unlock()
		return chat, TeamWorkspace{}, fmt.Errorf("team workspace: %s: %w", chat, ErrTeamWorkspaceBusy)
	}
	ws.inflight[chat] = true
	ws.mu.Unlock()
	// Cleared by defer so a panic in platform code (recovered by net/http) does not leave
	// the chat busy until restart.
	defer func() {
		ws.mu.Lock()
		delete(ws.inflight, chat)
		ws.mu.Unlock()
	}()
	list, created, err := e.teamWorkspaceOp(chat, true)
	if errors.Is(err, ErrTeamWorkspacePermanent) {
		ws.mu.Lock()
		ws.failed[chat] = err
		ws.mu.Unlock()
		slog.Warn("team workspace: permanent failure, not retrying until restart", "chat", chat, "error", err)
	}
	if err == nil && created == nil {
		// Adopted an existing unclaimed 「工作区1」: that is the workspace of this first request.
		for _, x := range list {
			if teamWorkspaceNum(x.Name) == 1 {
				return chat, x, nil
			}
		}
		return chat, TeamWorkspace{}, fmt.Errorf("team workspace: %s: nothing created", chat)
	}
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
	plat, ok := e.teamWorkspacePlatform(chat)
	if !ok || e.dataDir == "" {
		return nil, nil, fmt.Errorf("team workspace: %s: no platform with workspaces or no data dir", chat)
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
	list, name, changed, err := teamWorkspacePlan(path, chat, self, guild, next)
	if err != nil {
		return nil, nil, err
	}
	// Persist reconciling/adoption before the create, so a failed create keeps it.
	if changed {
		if err := teamWorkspaceStoreList(path, chat, list); err != nil {
			return list, nil, fmt.Errorf("team workspace: save state: %w", err)
		}
	}
	if name == "" {
		return list, nil, nil
	}
	// The platform request runs without teamWorkspaceStore.mu, so WorkspaceParent (reply path,
	// team mode C) never waits on the network; teamWorkspaceOpMu keeps operations serial.
	c, err := plat.CreateTeamWorkspaceChannel(ctx, self.ID, name)
	if err != nil {
		return list, nil, err
	}
	created := &TeamWorkspace{Name: c.Name, ID: c.ID, Created: time.Now().UTC()}
	list = append(list, *created)
	if err := teamWorkspaceStoreList(path, chat, list); err != nil {
		return list, created, fmt.Errorf("team workspace: save state: %w", err)
	}
	return list, created, nil
}

// teamWorkspaceStoreList records chat's workspaces (none = drop the entry) and saves.
func teamWorkspaceStoreList(path, chat string, list []TeamWorkspace) error {
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	if len(list) == 0 {
		delete(st.Parents, chat)
	} else {
		st.Parents[chat] = append([]TeamWorkspace(nil), list...)
	}
	return saveTeamWorkspacesLocked(path, st)
}

// teamWorkspacePlan reconciles chat's recorded workspaces with the guild listing (under
// teamWorkspaceStore.mu, no network) and returns the list, the name to create ("" = none)
// and whether the list differs from the record.
func teamWorkspacePlan(path, chat string, self TeamChannel, guild []TeamChannel, next bool) (list []TeamWorkspace, name string, changed bool, err error) {
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)

	// Channel IDs are only unique within a platform, so only this platform's records count.
	plat, _, _ := strings.Cut(chat, ":")
	claimed := map[string]string{} // workspace id → parent chat
	for parent, list := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != plat {
			continue
		}
		for _, w := range list {
			claimed[w.ID] = parent
		}
	}
	if _, isChild := claimed[self.ID]; isChild || teamWorkspaceName.MatchString(self.Name) {
		return nil, "", false, errTeamIsWorkspace
	}

	byID := map[string]TeamChannel{}
	for _, c := range guild {
		byID[c.ID] = c
	}
	// Drop recorded workspaces whose channel was deleted; keep the record's name up to date.
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
	// Name prefix of this chat's workspaces: the one it already uses; else plain 「工作区n」 unless
	// another chat channel of the category already owns plain ones, then 「<name>-工作区n」.
	prefix := ""
	if len(list) > 0 {
		prefix, _ = teamWorkspaceNameParts(list[0].Name)
	} else {
		for _, c := range guild {
			if c.ParentID != self.ParentID {
				continue
			}
			if p, n := teamWorkspaceNameParts(c.Name); n > 0 && p == "" && claimed[c.ID] != "" && claimed[c.ID] != chat {
				prefix = self.Name + "-"
				break
			}
		}
	}
	// Adopt an unclaimed 「工作区1」 (with this chat's prefix) already in the same category
	// (e.g. made by ws-handoff); adopting counts as this request's workspace.
	had1 := hasNum(1)
	if !had1 {
		for _, c := range guild {
			p, n := teamWorkspaceNameParts(c.Name)
			if c.ParentID == self.ParentID && c.ID != self.ID && claimed[c.ID] == "" && n == 1 && p == prefix {
				list = append(list, TeamWorkspace{Name: c.Name, ID: c.ID})
				claimed[c.ID] = chat
				changed = true
				break
			}
		}
	}

	switch {
	case !hasNum(1):
		name = prefix + teamWorkspacePrefix + "1"
	case next && had1:
		// n+1 over this chat's workspaces and every same-prefix 「工作区n」 in the category,
		// so names don't clash.
		top := 0
		for _, w := range list {
			top = max(top, teamWorkspaceNum(w.Name))
		}
		for _, c := range guild {
			if p, n := teamWorkspaceNameParts(c.Name); c.ParentID == self.ParentID && p == prefix {
				top = max(top, n)
			}
		}
		name = prefix + teamWorkspacePrefix + strconv.Itoa(top+1)
	}
	return list, name, changed, nil
}

// teamWorkspaceNum returns n for 「工作区n」 or 「<name>-工作区n」 (1 when unnumbered), 0 otherwise.
func teamWorkspaceNum(name string) int {
	_, n := teamWorkspaceNameParts(name)
	return n
}

// teamWorkspaceNameParts splits 「<name>-工作区n」 into ("<name>-", n) and 「工作区n」 into ("", n);
// n is 0 when name is not a workspace name.
func teamWorkspaceNameParts(name string) (prefix string, n int) {
	m := teamWorkspaceName.FindStringSubmatch(name)
	if m == nil {
		return "", 0
	}
	if m[1] != "" {
		prefix = m[1] + "-"
	}
	if m[2] == "" {
		return prefix, 1
	}
	n, _ = strconv.Atoi(m[2])
	return prefix, n
}
