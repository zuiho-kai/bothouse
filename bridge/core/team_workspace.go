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
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
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
	// Active is the number of tasks in progress in the channel, where the platform knows it
	// (cloud_web/DSH); 0 elsewhere (Discord, Feishu rely on the caller's busy check).
	Active int
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

// TeamWorkspaceClaimer is implemented by platforms whose server records which chat channel a
// workspace belongs to (cloud_web: the DSH gateway's rooms.parent_id, which its unified exit
// routes by). ClaimTeamWorkspace calls it so a handoff from another chat channel of the pool
// moves the workspace there too.
type TeamWorkspaceClaimer interface {
	ClaimTeamWorkspaceChannel(ctx context.Context, chatID, workspaceID string) error
}

// TeamWorkspaceRenamer is implemented by platforms that can rename a channel (Discord,
// Feishu). Core uses it once per old 「<chat name>-工作区n」 workspace to move it into the
// shared 「工作区n」 pool; without it the old name is only recognised.
type TeamWorkspaceRenamer interface {
	RenameTeamWorkspaceChannel(ctx context.Context, channelID, name string) error
}

const (
	teamWorkspaceFile   = "team_workspaces.json"
	teamWorkspacePrefix = "工作区" // naming 「工作区n」: user 00:50「工作区1」「工作区n+1」
	// teamWorkspaceBarePlat is the platform of a bare channel ID (no "<platform>:"), the
	// form team mode D's API and the unified exit already accept for Discord.
	teamWorkspaceBarePlat = "discord"
)

// 「工作区」 without a number is the name the old ws-handoff script used. Workspaces are one
// shared pool per server/category, numbered 「工作区1..n」 with unique numbers; any chat channel
// of the category uses the first free one and the pool grows by 「工作区(max+1)」. The chat
// channel that handed off to a workspace last owns its record, so asks and reports go back to
// it (team mode C). Replaces the per-chat 「<chat name>-工作区n」 prefix.
var teamWorkspaceName = regexp.MustCompile(`^` + teamWorkspacePrefix + `(\d*)$`)

// teamWorkspaceLegacyName is the per-chat name used before the shared pool,
// 「<chat channel name>-工作区n」. Recorded ones are renamed into the pool (teamWorkspaceMigrate).
var teamWorkspaceLegacyName = regexp.MustCompile(`^.+-` + teamWorkspacePrefix + `(\d+)$`)

// isTeamWorkspaceName: 「工作区n」 or the old 「<chat name>-工作区n」.
func isTeamWorkspaceName(name string) bool {
	return teamWorkspaceNum(name) > 0 || teamWorkspaceLegacyName.MatchString(name)
}

// TeamWorkspace is one workspace channel of a chat channel.
type TeamWorkspace struct {
	Name    string    `json:"name"`
	ID      string    `json:"id"`
	Created time.Time `json:"created,omitzero"`
}

type teamWorkspaceState struct {
	// Parents: "<platform>:<chat channel id>" → its workspaces in creation order.
	Parents map[string][]TeamWorkspace `json:"parents"`
	// Handoffs: "<platform>:<workspace id>" → every handoff to it, oldest first. Each records the
	// chat channel that handed off that task, so a report or ask goes back to the chat of its own
	// task, not to whichever chat claimed the workspace last (team mode C).
	Handoffs map[string][]TeamHandoff `json:"handoffs,omitempty"`
}

// TeamHandoff is one task handed from a chat channel to a pool workspace.
type TeamHandoff struct {
	ID   string    `json:"id"`   // "task-<8 hex>", quoted by the workspace's [ask]/[report]
	Chat string    `json:"chat"` // "<platform>:<chat channel id>"
	At   time.Time `json:"at,omitzero"`
	// Closed: when the task ended (the workspace session was reset after working on it, or a
	// later handoff found the workspace with no tasks in progress).
	// Closed handoffs still resolve a quoted id but no longer count as live tasks.
	Closed time.Time `json:"closed,omitzero"`
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
	t := e.team
	if t == nil {
		return
	}
	t.mu.Lock()
	t.workspacesEnabled = on
	t.mu.Unlock()
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
		// Adopted an existing unclaimed 「工作区n」: that is the workspace of this request.
		if len(list) > 0 {
			return chat, list[len(list)-1], nil
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
	guild = e.teamWorkspaceMigrate(ctx, chat, plat, self, guild)

	path := teamWorkspacePath(e.dataDir)
	list, name, changed, adopted, err := teamWorkspacePlan(path, chat, self, guild, next)
	if err != nil {
		return nil, nil, err
	}
	// Adopting a pool workspace is a handoff: tell a platform that records the parent itself.
	if c, ok := plat.(TeamWorkspaceClaimer); ok && adopted != "" {
		if err := c.ClaimTeamWorkspaceChannel(ctx, self.ID, adopted); err != nil {
			return nil, nil, fmt.Errorf("team workspace: %s: claim %s: %w", chat, adopted, err)
		}
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
// adopted is the ID of an unclaimed pool workspace taken over by this call ("" = none).
func teamWorkspacePlan(path, chat string, self TeamChannel, guild []TeamChannel, next bool) (list []TeamWorkspace, name string, changed bool, adopted string, err error) {
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
	if _, isChild := claimed[self.ID]; isChild || isTeamWorkspaceName(self.Name) {
		return nil, "", false, "", errTeamIsWorkspace
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
	// Adopt the lowest unclaimed 「工作区n」 already in the same category (e.g. made by
	// ws-handoff) when this chat has none; adopting counts as this request's workspace.
	// The pool is shared, so a workspace with tasks in progress (another chat is using it) is
	// skipped; an idle one may be taken and is then claimed for this chat.
	if len(list) == 0 {
		var pick *TeamChannel
		for i, c := range guild {
			n := teamWorkspaceNum(c.Name)
			if c.ParentID == self.ParentID && c.ID != self.ID && claimed[c.ID] == "" && n > 0 && c.Active == 0 &&
				(pick == nil || n < teamWorkspaceNum(pick.Name)) {
				pick = &guild[i]
			}
		}
		if pick != nil {
			list = append(list, TeamWorkspace{Name: pick.Name, ID: pick.ID})
			claimed[pick.ID] = chat
			return list, "", true, pick.ID, nil
		}
	}

	if next || len(list) == 0 {
		// 工作区(max+1) over the whole category pool, whichever chat channel owns each.
		top := 0
		for _, c := range guild {
			if c.ParentID == self.ParentID {
				top = max(top, teamWorkspaceNum(c.Name))
			}
		}
		for _, w := range list {
			top = max(top, teamWorkspaceNum(w.Name))
		}
		name = teamWorkspacePrefix + strconv.Itoa(top+1)
	}
	return list, name, changed, "", nil
}

// teamWorkspaceMigrate renames every recorded old 「<chat name>-工作区n」 workspace in self's
// category to 「工作区(max+1)」 through the platform, so the shared pool has unique numbers.
// It updates the records and returns the guild listing with the new names. A platform
// without TeamWorkspaceRenamer, or a failed rename, keeps the old name; it is still
// recognised as a workspace and listed in the pool. Caller holds teamWorkspaceOpMu.
func (e *Engine) teamWorkspaceMigrate(ctx context.Context, chat string, plat TeamWorkspaceChannels, self TeamChannel, guild []TeamChannel) []TeamChannel {
	path := teamWorkspacePath(e.dataDir)
	recorded := map[string]bool{}
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	pname, _, _ := strings.Cut(chat, ":")
	for parent, list := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != pname {
			continue
		}
		for _, w := range list {
			recorded[w.ID] = true
		}
	}
	teamWorkspaceStore.mu.Unlock()

	var old []int // indexes into guild
	top := 0
	for i, c := range guild {
		if c.ParentID != self.ParentID {
			continue
		}
		top = max(top, teamWorkspaceNum(c.Name))
		if recorded[c.ID] && teamWorkspaceLegacyName.MatchString(c.Name) {
			old = append(old, i)
		}
	}
	if len(old) == 0 {
		return guild
	}
	r, ok := plat.(TeamWorkspaceRenamer)
	if !ok {
		return guild
	}
	legacyNum := func(name string) int {
		n, _ := strconv.Atoi(teamWorkspaceLegacyName.FindStringSubmatch(name)[1])
		return n
	}
	sort.SliceStable(old, func(a, b int) bool {
		x, y := guild[old[a]], guild[old[b]]
		if nx, ny := legacyNum(x.Name), legacyNum(y.Name); nx != ny {
			return nx < ny
		}
		return x.ID < y.ID
	})
	out := append([]TeamChannel(nil), guild...)
	renamed := map[string]string{}
	for _, i := range old {
		name := teamWorkspacePrefix + strconv.Itoa(top+1)
		if err := r.RenameTeamWorkspaceChannel(ctx, out[i].ID, name); err != nil {
			slog.Warn("team workspace: rename of old workspace failed; kept in the pool under its old name",
				"channel", out[i].ID, "name", out[i].Name, "to", name, "error", err)
			continue
		}
		slog.Info("team workspace: moved old workspace into the shared pool", "channel", out[i].ID, "from", out[i].Name, "to", name)
		top++
		out[i].Name = name
		renamed[out[i].ID] = name
	}
	if len(renamed) > 0 {
		teamWorkspaceStore.mu.Lock()
		st := loadTeamWorkspacesLocked(path)
		for parent, list := range st.Parents {
			if p, _, _ := strings.Cut(parent, ":"); p != pname {
				continue
			}
			for j := range list {
				if n, ok := renamed[list[j].ID]; ok {
					list[j].Name = n
				}
			}
		}
		if err := saveTeamWorkspacesLocked(path, st); err != nil {
			slog.Warn("team workspace: save state after rename", "error", err)
		}
		teamWorkspaceStore.mu.Unlock()
	}
	return out
}

// teamWorkspaceNum returns n for 「工作区n」 (1 when unnumbered), 0 otherwise.
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

// ClaimTeamWorkspace records chat (bare ID or session key) as the chat channel that handed
// off to workspace wsID last: the record moves from its previous chat, so asks and reports
// (WorkspaceParent) default to the chat that handed off last; each handoff is also recorded as a
// task (ClaimTeamWorkspaceTask, WorkspaceOrigin) so reports follow their own task's chat. On a
// platform that records the parent itself (TeamWorkspaceClaimer: cloud_web/DSH) the platform
// is told first. name is the workspace's channel name, kept when it is not recorded yet.
// Runs under teamWorkspaceOpMu like teamWorkspaceOp, so a claim never interleaves with a
// create that is saving a listing taken before the claim.
func (e *Engine) ClaimTeamWorkspace(channel, wsID, name string) error {
	_, err := e.ClaimTeamWorkspaceTask(channel, wsID, name)
	return err
}

// ClaimTeamWorkspaceTask is ClaimTeamWorkspace that also records the handoff as one task of
// the workspace and returns its id ("task-<8 hex>"). The workspace quotes the id in [ask] and
// [report] so they return to this chat even after another chat claimed the workspace.
func (e *Engine) ClaimTeamWorkspaceTask(channel, wsID, name string) (string, error) {
	if e == nil || e.dataDir == "" || channel == "" || wsID == "" {
		return "", errors.New("team workspace claim: chat channel and workspace id are required")
	}
	chat := teamChatKey(channel)
	if p, ok := e.WorkspaceParent(chat); ok {
		chat = p
	}
	if teamChannelID(chat) == wsID {
		return "", fmt.Errorf("team workspace claim: %s cannot hand off to itself", chat)
	}
	plat, _, _ := strings.Cut(chat, ":")
	path := teamWorkspacePath(e.dataDir)

	teamWorkspaceOpMu.Lock()
	defer teamWorkspaceOpMu.Unlock()

	// The workspace's recorded entry (under any chat) wins over the given name.
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	w := TeamWorkspace{ID: wsID, Name: name}
	for parent, list := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != plat {
			continue
		}
		for _, x := range list {
			if x.ID == wsID {
				w = x
			}
		}
	}
	teamWorkspaceStore.mu.Unlock()
	if w.Name == "" {
		w.Name = name
	}
	if !isTeamWorkspaceName(w.Name) {
		return "", fmt.Errorf("team workspace claim: %q is not a 「%sn」 channel", w.Name, teamWorkspacePrefix)
	}

	// The platform request runs without teamWorkspaceStore.mu (WorkspaceParent never waits on it).
	// idle: the platform lists the workspace with no tasks in progress, the same count the pool
	// uses to skip busy workspaces (teamWorkspacePlan). Its earlier handoffs are then over and
	// are closed below, so a plain [report] of this task is not ambiguous (no idle reset or /new
	// needs to have run). Unknown (lookup failed, platform without workspaces) closes nothing.
	idle := false
	if p, ok := e.teamWorkspacePlatform(chat); ok {
		ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
		_, guild, err := p.TeamGuildChannels(ctx, teamChannelID(chat))
		cancel()
		if err == nil {
			for _, c := range guild {
				if c.ID == wsID {
					idle = c.Active == 0
				}
			}
		}
		if c, ok := p.(TeamWorkspaceClaimer); ok {
			ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
			err := c.ClaimTeamWorkspaceChannel(ctx, teamChannelID(chat), wsID)
			cancel()
			if err != nil {
				return "", fmt.Errorf("team workspace claim: %s → %s: %w", chat, wsID, err)
			}
		}
	}

	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st = loadTeamWorkspacesLocked(path)
	for parent, list := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != plat || parent == chat {
			continue
		}
		for i, x := range list {
			if x.ID == wsID {
				rest := append(append([]TeamWorkspace(nil), list[:i]...), list[i+1:]...)
				if len(rest) == 0 {
					delete(st.Parents, parent)
				} else {
					st.Parents[parent] = rest
				}
				break
			}
		}
	}
	found := false
	for _, x := range st.Parents[chat] {
		if x.ID == wsID {
			found = true
		}
	}
	if !found {
		st.Parents[chat] = append(st.Parents[chat], w)
	}
	if st.Handoffs == nil {
		st.Handoffs = map[string][]TeamHandoff{}
	}
	h := TeamHandoff{ID: newTaskID(), Chat: chat, At: time.Now()}
	wk := plat + ":" + wsID
	if idle {
		for i := range st.Handoffs[wk] {
			if st.Handoffs[wk][i].Closed.IsZero() {
				st.Handoffs[wk][i].Closed = h.At
			}
		}
	}
	st.Handoffs[wk] = append(st.Handoffs[wk], h)
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		return "", err
	}
	e.noticeHandoffTask(chat, wsID, h.ID)
	return h.ID, nil
}

// noticeHandoffTask posts the task id into the workspace channel, so the workspace receives it
// with the handoff on every platform and can quote it in [ask]/[report].
func (e *Engine) noticeHandoffTask(chat, wsID, task string) {
	plat, _, _ := strings.Cut(chat, ":")
	p := e.platformForName(plat)
	rec, ok := p.(ReplyContextReconstructor)
	if !ok || p == nil {
		return
	}
	rc, err := rec.ReconstructReplyCtx(plat + ":" + wsID)
	if err != nil {
		return
	}
	text := exitPrefix + " 交接任务编号 " + task + "（来自 " + channelLabel(plat, teamChannelID(chat)) + "）。这件活的 [ask]/[report] 正文里写上这个编号。"
	if err := p.Send(e.ctx, rc, text); err != nil {
		slog.Warn("team workspace: handoff task notice failed", "workspace", wsID, "error", err)
	}
}

// closeWorkspaceHandoffs closes the open handoffs of workspace session sessionKey claimed before
// lastActive: the session that worked on them is being reset (/new or idle reset), so those
// tasks are over. Handoffs claimed after the last activity were not worked on yet and stay open.
func (e *Engine) closeWorkspaceHandoffs(sessionKey string, lastActive time.Time) {
	if e == nil || e.dataDir == "" {
		return
	}
	key := teamChatKey(sessionKey)
	path := teamWorkspacePath(e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	changed := false
	now := time.Now()
	for i, h := range st.Handoffs[key] {
		if h.Closed.IsZero() && !h.At.After(lastActive) {
			st.Handoffs[key][i].Closed = now
			changed = true
		}
	}
	if changed {
		if err := saveTeamWorkspacesLocked(path, st); err != nil {
			slog.Warn("team workspace: close handoffs failed", "session", sessionKey, "error", err)
		}
	}
}

var taskRef = regexp.MustCompile(`\btask-[0-9a-f]{8}\b`)

func newTaskID() string {
	return "task-" + strings.TrimPrefix(newAskID(), "ask-")
}

// WorkspaceOrigin resolves the chat channel a workspace's [ask]/[report] text goes to: the
// chat of the handoff whose id the text quotes; else, when every recorded handoff to the
// workspace came from one chat, that chat. ok is false when the workspace has handoffs from
// more than one chat and the text names none of them; candidates then lists them, newest
// first, and nothing is guessed. A workspace without recorded handoffs (claimed before they
// were recorded) falls back to WorkspaceParent. channelID and parentID use the same form as
// WorkspaceParent (bare ID in, bare ID out).
func (e *Engine) WorkspaceOrigin(channelID, text string) (parentID string, candidates []TeamHandoff, ok bool) {
	parent, isWS := e.WorkspaceParent(channelID)
	if !isWS {
		return "", nil, false
	}
	key := teamChatKey(channelID)
	teamWorkspaceStore.mu.Lock()
	hs := append([]TeamHandoff(nil), loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]...)
	teamWorkspaceStore.mu.Unlock()
	out := func(chat string) string {
		if strings.Contains(channelID, ":") {
			return chat
		}
		return teamChannelID(chat)
	}
	for _, ref := range taskRef.FindAllString(text, -1) {
		for _, h := range hs {
			if h.ID == ref {
				return out(h.Chat), nil, true
			}
		}
	}
	// Only open handoffs are live tasks; closed ones never make a later task ambiguous.
	var open []TeamHandoff
	chats := map[string]bool{}
	for _, h := range hs {
		if h.Closed.IsZero() {
			open = append(open, h)
			chats[h.Chat] = true
		}
	}
	switch len(chats) {
	case 0:
		return parent, nil, true
	case 1:
		return out(open[0].Chat), nil, true
	}
	for i := len(open) - 1; i >= 0; i-- {
		candidates = append(candidates, open[i])
	}
	return "", candidates, false
}

// TeamWorkspacePool returns every workspace in the server/category of chat, 「工作区n」 lowest
// number first, then old 「<chat name>-工作区n」 ones a platform could not rename, whichever
// chat channel handed off to each last. Callers pick the first free one. Recorded old names
// are renamed into the pool first (teamWorkspaceMigrate).
func (e *Engine) TeamWorkspacePool(channel string) ([]TeamWorkspace, error) {
	chat := teamChatKey(channel)
	if p, ok := e.WorkspaceParent(chat); ok {
		chat = p
	}
	plat, ok := e.teamWorkspacePlatform(chat)
	if !ok {
		return nil, fmt.Errorf("team workspace: %s: no platform with workspaces", chat)
	}
	teamWorkspaceOpMu.Lock()
	defer teamWorkspaceOpMu.Unlock()
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	self, guild, err := plat.TeamGuildChannels(ctx, teamChannelID(chat))
	if err != nil {
		return nil, err
	}
	if e.dataDir != "" {
		guild = e.teamWorkspaceMigrate(ctx, chat, plat, self, guild)
	}
	var out []TeamWorkspace
	for _, c := range guild {
		if c.ParentID == self.ParentID && c.ID != self.ID && isTeamWorkspaceName(c.Name) {
			out = append(out, TeamWorkspace{Name: c.Name, ID: c.ID})
		}
	}
	order := func(name string) int {
		if n := teamWorkspaceNum(name); n > 0 {
			return n
		}
		return math.MaxInt // old names a platform could not rename go last
	}
	sort.SliceStable(out, func(i, j int) bool { return order(out[i].Name) < order(out[j].Name) })
	return out, nil
}
