package core

// Team mode D: a chat channel of the primary role gets workspace channels in the same
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
	// ActiveKnown: the platform maintains Active (cloud_web/DSH). False means Active == 0 says
	// nothing about whether the channel is busy.
	ActiveKnown bool
	// Owner is the chat channel ID the workspace belongs to now ("" = free), where the platform
	// records it itself (OwnerKnown: cloud_web/DSH). Elsewhere the bridge's own record decides.
	Owner      string
	OwnerKnown bool
	// Claim: from CreateTeamWorkspaceChannel only, the platform's id of the claim the create
	// made (cloud_web: the gateway's claim sequence), "" = the platform keeps none.
	Claim string
}

// ErrNotTeamChannel: the channel cannot have workspaces (DM, thread, voice, …).
var ErrNotTeamChannel = errors.New("not a guild text channel")

// ErrTeamWorkspacePermanent marks a platform error that retrying will not fix (Discord 4xx
// other than 429: no Manage Channels permission, channel deleted; Feishu: no im:chat). Each
// platform maps its own errors to it. The chat is then not
// retried until restart (code review of PR #135, item 2: no request flood per message).
var ErrTeamWorkspacePermanent = errors.New("permanent platform error")

// ErrTeamWorkspaceNotLeadChat: "new" was asked for a channel that is not a chat channel of
// the primary role on a platform with workspaces (code review of PR #135, item 3).
var ErrTeamWorkspaceNotLeadChat = errors.New("not a chat channel of the primary role on a platform with workspaces")

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
// routes by). ClaimTeamWorkspace calls it so a handoff to a free pool workspace moves it to the
// claiming chat channel there too; the gateway refuses a workspace another chat owns.
// It returns the platform's id of this claim, which a later release names (TeamWorkspaceReleaser).
type TeamWorkspaceClaimer interface {
	ClaimTeamWorkspaceChannel(ctx context.Context, chatID, workspaceID string) (claim string, err error)
}

// TeamWorkspaceReleaser is implemented by platforms that record the owner themselves
// (cloud_web: the DSH gateway). releaseTeamWorkspace calls it when the workspace session is
// reset after its last task, so the gateway frees the workspace too (it keeps it while its own
// task count is above 0). claim is the id the claim being ended got from the platform ("" =
// unknown, release whatever claim holds it); the platform refuses a release whose claim is no
// longer the current one with ErrTeamWorkspaceStaleClaim, so a late release never frees a
// workspace claimed again meanwhile.
type TeamWorkspaceReleaser interface {
	ReleaseTeamWorkspaceChannel(ctx context.Context, workspaceID, claim string) error
}

// ErrTeamWorkspaceStaleClaim: the release named a claim that is no longer the workspace's
// current one (it was claimed again since); nothing was released.
var ErrTeamWorkspaceStaleClaim = errors.New("workspace release names an earlier claim")

// ErrTeamWorkspaceOwned: the workspace belongs to another chat channel until it finishes its
// last task; the caller picks a free workspace or creates the next one.
var ErrTeamWorkspaceOwned = errors.New("workspace belongs to another chat channel")

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
	// Owner: in TeamWorkspacePool only, the chat channel ("<platform>:<id>") the workspace
	// belongs to now; "" = free, any chat channel may claim it.
	Owner string `json:"owner,omitempty"`
	// Claim: the platform's id of the claim that gave this chat the workspace
	// (TeamWorkspaceClaimer; "" = none), named by the release that ends it.
	Claim string `json:"claim,omitempty"`
	// ReleasePending: the lead's session was reset after the last task, but the platform
	// (TeamWorkspaceReleaser) has not confirmed the release yet (busy or unreachable). The record
	// stays, so asks and reports still go to this chat; the release is retried on the next reset
	// and before every claim, create or pool listing on the platform (retryTeamWorkspaceReleases).
	ReleasePending bool `json:"release_pending,omitempty"`
	// Park: the pending release comes from ParkTeamWorkspace (its tasks were paused, not
	// finished). A platform that keeps its own task count (TeamWorkspaceParker: cloud_web/DSH)
	// is asked to pause them and release; without it the plain release is tried and retried.
	Park bool `json:"park,omitempty"`
	// Open and Parked: in TeamWorkspacePool only, the handoffs to the workspace that are in
	// work (not closed, not paused) and the paused ones, from the bridge's own record.
	Open   int `json:"open,omitempty"`
	Parked int `json:"parked,omitempty"`
	// WatchDue: in TeamWorkspacePool only, the earliest check time of the ten-minute watch on
	// its tasks in work (zero: not watched by the bridge).
	WatchDue time.Time `json:"watch_due,omitzero"`
}

// teamWorkspaceBusy: a workspace with this many tasks in work counts as busy; a new handoff
// does not adopt it. Source: dsh_bundle/collab/team-mode-rules.md「一个工作区里进行中的活默认达到
// 3 件就算忙」(team mode rules, user 2026-10-24).
const teamWorkspaceBusy = 3

// TeamWorkspaceParker is implemented by platforms that count a workspace's tasks themselves
// (cloud_web: the DSH gateway). ParkTeamWorkspace's release asks it to mark the workspace's
// tasks in work as paused (no longer counted) and release the workspace, naming the claim
// being ended like TeamWorkspaceReleaser. An older gateway without it answers like a plain
// release (busy while tasks are in work): the release stays pending and is retried.
type TeamWorkspaceParker interface {
	ParkTeamWorkspaceChannel(ctx context.Context, workspaceID, claim string) error
}

// A workspace belongs to one chat channel at a time (team mode C, single owner): the chat that
// handed off to it owns it until the workspace finishes its last task and its session is reset
// (releaseTeamWorkspace). Meanwhile no other chat channel can claim it, so its [ask]/[report]
// always go back to that one chat (WorkspaceParent).
type teamWorkspaceState struct {
	// Parents: "<platform>:<chat channel id>" → the workspaces it owns, in creation order.
	Parents map[string][]TeamWorkspace `json:"parents"`
	// Handoffs: "<platform>:<workspace id>" → every handoff to it, oldest first, with the chat
	// channel that handed it off. An open handoff made after the workspace session's last
	// activity keeps the workspace owned through a reset (the task was not worked on yet).
	Handoffs map[string][]TeamHandoff `json:"handoffs,omitempty"`
	// Version of the record format: 1 = single owner (a Parents record means the chat owns the
	// workspace now). 0 = written before; migrated on load (teamWorkspaceMigrateOwners).
	Version       int                      `json:"version,omitempty"`
	ScriptWatches map[string][]TeamHandoff `json:"script_watches,omitempty"`
}

const teamWorkspaceStateVersion = 1

// teamWorkspaceMigrateOwners upgrades a state written before single owner. Back then a Parents
// record only named the last chat that handed off and was never removed, so every workspace
// ever used would count as owned forever. A record without an open handoff (none, or all
// Closed) is the end of finished work: dropped, the workspace is free. Runs once (Version).
func teamWorkspaceMigrateOwners(st *teamWorkspaceState) bool {
	if st.Version >= teamWorkspaceStateVersion {
		return false
	}
	for parent, list := range st.Parents {
		plat, _, _ := strings.Cut(parent, ":")
		var keep []TeamWorkspace
		for _, w := range list {
			for _, h := range st.Handoffs[plat+":"+w.ID] {
				if teamHandoffOpen(h) {
					keep = append(keep, w)
					break
				}
			}
		}
		if len(keep) == 0 {
			delete(st.Parents, parent)
		} else {
			st.Parents[parent] = keep
		}
	}
	st.Version = teamWorkspaceStateVersion
	return true
}

// TeamHandoff is one task handed from a chat channel to a pool workspace.
type TeamHandoff struct {
	Chat string    `json:"chat"` // "<platform>:<chat channel id>"
	At   time.Time `json:"at,omitzero"`
	// Closed: when the task ended (the workspace session was reset after working on it).
	Closed time.Time `json:"closed,omitzero"`
	// Parked: when the task was paused (ParkTeamWorkspace: stopped at a clean point, waiting
	// for the user or someone else). A parked task does not keep the workspace: it is the chat
	// channel's to-do and is handed off again (to any free workspace) when it resumes.
	Parked time.Time `json:"parked,omitzero"`
	// The ten-minute watch (team_watch.go). Owner: who the task was handed to (a platform
	// user/bot id, mentioned in the nudge; "" = nobody is mentioned). Title: the task's short
	// name for the nudge. Due: the next check time (zero: not watched, e.g. a handoff recorded
	// before the watch existed). Renewed: renewals given for progress. Nudged: the nudge was
	// sent. ParkFails: parks that failed at the check time (retried, then reported). ReadFails: below.
	Idle   watchIdleState `json:"idle,omitzero"`
	Sender string         `json:"sender,omitempty"` // d10 caller project
	Board  int            `json:"board,omitempty"`  // task-board item watched at turn completion
	Owner  string         `json:"owner,omitempty"`
	Title  string         `json:"title,omitempty"`
	// Name: the workspace's name at the claim (「工作区n」). The Parents record goes at the release,
	// this stays, so the task board still names the workspace of a finished task (TeamWorkspaceName).
	Name        string    `json:"name,omitempty"`
	Due         time.Time `json:"due,omitzero"`
	Renewed     int       `json:"renewed,omitempty"`
	BusyRenewed int       `json:"busy_renewed,omitempty"` // renewals given only because a session was busy
	Nudged      bool      `json:"nudged,omitempty"`
	ParkFails   int       `json:"park_fails,omitempty"`
	// ReadFails: checks whose progress signal could not be read (the channel history request
	// failed); retried like ParkFails, then counted as no progress. Since: the start of the
	// window being checked, kept while a read is retried (a retry moves Due, not the window;
	// zero: Due - watchCheckAfter, or At if later).
	ReadFails int       `json:"read_fails,omitempty"`
	Since     time.Time `json:"since,omitzero"`
}

// teamHandoffOpen: the handoff is in work (neither closed nor paused).
func teamHandoffOpen(h TeamHandoff) bool { return h.Closed.IsZero() && h.Parked.IsZero() }

// teamWorkspaceCountsLocked returns the open and the paused handoffs to workspace key
// ("<platform>:<workspace id>"); caller holds teamWorkspaceStore.mu.
func teamWorkspaceCountsLocked(st *teamWorkspaceState, key string) (open, parked int) {
	for _, h := range st.Handoffs[key] {
		switch {
		case !h.Closed.IsZero():
		case !h.Parked.IsZero():
			parked++
		default:
			open++
		}
	}
	return open, parked
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
	st := &teamWorkspaceState{Parents: map[string][]TeamWorkspace{}, Version: teamWorkspaceStateVersion}
	if raw, err := os.ReadFile(path); err == nil {
		st.Version = 0
		if err := json.Unmarshal(raw, st); err != nil {
			slog.Warn("team workspace: bad state file", "path", path, "error", err)
		}
		if st.Parents == nil {
			st.Parents = map[string][]TeamWorkspace{}
		}
		if teamWorkspaceMigrateOwners(st) {
			slog.Info("team workspace: state upgraded to single owner; finished workspaces are free", "path", path)
			if err := saveTeamWorkspacesLocked(path, st); err != nil {
				slog.Warn("team workspace: save upgraded state", "path", path, "error", err)
			}
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

// WorkspaceLastChat returns the chat channel of the latest handoff to workspace channelID
// (same id form as WorkspaceParent). It covers a workspace that is no longer owned because
// its task was parked or closed while a turn there was still running: that turn's late
// [report]/[ask] still belongs to that chat (10-26 工作区6 事故).
func (e *Engine) WorkspaceLastChat(channelID string) (parentID string, ok bool) {
	if e == nil || e.dataDir == "" || channelID == "" {
		return "", false
	}
	key := teamChatKey(channelID)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	hs := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]
	if len(hs) == 0 || hs[len(hs)-1].Chat == "" {
		return "", false
	}
	parent := hs[len(hs)-1].Chat
	if strings.Contains(channelID, ":") {
		return parent, true
	}
	return teamChannelID(parent), true
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

// isTeamWorkspaceChat: session (a session key, chat key or bare channel ID) is a workspace
// channel in the team_workspaces.json record: a chat owns it now (WorkspaceParent) or it was
// handed a task before (Handoffs; a released workspace leaves Parents but is still a workspace).
// Big cards (who-is-doing-what board, progress card, 📋 task card) only go to workspace channels
// (user, 2026-10-26: 「那个任务卡只在工作区显示，任何非其他工作区都不要显示太大，太占位置了」).
func (e *Engine) isTeamWorkspaceChat(session string) bool {
	if e != nil && e.workspaceChatForTest != nil {
		return e.workspaceChatForTest(session)
	}
	if _, ok := e.WorkspaceParent(session); ok {
		return true
	}
	if e == nil || e.dataDir == "" || session == "" {
		return false
	}
	key := teamChatKey(session)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	return len(loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]) > 0
}

// isTeamChat: session (a session key, chat key or bare channel ID) is a team chat channel: one
// that owns workspaces now (Parents), that handed a task to a workspace before (Handoffs' chat;
// kept after its last workspace is released, so the answer does not flip), or the main chat the
// setup wizard bound the roles to (teamMainChat). Its pinned task-board summary stays (user chose
// A, 2026-10-26 10:47: 聊天频道置顶的任务板总表保留), but it gets no other big card. A channel that
// is neither this nor a workspace (isTeamWorkspaceChat), e.g. a side chat channel, gets none.
func (e *Engine) isTeamChat(session string) bool {
	if e == nil || e.dataDir == "" || session == "" {
		return false
	}
	key := teamChatKey(session)
	if teamMainChat(e.dataDir) == key {
		return true
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if _, ok := st.Parents[key]; ok {
		return true
	}
	for _, list := range st.Handoffs {
		for _, h := range list {
			if h.Chat != "" && teamChatKey(h.Chat) == key {
				return true
			}
		}
	}
	return false
}

// TeamWorkspaceName returns the name (「工作区n」) of workspace ws ("<platform>:<id>"): its record
// under the chat that owns it now, else the name at its latest handoff (a released workspace, e.g.
// one whose last task is done today); "" when none is recorded. Only names, never the id: the
// task board shows it to users (#597 G36).
func (e *Engine) TeamWorkspaceName(ws string) string {
	if e == nil || e.dataDir == "" || ws == "" {
		return ""
	}
	key := teamChatKey(ws)
	plat, id, _ := strings.Cut(key, ":")
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if owner, w := teamWorkspaceOwnerLocked(st, plat, id); owner != "" && w.Name != "" {
		return w.Name
	}
	hs := st.Handoffs[key]
	for i := len(hs) - 1; i >= 0; i-- {
		if hs[i].Name != "" {
			return hs[i].Name
		}
	}
	return ""
}

// SetTeamWorkspaces turns team mode D on or off. It only acts on the primary role
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
	e.retryTeamWorkspaceReleases(chat)
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
		claim, err := c.ClaimTeamWorkspaceChannel(ctx, self.ID, adopted)
		if err != nil {
			return nil, nil, fmt.Errorf("team workspace: %s: claim %s: %w", chat, adopted, err)
		}
		for i := range list {
			if list[i].ID == adopted {
				list[i].Claim = claim
			}
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
	created := &TeamWorkspace{Name: c.Name, ID: c.ID, Created: time.Now().UTC(), Claim: c.Claim}
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
	// The owner of a pool workspace: the platform's own record where it keeps one
	// (cloud_web/DSH, OwnerKnown), else the bridge's record. "" = free.
	ownerOf := func(c TeamChannel) string {
		if !c.OwnerKnown {
			return claimed[c.ID]
		}
		if c.Owner == "" {
			return ""
		}
		return plat + ":" + c.Owner
	}
	// Drop recorded workspaces whose channel was deleted, or that the platform says no longer
	// belong to this chat; keep the record's name up to date.
	for _, w := range st.Parents[chat] {
		c, ok := byID[w.ID]
		if !ok || ownerOf(c) != chat {
			changed = true
			continue
		}
		if c.Name != w.Name {
			w.Name, changed = c.Name, true
		}
		list = append(list, w)
	}
	// Take the lowest free 「工作区n」 of the same category (e.g. made by ws-handoff, or released
	// by another chat after its last task) before creating one: when this chat has none, or
	// when it asks for the next one. A workspace another chat channel owns is skipped, and so
	// is one the platform lists with tasks in progress.
	if len(list) == 0 || next {
		mine := map[string]bool{}
		for _, w := range list {
			mine[w.ID] = true
		}
		var pick *TeamChannel
		for i, c := range guild {
			n := teamWorkspaceNum(c.Name)
			busy := c.Active > 0
			if !c.ActiveKnown { // Discord, Feishu: the bridge's own count of tasks in work
				open, _ := teamWorkspaceCountsLocked(st, plat+":"+c.ID)
				busy = busy || open >= teamWorkspaceBusy
			}
			if c.ParentID == self.ParentID && c.ID != self.ID && !mine[c.ID] && ownerOf(c) == "" && n > 0 && !busy &&
				(pick == nil || n < teamWorkspaceNum(pick.Name)) {
				pick = &guild[i]
			}
		}
		if pick != nil {
			// A stale bridge record of another chat (the platform freed the workspace) goes.
			if old := claimed[pick.ID]; old != "" && old != chat {
				teamWorkspaceDropLocked(st, old, pick.ID)
			}
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

// teamWorkspaceDropLocked removes workspace wsID from chat's record (caller holds
// teamWorkspaceStore.mu; does not save).
func teamWorkspaceDropLocked(st *teamWorkspaceState, chat, wsID string) {
	list := st.Parents[chat]
	for i, x := range list {
		if x.ID == wsID {
			rest := append(append([]TeamWorkspace(nil), list[:i]...), list[i+1:]...)
			if len(rest) == 0 {
				delete(st.Parents, chat)
			} else {
				st.Parents[chat] = rest
			}
			return
		}
	}
}

// teamWorkspaceOwnerLocked returns the chat channel whose record holds workspace wsID on
// platform plat ("" = none) and that record (caller holds teamWorkspaceStore.mu).
func teamWorkspaceOwnerLocked(st *teamWorkspaceState, plat, wsID string) (string, TeamWorkspace) {
	for parent, list := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != plat {
			continue
		}
		for _, x := range list {
			if x.ID == wsID {
				return parent, x
			}
		}
	}
	return "", TeamWorkspace{}
}

// ClaimTeamWorkspace records chat (bare ID or session key) as the owner of workspace wsID, so
// its asks and reports (WorkspaceParent) go to chat. A workspace belongs to one chat channel at
// a time: one owned by another chat is refused with ErrTeamWorkspaceOwned until it is released
// (releaseTeamWorkspace, after its last task); the caller then takes a free one or creates the
// next. The owner handing off again is fine (several tasks of one chat may share a workspace).
// On a platform that records the owner itself (TeamWorkspaceClaimer: cloud_web/DSH) its
// listing decides who owns the workspace, and the platform is told first. name is the
// workspace's channel name, kept when it is not recorded yet. Runs under teamWorkspaceOpMu
// like teamWorkspaceOp, so a claim never interleaves with a create that is saving a listing
// taken before the claim.
func (e *Engine) ClaimTeamWorkspace(channel, wsID, name string) error {
	return e.ClaimTeamWorkspaceFor(channel, wsID, name, "", "")
}

// ClaimTeamWorkspaceFor is ClaimTeamWorkspace naming who the task goes to (taskOwner, optional:
// mentioned when the ten-minute watch nudges) and its short title (optional). Once the watch is
// started on e, every claim is watched: its handoff gets a check time watchCheckAfter() from now
// (team_watch.go); before that no check time is recorded.
func (e *Engine) ClaimTeamWorkspaceFor(channel, wsID, name, taskOwner, title string) error {
	if e == nil || e.dataDir == "" || channel == "" || wsID == "" {
		return errors.New("team workspace claim: chat channel and workspace id are required")
	}
	chat := teamChatKey(channel)
	if p, ok := e.WorkspaceParent(chat); ok {
		chat = p
	}
	if teamChannelID(chat) == wsID {
		return fmt.Errorf("team workspace claim: %s cannot hand off to itself", chat)
	}
	plat, _, _ := strings.Cut(chat, ":")
	path := teamWorkspacePath(e.dataDir)

	teamWorkspaceOpMu.Lock()
	defer teamWorkspaceOpMu.Unlock()
	e.retryTeamWorkspaceReleases(chat)

	// The workspace's recorded entry (under any chat) wins over the given name.
	teamWorkspaceStore.mu.Lock()
	owner, w := teamWorkspaceOwnerLocked(loadTeamWorkspacesLocked(path), plat, wsID)
	teamWorkspaceStore.mu.Unlock()
	if owner == "" {
		w = TeamWorkspace{ID: wsID, Name: name}
	}
	w.ReleasePending, w.Park = false, false
	if w.Name == "" {
		w.Name = name
	}
	if !isTeamWorkspaceName(w.Name) {
		return fmt.Errorf("team workspace claim: %q is not a 「%sn」 channel", w.Name, teamWorkspacePrefix)
	}

	// The platform request runs without teamWorkspaceStore.mu (WorkspaceParent never waits on it).
	// A platform that records the owner itself (cloud_web/DSH) is asked who owns it now.
	if p, ok := e.teamWorkspacePlatform(chat); ok {
		ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
		_, guild, err := p.TeamGuildChannels(ctx, teamChannelID(chat))
		cancel()
		if err == nil {
			for _, c := range guild {
				if c.ID == wsID && c.OwnerKnown {
					owner = ""
					if c.Owner != "" {
						owner = plat + ":" + c.Owner
					}
				}
			}
		}
		if owner != "" && owner != chat {
			return fmt.Errorf("team workspace claim: %s → %s: %w (%s, until it finishes its last task)", chat, wsID, ErrTeamWorkspaceOwned, owner)
		}
		if c, ok := p.(TeamWorkspaceClaimer); ok {
			ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
			claim, err := c.ClaimTeamWorkspaceChannel(ctx, teamChannelID(chat), wsID)
			cancel()
			if err != nil {
				return fmt.Errorf("team workspace claim: %s → %s: %w", chat, wsID, err)
			}
			w.Claim = claim
		}
	} else if owner != "" && owner != chat {
		return fmt.Errorf("team workspace claim: %s → %s: %w (%s, until it finishes its last task)", chat, wsID, ErrTeamWorkspaceOwned, owner)
	}

	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	// Only a stale record is left under another chat here (the platform freed the workspace).
	for parent := range st.Parents {
		if p, _, _ := strings.Cut(parent, ":"); p == plat && parent != chat {
			teamWorkspaceDropLocked(st, parent, wsID)
		}
	}
	// This claim replaces an earlier one of the same chat, and ends a release still pending.
	found := false
	for i, x := range st.Parents[chat] {
		if x.ID == wsID {
			found = true
			st.Parents[chat][i].ReleasePending = false
			st.Parents[chat][i].Park = false
			if w.Claim != "" {
				st.Parents[chat][i].Claim = w.Claim
			}
		}
	}
	if !found {
		st.Parents[chat] = append(st.Parents[chat], w)
	}
	if st.Handoffs == nil {
		st.Handoffs = map[string][]TeamHandoff{}
	}
	wk := plat + ":" + wsID
	now := time.Now()
	h := TeamHandoff{Chat: chat, At: now, Owner: taskOwner, Title: title, Name: w.Name}
	if e.handoffWatchOn.Load() {
		h.Due = now.Add(watchCheckAfter())
	}
	st.Handoffs[wk] = append(st.Handoffs[wk], h)
	return saveTeamWorkspacesLocked(path, st)
}

// releaseWorkspaceOnReset frees the workspace of sessionKey when the primary role's session there
// is reset (/new, idle reset, `cc-connect session new --after-turn`, all through
// startFreshSession or maybeAutoResetSessionOnIdle): the workspace has finished its tasks, so it
// goes back to the pool for any chat channel. Only the lead's session counts: a teammate
// resetting its own session in the workspace does not end the lead's work there. queued: the
// session has messages waiting for the fresh session (more work), which keeps the workspace.
func (e *Engine) releaseWorkspaceOnReset(sessionKey string, lastActive time.Time, queued bool) {
	if e == nil || e.dataDir == "" || !e.isTeamLead() {
		return
	}
	e.releaseTeamWorkspace(sessionKey, lastActive, queued)
}

// releaseTeamWorkspace frees workspace sessionKey ("<platform>:<id>[:user]"): its handoffs up to
// lastActive are closed and, unless keep is set or a handoff came after lastActive (not worked
// on yet, the owner's next task), its owner record is dropped. On a platform that records the
// owner itself (TeamWorkspaceReleaser) the platform is asked first and the record is dropped only
// once it agrees: until then the record stays (ReleasePending) and the release is retried
// (retryTeamWorkspaceReleases), so the workspace neither stays owned on the platform forever nor
// goes to another chat while the platform still routes it here. Returns whether the workspace
// was freed or its release is pending.
func (e *Engine) releaseTeamWorkspace(sessionKey string, lastActive time.Time, keep bool) bool {
	key := teamChatKey(sessionKey)
	plat, _, _ := strings.Cut(key, ":")
	wsID := teamChannelID(key)
	path := teamWorkspacePath(e.dataDir)
	_, platformReleases := e.platformForName(plat).(TeamWorkspaceReleaser)
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	owner, _ := teamWorkspaceOwnerLocked(st, plat, wsID)
	if owner == "" {
		teamWorkspaceStore.mu.Unlock()
		return false
	}
	now := time.Now()
	for i, h := range st.Handoffs[key] {
		if !teamHandoffOpen(h) { // closed, or paused (stays paused, does not keep the workspace)
			continue
		}
		if h.At.After(lastActive) {
			keep = true
			continue
		}
		st.Handoffs[key][i].Closed = now
	}
	if !keep {
		if platformReleases {
			for i, x := range st.Parents[owner] {
				if x.ID == wsID {
					st.Parents[owner][i].ReleasePending = true
				}
			}
		} else {
			teamWorkspaceDropLocked(st, owner, wsID)
		}
	}
	err := saveTeamWorkspacesLocked(path, st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		slog.Warn("team workspace: save state on release failed", "workspace", key, "error", err)
	}
	if keep {
		return false
	}
	if !platformReleases {
		slog.Info("team workspace: released after its last task", "workspace", key, "owner", owner)
		return true
	}
	// The platform request runs under teamWorkspaceOpMu like claims, so a claim and a release
	// never interleave; off the reset path, which must not wait on the network.
	go func() {
		teamWorkspaceOpMu.Lock()
		defer teamWorkspaceOpMu.Unlock()
		e.retryTeamWorkspaceReleases(key)
	}()
	return true
}

// ErrTeamWorkspaceNotOwned: park named a workspace no chat channel owns (already free).
var ErrTeamWorkspaceNotOwned = errors.New("workspace is not owned by any chat channel")

// ParkTeamWorkspace pauses one task of workspace ("<platform>:<id>[:user]", or a bare Discord
// id): the oldest handoff still in work is marked Parked. A paused task stopped at a clean
// point (waiting for the user's feedback or someone else's change); its handoff file, branch and
// PR stay, it becomes the chat channel's to-do and is handed off again with claim/new when it
// resumes, to whichever workspace is free then. When no other task is in work there, the
// workspace goes back to the pool right away (the same release as after its last task, through
// the platform where it records the owner itself, asking it to pause its own tasks:
// TeamWorkspaceParker) and the lead's sessions there are reset, so the next task does not
// continue the paused one's context. Pausing is explicit (board pause, `bothouse workspace
// park`); nothing decides by itself that a task stopped. Returns whether the workspace was freed
// (or its release is pending on the platform).
func (e *Engine) ParkTeamWorkspace(workspace string) (freed bool, err error) {
	return e.ParkTeamWorkspaceFor(workspace, "", time.Time{})
}

// ParkTeamWorkspaceFor is ParkTeamWorkspace for one chat channel's task (the board pausing the
// task it handed off): chat ("<platform>:<chat id>", or a workspace of it) must own the
// workspace now, and only a handoff that chat recorded is parked — the newest one at or before
// `before` (when the board bound the task; zero: the oldest). The workspace may have finished
// that task, gone back to the pool and been claimed by another chat channel (or by the same one
// for a later task) since; parking then would pause someone else's task, free the workspace
// under them and stop their running agent. So: owned by another chat, or no such handoff in
// work → ErrTeamWorkspaceNotOwned and nothing changes. chat "" is the workspace pausing its own
// task (`bothouse workspace park` inside it): the oldest handoff in work, as before.
func (e *Engine) ParkTeamWorkspaceFor(workspace, chat string, before time.Time) (freed bool, err error) {
	if e == nil || e.dataDir == "" || workspace == "" {
		return false, errors.New("team workspace park: workspace is required")
	}
	key := teamChatKey(workspace)
	plat, _, _ := strings.Cut(key, ":")
	wsID := teamChannelID(key)
	path := teamWorkspacePath(e.dataDir)
	_, platformReleases := e.platformForName(plat).(TeamWorkspaceReleaser)
	if chat != "" {
		chat = teamChatKey(chat)
		if p, ok := e.WorkspaceParent(chat); ok {
			chat = p
		}
	}

	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	owner, _ := teamWorkspaceOwnerLocked(st, plat, wsID)
	if owner == "" || (chat != "" && owner != chat) {
		teamWorkspaceStore.mu.Unlock()
		if owner != "" {
			return false, fmt.Errorf("team workspace park: %s belongs to %s, not %s: %w", key, owner, chat, ErrTeamWorkspaceNotOwned)
		}
		return false, fmt.Errorf("team workspace park: %s: %w", key, ErrTeamWorkspaceNotOwned)
	}
	pick := -1
	for i, h := range st.Handoffs[key] {
		if !teamHandoffOpen(h) {
			continue
		}
		if chat != "" && (teamChatKey(h.Chat) != chat || (!before.IsZero() && h.At.After(before))) {
			continue
		}
		pick = i
		if chat == "" || before.IsZero() { // the oldest; with `before`, the newest at or before it
			break
		}
	}
	if pick < 0 {
		teamWorkspaceStore.mu.Unlock()
		return false, fmt.Errorf("team workspace park: %s: no task of %s in work there: %w", key, chat, ErrTeamWorkspaceNotOwned)
	}
	now := time.Now()
	st.Handoffs[key][pick].Parked = now
	open := 0
	for _, h := range st.Handoffs[key] {
		if teamHandoffOpen(h) {
			open++
		}
	}
	if open == 0 {
		if platformReleases {
			for i, x := range st.Parents[owner] {
				if x.ID == wsID {
					st.Parents[owner][i].ReleasePending = true
					st.Parents[owner][i].Park = true
				}
			}
		} else {
			teamWorkspaceDropLocked(st, owner, wsID)
		}
	}
	err = saveTeamWorkspacesLocked(path, st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		return false, fmt.Errorf("team workspace park: %s: save: %w", key, err)
	}
	if open > 0 {
		slog.Info("team workspace: task paused; other tasks keep the workspace", "workspace", key, "owner", owner, "open", open)
		return false, nil
	}
	e.ResetTeamWorkspaceSessions(key)
	slog.Info("team workspace: released, its tasks are paused", "workspace", key, "owner", owner)
	if platformReleases {
		go func() {
			teamWorkspaceOpMu.Lock()
			defer teamWorkspaceOpMu.Unlock()
			e.retryTeamWorkspaceReleases(key)
		}()
	}
	return true, nil
}

// TeamHandoffEnded reports whether the workspace has stopped working on chat's task handed off
// at or before bound: that handoff is closed (the workspace finished it and its session was reset,
// releaseTeamWorkspace) or paused. The pick is ParkTeamWorkspaceFor's: chat's newest handoff at or
// before bound (bound zero: chat's newest; chat "": any chat's). false when no such handoff is
// recorded (not known to have ended). The team board uses it for a handoff item's live state.
func (e *Engine) TeamHandoffEnded(workspace, chat string, bound time.Time) bool {
	if e == nil || e.dataDir == "" || workspace == "" {
		return false
	}
	key := teamChatKey(workspace)
	if chat != "" {
		chat = teamChatKey(chat)
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	pick := -1
	list := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]
	for i, h := range list {
		if (chat != "" && teamChatKey(h.Chat) != chat) || (!bound.IsZero() && h.At.After(bound)) {
			continue
		}
		pick = i
	}
	return pick >= 0 && !teamHandoffOpen(list[pick])
}

// ResetTeamWorkspaceSessions gives every session of this engine in workspace key
// ("<platform>:<id>") a fresh, empty context: the running agent is stopped and the old
// transcript is not handed on (unlike /new), so the next task there starts clean. Used when a
// workspace is released with its tasks paused (ParkTeamWorkspace; the API server calls it on
// the teammates' engines too). Returns how many sessions were reset.
func (e *Engine) ResetTeamWorkspaceSessions(key string) int {
	if e == nil || e.sessions == nil {
		return 0
	}
	n := 0
	for _, k := range e.sessions.UserKeys() {
		if chatOf(k) != key {
			continue
		}
		_, sessions := e.sessionContextForKey(k)
		if sessions == nil {
			continue
		}
		e.cleanupInteractiveState(e.interactiveKeyForSessionKey(k))
		old := sessions.GetOrCreateActive(k)
		old.SetAgentSessionID("", "")
		old.ClearHistory()
		old.TakeHandoffFrom()
		sessions.NewSession(k, "")
		sessions.Save()
		n++
	}
	return n
}

// retryTeamWorkspaceReleases asks the platform of chat ("<platform>:<id>") to release every
// workspace of that platform whose release is pending (ReleasePending), naming the claim being
// ended, and drops the record of each one the platform released (or that it says was claimed
// again since, ErrTeamWorkspaceStaleClaim: that claim is over). A busy or failed release keeps
// the record for the next try. Caller holds teamWorkspaceOpMu.
func (e *Engine) retryTeamWorkspaceReleases(chat string) {
	if e == nil || e.dataDir == "" {
		return
	}
	plat, _, _ := strings.Cut(chat, ":")
	r, ok := e.platformForName(plat).(TeamWorkspaceReleaser)
	if !ok {
		return
	}
	path := teamWorkspacePath(e.dataDir)
	type pending struct {
		owner, id, claim string
		park             bool
	}
	var todo []pending
	teamWorkspaceStore.mu.Lock()
	for parent, list := range loadTeamWorkspacesLocked(path).Parents {
		if p, _, _ := strings.Cut(parent, ":"); p != plat {
			continue
		}
		for _, w := range list {
			if w.ReleasePending {
				todo = append(todo, pending{parent, w.ID, w.Claim, w.Park})
			}
		}
	}
	teamWorkspaceStore.mu.Unlock()
	for _, x := range todo {
		ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
		var err error
		if pk, ok := r.(TeamWorkspaceParker); ok && x.park {
			err = pk.ParkTeamWorkspaceChannel(ctx, x.id, x.claim)
		} else {
			err = r.ReleaseTeamWorkspaceChannel(ctx, x.id, x.claim)
		}
		cancel()
		key := plat + ":" + x.id
		if err != nil && !errors.Is(err, ErrTeamWorkspaceStaleClaim) {
			slog.Warn("team workspace: platform release failed; kept, retried later", "workspace", key, "owner", x.owner, "error", err)
			continue
		}
		teamWorkspaceStore.mu.Lock()
		st := loadTeamWorkspacesLocked(path)
		// Only the record this release was for (claims run under teamWorkspaceOpMu too).
		if owner, w := teamWorkspaceOwnerLocked(st, plat, x.id); owner == x.owner && w.ReleasePending && w.Claim == x.claim {
			teamWorkspaceDropLocked(st, owner, x.id)
			if err := saveTeamWorkspacesLocked(path, st); err != nil {
				slog.Warn("team workspace: save state on release failed", "workspace", key, "error", err)
			}
		}
		teamWorkspaceStore.mu.Unlock()
		slog.Info("team workspace: released after its last task", "workspace", key, "owner", x.owner, "stale_claim", err != nil)
	}
}

// TeamWorkspacePool returns every workspace in the server/category of chat, 「工作区n」 lowest
// number first, then old 「<chat name>-工作区n」 ones a platform could not rename, each with
// the chat channel that owns it now (Owner, "" = free). Callers pick the first one that is
// free or their own; ClaimTeamWorkspace refuses one another chat owns. Recorded old names
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
	e.retryTeamWorkspaceReleases(chat)
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	self, guild, err := plat.TeamGuildChannels(ctx, teamChannelID(chat))
	if err != nil {
		return nil, err
	}
	if e.dataDir != "" {
		guild = e.teamWorkspaceMigrate(ctx, chat, plat, self, guild)
	}
	pname, _, _ := strings.Cut(chat, ":")
	owners := map[string]string{}
	counts := map[string][2]int{}  // workspace id → open, parked handoffs
	dues := map[string]time.Time{} // workspace id → watch check time (watch started only)
	watched := e.handoffWatchOn.Load()
	if e.dataDir != "" {
		teamWorkspaceStore.mu.Lock()
		st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
		for key := range st.Handoffs {
			if p, id, _ := strings.Cut(key, ":"); p == pname {
				open, parked := teamWorkspaceCountsLocked(st, key)
				counts[id] = [2]int{open, parked}
				if watched {
					dues[id] = teamWorkspaceWatchDueLocked(st, key)
				}
			}
		}
		for parent, list := range st.Parents {
			if p, _, _ := strings.Cut(parent, ":"); p == pname {
				for _, w := range list {
					owners[w.ID] = parent
				}
			}
		}
		teamWorkspaceStore.mu.Unlock()
	}
	var out []TeamWorkspace
	for _, c := range guild {
		if c.ParentID == self.ParentID && c.ID != self.ID && isTeamWorkspaceName(c.Name) {
			owner := owners[c.ID]
			if c.OwnerKnown {
				owner = ""
				if c.Owner != "" {
					owner = pname + ":" + c.Owner
				}
			}
			w := TeamWorkspace{Name: c.Name, ID: c.ID, Owner: owner}
			w.Open, w.Parked = counts[c.ID][0], counts[c.ID][1]
			w.WatchDue = dues[c.ID]
			out = append(out, w)
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
