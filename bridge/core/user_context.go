package core

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

// UserContext is who a turn belongs to, resolved at the moment it is asked for.
//
// #2 signed an identity that exists only at the instant a ticket is minted: the
// platform person whose message owns the running turn. That leaves a hole for
// every turn nobody typed into — a cron job, a timer, a heartbeat, a workspace
// hand-off. Those turns used to have no identity at all, which is honest but
// useless: nothing downstream can tell whose work they are doing, so nothing can
// apply that person's permissions to them, and nothing can stop them when that
// person loses those permissions.
//
// This type closes the hole without weakening the rule behind #2. A scheduled
// turn does not inherit the identity of whoever last typed in the channel; it
// carries the person who CREATED it, recorded when the job was created and
// re-resolved against the live role table every time it is read.
//
// The creator's permissions are a CEILING, not a snapshot and not history: the
// turn runs with the INTERSECTION of what that person could do when the job was
// created and what they can do now. Freezing creation-time rights would let a
// job keep high rights after they are revoked ("create a privileged cron job,
// then lose the privilege and keep running"); following the live role alone
// would let a job gain rights by its creator being PROMOTED ("create a low cron
// job, then wait for the rank"). Only the intersection refuses both directions,
// because it can only ever narrow.
//
// The one thing this type can never do is be built by a model. It is constructed
// only by the bridge: from a turn's grant (which came from a platform event) or
// from a job's recorded creator (which came from the turn that created the job).
// A caller asks for its context over the same unix-socket peer-credential and
// ancestry check that /originator/sign uses. Tool processes and subagents in
// that tree share the running turn; processes outside it get no identity.
// Descendants cannot select another session by changing their own environment.

// UserContextPrincipal is the platform-authenticated person, or empty for a turn
// that genuinely has no person behind it (a merged batch, a bot message).
type UserContextPrincipal struct {
	Platform string `json:"platform"`
	UserID   string `json:"user_id"`
}

// jobCreator is who created a scheduled job, recorded when the job is created.
//
// It is captured from the calling turn's grant, which itself came from a
// platform event — never from the request body, which a model writes. A job
// created outside the bridge's process tree (an operator running the CLI by
// hand) records nothing, and such a job stays identity-less rather than
// borrowing the channel's last speaker.
//
// Role is the role the creator had AT CREATION TIME. It is history, compared
// against the live table so a change is visible; it is never an entitlement.
//
// DisabledCommands and RoleDigest are the creation-time permission CEILING: the
// commands that role could not use then, and a fingerprint of that role's whole
// permission set. The job runs with the intersection of that set and the
// creator's current set, so it can only ever become narrower — a job created as
// a member does not grow into an administrator's rights when its creator is
// promoted, and a role whose commands were re-configured under the same name is
// detected by the digest instead of silently passing as unchanged.
type JobCreator struct {
	Platform string `json:"platform" toml:"platform"`
	UserID   string `json:"user_id" toml:"user_id"`
	Role     string `json:"role,omitempty" toml:"role,omitempty"`
	// DisabledCommands: the commands the creator's role could not use when the
	// job was created, sorted. Empty means the role carried no command
	// restrictions at creation (or the job predates this record).
	DisabledCommands []string `json:"disabled_commands,omitempty" toml:"disabled_commands,omitempty"`
	// RoleDigest fingerprints the creation-time role (name + its command
	// restrictions). A role reconfigured under the same name changes the digest.
	RoleDigest string `json:"role_digest,omitempty" toml:"role_digest,omitempty"`
}

// Internal alias keeps existing job records and callers unchanged.
type jobCreator = JobCreator

// UserContextSource says where the context came from. It is reported so a caller
// can tell "the person whose message owns this turn" from "the person who
// scheduled this job" without inferring it from fields.
const (
	// UserContextSourceTurn: the platform message that owns this turn.
	UserContextSourceTurn = "turn"
	// UserContextSourceScheduled: a cron/timer/heartbeat/workspace turn, whose
	// principal is the creator recorded on the job.
	UserContextSourceScheduled = "scheduled"
	// UserContextSourceNone: no identity. A merged batch, a bot message, a job
	// with no recorded creator, or a creator that no longer resolves to a role.
	UserContextSourceNone = "none"
)

// UserContext is the resolved identity of one turn.
//
// It holds no keys and no credentials: every field here is already public inside
// the bridge's own process (the role table is configuration, the session key is
// in the caller's environment). The point of the type is that its VALUES cannot
// be asserted by the caller — a model that invents a project, session or role
// name still gets the bridge's answer for its own turn.
type UserContext struct {
	// Source is one of the UserContextSource* constants.
	Source string `json:"source"`
	// Principal is the person. Nil when Source is UserContextSourceNone.
	Principal *UserContextPrincipal `json:"principal,omitempty"`
	// Role is the role this context acts with. For a live turn it is the
	// principal's role right now. For a scheduled turn it is the NARROWER of the
	// creation-time role and the live one, so a job is never described with
	// rights it was not created with. Empty when the principal has no role or
	// there is no principal.
	Role string `json:"role,omitempty"`
	// Project and Session are the caller's own, as the bridge recorded them.
	Project string `json:"project"`
	Session string `json:"session"`
	// Delegation is the chain of people this context acts for, outermost first.
	// P1 has no delegation feature (it arrives with P3/P4); the field exists so
	// the shape is the one the multi-user plan defines, and stays empty.
	Delegation []string `json:"delegation,omitempty"`
	// Grant is the short-lived capability this context may exercise. P1 does not
	// mint capabilities — the ticket endpoint (#2, /originator/sign) does that
	// and is unchanged — so it is empty here rather than describing something
	// this endpoint does not hand out.
	Grant string `json:"grant,omitempty"`
	// Revoked reports that the recorded creator no longer has the role it had,
	// so a scheduled turn must not act on its behalf. It is computed live, not
	// stored: the same job flips to true the moment the role table changes.
	Revoked bool `json:"revoked,omitempty"`
	// DisabledCommands is the effective command restriction of a scheduled turn:
	// the intersection of the creation-time set and the live set, sorted. It is
	// a subset of both, so a turn can never hold a command either one denies.
	// Empty for a turn or for a role with no command restrictions.
	DisabledCommands []string `json:"disabled_commands,omitempty"`
	// Reason explains Revoked (or a missing identity) in one short sentence, so
	// a refused caller learns what to fix instead of retrying blindly.
	Reason string `json:"reason,omitempty"`
}

// HasIdentity reports whether this context names a person.
func (c UserContext) HasIdentity() bool {
	return c.Source != UserContextSourceNone && c.Principal != nil
}

// intersectDisabledCommands returns the sorted union of two restricted-command
// sets. A command disabled by either side is disabled for the turn, which is
// what "the intersection of the two permissions" means when the permission is
// expressed as what is denied.
func intersectDisabledCommands(a, b []string) []string {
	if len(a) == 0 && len(b) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(a)+len(b))
	for _, list := range [][]string{a, b} {
		for _, cmd := range list {
			if cmd = strings.TrimSpace(cmd); cmd != "" {
				seen[cmd] = true
			}
		}
	}
	out := make([]string, 0, len(seen))
	for cmd := range seen {
		out = append(out, cmd)
	}
	sort.Strings(out)
	return out
}

// roleDigest fingerprints one role's permission set: its name plus the commands
// it cannot use. Two configurations that differ only in which commands a role
// may run produce different digests, so a job can notice that its creator's
// same-named role was reconfigured.
func roleDigest(name string, disabledCmds map[string]bool) string {
	cmds := make([]string, 0, len(disabledCmds))
	for cmd, off := range disabledCmds {
		if off {
			cmds = append(cmds, cmd)
		}
	}
	sort.Strings(cmds)
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(name)) + "\x00" + strings.Join(cmds, "\x00")))
	return hex.EncodeToString(sum[:8])
}

// userContextForTurn builds the context of a turn from its grant. grantOK is
// false for a merged batch, a bot message or a turn with no platform identity;
// such a turn has no principal at all (the #2 rule, unchanged).
//
// The role comes from the live table, never from the grant: a person's role can
// change between the message and the question.
func (e *Engine) userContextForTurn(project, session string, grant originatorGrant, grantOK bool) UserContext {
	if !grantOK || grant.platform == "" || grant.userID == "" {
		return UserContext{
			Source: UserContextSourceNone, Project: project, Session: session,
			Reason: "this turn has no single platform person behind it",
		}
	}
	ctx := UserContext{
		Source:    UserContextSourceTurn,
		Principal: &UserContextPrincipal{Platform: grant.platform, UserID: grant.userID},
		Project:   project,
		Session:   session,
	}
	if role, ok := e.roleForPrincipal(grant.userID); ok {
		ctx.Role = role
	}
	return ctx
}

// userContextForScheduled builds the context of a scheduled turn from the
// creator recorded on its job, re-resolving that creator's role against the
// live table. An empty recorded creator means the job predates this record or
// was created by something with no person behind it; it stays identity-less
// rather than borrowing the channel's last speaker.
func (e *Engine) userContextForScheduled(project, session string, creator *jobCreator) UserContext {
	if creator == nil || creator.Platform == "" || creator.UserID == "" {
		return UserContext{
			Source: UserContextSourceNone, Project: project, Session: session,
			Reason: "this scheduled job has no recorded creator",
		}
	}
	ctx := UserContext{
		Source:    UserContextSourceScheduled,
		Principal: &UserContextPrincipal{Platform: creator.Platform, UserID: creator.UserID},
		Project:   project,
		Session:   session,
	}
	live, rolesConfigured := e.roleForPrincipal(creator.UserID)
	switch {
	case !rolesConfigured && creator.Role != "":
		ctx.Revoked = true
		ctx.Reason = "the creator's configured role table is no longer available"
	case !rolesConfigured:
		// Legacy jobs created without a role table carry identity only, not a role.
		ctx.Role = ""
	case live == "":
		// The creator is no longer in any role (removed from the table, or the
		// table has no default and no match): the job must not act for them.
		ctx.Revoked = true
		ctx.Reason = "the creator no longer resolves to a role"
	default:
		// Permission = creation-time set ∩ live set. The intersection can only
		// narrow: a job created without a right never gains it by promotion, and
		// one created with a right keeps it only while the live role still has
		// it. A job that predates the ceiling record has no set to intersect
		// with, so it is capped by its recorded role instead (below).
		ceiling, known := e.creationPermCeiling(creator)
		if !known {
			// The recorded role cannot be resolved any more and the record kept
			// no set of its own: the ceiling the job must stay inside cannot be
			// established, so it must not run with the creator's live rights.
			ctx.Revoked = true
			ctx.Reason = "the role this job was created under is no longer defined, so its permission ceiling cannot be established"
			return ctx
		}
		liveSet := e.disabledCommandsFor(creator.UserID)
		ctx.DisabledCommands = intersectDisabledCommands(ceiling, liveSet)
		// Which name to report: the live role, unless the live role is WIDER than
		// the creation role. A wider live set means the live role denies strictly
		// fewer commands (a promotion, or the same name granted more), and a job
		// must never be described with rights it was not created with. Everywhere
		// else — demotion, an equal set under another name, an unchanged role —
		// the live role is the honest answer.
		liveWider := disabledCovers(ceiling, liveSet) && len(ceiling) > len(liveSet)
		if creator.Role != "" && creator.Role != live && liveWider {
			ctx.Role = creator.Role
			ctx.Reason = "the creator's role is wider now than when this job was created; the job keeps the narrower creation-time role"
		} else {
			ctx.Role = live
			if creator.Role != "" && creator.Role != live {
				ctx.Reason = "the creator's role changed since this job was created; it now runs with the narrower of the two"
			}
		}
		if creator.RoleDigest != "" && creator.RoleDigest != e.roleDigestFor(creator.UserID) && ctx.Reason == "" {
			// Same role name, different permission set: the name alone would hide
			// it, so the intersection above keeps the job inside both sets.
			ctx.Reason = "the creator's role permissions changed since this job was created; the job keeps the narrower of the two"
		}
	}
	return ctx
}

// creationPermCeiling is the set of commands the creator's role could not use
// when the job was created.
//
// New records carry it verbatim (with a digest of the role it came from). A
// record without one predates the ceiling — for those, the recorded role is
// looked up in the CURRENT table, which is the closest thing to its set; when
// the role is gone and the record kept no set, the ceiling is unknowable and
// known is false, and the caller must not let the job run on live rights.
func (e *Engine) creationPermCeiling(creator *jobCreator) ([]string, bool) {
	if creator == nil {
		return nil, false
	}
	if creator.RoleDigest != "" || creator.DisabledCommands != nil {
		return creator.DisabledCommands, true
	}
	if creator.Role == "" {
		// No role recorded at all: nothing to intersect, and nothing to widen.
		return nil, true
	}
	if cmd, ok := e.disabledCommandsForRole(creator.Role); ok {
		return cmd, true
	}
	return nil, false
}

// disabledCovers reports whether a denies every command b denies, i.e. a is at
// least as narrow as b.
func disabledCovers(a, b []string) bool {
	if len(b) == 0 {
		return true
	}
	have := make(map[string]bool, len(a))
	for _, cmd := range a {
		have[cmd] = true
	}
	for _, cmd := range b {
		if !have[cmd] {
			return false
		}
	}
	return true
}

// checkScheduledCreator runs at admission and again immediately before a queued
// prompt is sent. Legacy ownerless jobs remain supported only without a role
// table; a configured multi-user deployment requires a recognized creator.
func (e *Engine) checkScheduledCreator(session string, creator *jobCreator) error {
	ctx := e.userContextForScheduled(e.name, session, creator)
	if ctx.Revoked {
		return fmt.Errorf("scheduled creator denied: %s", ctx.Reason)
	}
	if _, configured := e.roleForPrincipal(""); configured && !ctx.HasIdentity() {
		return fmt.Errorf("scheduled creator denied: %s", ctx.Reason)
	}
	return nil
}

// workspaceJobCreator resolves the recorded task, never the channel's last user.
//
// The lookup follows the handoff's real lifecycle rather than a single board
// number, because a handoff is created by claim BEFORE the board item exists
// (ws-handoff: pick_pool/claim, then board.add): the ordinary case is an open
// handoff whose Board is still 0, and matching only on Board finds nothing and
// leaves the wake-up identity-less.
//
// Resolution is scoped to the caller's own channel (session's chat key), so an
// unrelated session can never borrow another channel's creator. Inside that
// scope it picks the generation in work now: an open (neither closed nor parked)
// handoff wins over a finished one that shares the board number, and when
// several open handoffs exist the newest claim is the current generation. A
// closed record from an earlier occupant (a reused workspace) is only returned
// when nothing is open at all.
func (e *Engine) workspaceJobCreator(session string, board int) *jobCreator {
	if e.dataDir == "" || session == "" {
		return nil
	}
	key := teamChatKey(session)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))

	var best *TeamHandoff
	bestOpen, bestExact := false, false
	for wsKey, list := range st.Handoffs {
		// The channel constraint: a handoff belongs to the caller's session when
		// the session names either the workspace it was claimed on (the map key)
		// or the chat channel it came from (Chat). Nothing else may borrow it.
		for _, h := range list {
			if wsKey != key && teamChatKey(h.Chat) != key {
				continue
			}
			if board > 0 && h.Board != 0 && h.Board != board {
				continue
			}
			if h.CreatedBy == nil {
				continue
			}
			// A handoff already bound to this board outranks an unbound (Board=0)
			// one: an unbound handoff of another workspace in the same chat must
			// not take board N's creator just because it is newer.
			exact := board > 0 && h.Board == board
			open := teamHandoffOpen(h)
			switch {
			case best == nil:
			case exact && !bestExact:
			case exact != bestExact:
				continue
			case open && !bestOpen:
			case open == bestOpen && h.At.After(best.At):
			default:
				continue
			}
			h := h
			best, bestOpen, bestExact = &h, open, exact
		}
	}
	if best == nil {
		return nil
	}
	copy := *best.CreatedBy
	return &copy
}

// disabledCommandsFor returns the live role's disabled command set for a person,
// or nil when there is no role table or no role for them. It is the live side of
// the permission intersection.
func (e *Engine) disabledCommandsFor(userID string) []string {
	e.userRolesMu.RLock()
	urm := e.userRoles
	e.userRolesMu.RUnlock()
	if urm == nil {
		return nil
	}
	role := urm.ResolveRole(userID)
	if role == nil {
		return nil
	}
	return sortedDisabledCommands(role.DisabledCmds)
}

// disabledCommandsForRole returns the disabled command set of a role BY NAME,
// and whether that role is still defined. It resolves a record that predates the
// ceiling snapshot.
func (e *Engine) disabledCommandsForRole(name string) ([]string, bool) {
	e.userRolesMu.RLock()
	urm := e.userRoles
	e.userRolesMu.RUnlock()
	if urm == nil || name == "" {
		return nil, false
	}
	role := urm.RoleByName(name)
	if role == nil {
		return nil, false
	}
	return sortedDisabledCommands(role.DisabledCmds), true
}

// sortedDisabledCommands turns a resolution set into the sorted, serializable
// list the ceiling records.
func sortedDisabledCommands(set map[string]bool) []string {
	if len(set) == 0 {
		return nil
	}
	out := make([]string, 0, len(set))
	for cmd, off := range set {
		if off {
			out = append(out, cmd)
		}
	}
	sort.Strings(out)
	return out
}

// roleDigestFor fingerprints the person's current role, or "" when there is no
// role table or no role for them.
func (e *Engine) roleDigestFor(userID string) string {
	e.userRolesMu.RLock()
	urm := e.userRoles
	e.userRolesMu.RUnlock()
	if urm == nil {
		return ""
	}
	role := urm.ResolveRole(userID)
	if role == nil {
		return ""
	}
	return roleDigest(role.Name, role.DisabledCmds)
}

// roleForPrincipal resolves a platform user id to its current role name, and
// reports whether a role table is configured at all. The second value is what
// separates "this person has no role" from "this deployment has no roles"
// (legacy single-user mode), which callers must not confuse: the first is a
// revocation, the second is simply not applicable.
func (e *Engine) roleForPrincipal(userID string) (string, bool) {
	e.userRolesMu.RLock()
	urm := e.userRoles
	e.userRolesMu.RUnlock()
	if urm == nil {
		return "", false
	}
	role := urm.ResolveRole(userID)
	if role == nil {
		return "", true
	}
	return role.Name, true
}

// userContextForSession answers a caller's question about its own turn.
//
// The project and session come from the caller's ancestry check, not from the
// request body, so the answer is always about the caller's own turn. The
// principal comes from what the bridge recorded for that turn when it started;
// when the turn is one nobody typed into, from the job's recorded creator.
func (e *Engine) userContextForSession(session string) UserContext {
	if e == nil || session == "" {
		return UserContext{Source: UserContextSourceNone, Reason: "no session to look up"}
	}
	if value, ok := e.originatorTurns.Load(session); ok {
		grant, _ := value.(originatorGrant)
		return e.userContextForTurn(e.name, session, grant, true)
	}
	// A scheduled turn has no platform originator (#2 refuses to mint one for
	// it) but does record the creator it runs for, so it is not a blank.
	if value, ok := e.originatorScheduled.Load(session); ok {
		creator, _ := value.(jobCreator)
		return e.userContextForScheduled(e.name, session, &creator)
	}
	return UserContext{
		Source: UserContextSourceNone, Project: e.name, Session: session,
		Reason: "no platform originator and no recorded creator for this session",
	}
}

// jobCreatorForTurn is the creator a job created during this turn records.
//
// ONLY the bridge can answer this: the person comes from the turn's grant
// (minted from a platform event) and the role from the live table. A caller
// that is not inside the bridge's process tree gets nil, so the job it creates
// records no creator and stays identity-less — the honest answer, and the one
// that keeps a model from writing itself an owner.
func (e *Engine) jobCreatorForTurn(project, session string) *jobCreator {
	if e == nil || session == "" {
		return nil
	}
	if value, ok := e.originatorTurns.Load(session); ok {
		if grant, ok := value.(originatorGrant); ok && grant.platform != "" && grant.userID != "" {
			return e.newJobCreator(grant.platform, grant.userID, nil)
		}
	}
	// A scheduled turn has no grant, but it already runs for a recorded creator.
	// A job it creates belongs to that same person: without this, a chain of
	// scheduled jobs loses its identity after the first hop (the second job is
	// created inside a turn nobody typed into). It borrows nothing new — the
	// creator was recorded from a real platform turn, and this turn is already
	// acting for them — and it inherits the running job's CEILING, never the
	// creator's live rights, so a chain cannot widen what it started with. A
	// creator who has since been revoked passes nothing on.
	if value, ok := e.originatorScheduled.Load(session); ok {
		if creator, ok := value.(jobCreator); ok {
			if ctx := e.userContextForScheduled(e.name, session, &creator); ctx.HasIdentity() && !ctx.Revoked {
				next := e.newJobCreator(creator.Platform, creator.UserID, &creator)
				next.DisabledCommands = ctx.DisabledCommands
				return next
			}
		}
	}
	return nil
}

// newJobCreator records who is creating a job, with the permission ceiling that
// job will run under: the creator's role and its restricted commands as they
// stand NOW (creation time). A running scheduled job (inherit non-nil) hands its
// own ceiling down instead of the live one, so a chain of jobs never widens.
func (e *Engine) newJobCreator(platform, userID string, inherit *jobCreator) *jobCreator {
	creator := &jobCreator{Platform: platform, UserID: userID}
	if role, configured := e.roleForPrincipal(userID); configured {
		creator.Role = role
		creator.RoleDigest = e.roleDigestFor(userID)
		creator.DisabledCommands = e.disabledCommandsFor(userID)
	}
	if inherit != nil {
		if inherit.Role != "" {
			creator.Role = inherit.Role
		}
		creator.RoleDigest = inherit.RoleDigest
		creator.DisabledCommands = intersectDisabledCommands(inherit.DisabledCommands, creator.DisabledCommands)
	}
	return creator
}

// jobCreatorForMessage is the creator a job records when a person typed the
// command that creates it in the chat (/cron add, /timer add).
//
// It cannot go through originatorTurns: a slash command is handled before the
// turn's grant is stored, so that map still holds the PREVIOUS turn's person.
// The person is taken from this message itself, under exactly the rule the
// ticket endpoint uses (originatorGrantFor): a bot, a scheduled turn (whose
// UserID is "cron"/"timer"/"heartbeat") or a merged batch has no single human
// behind it and records nothing.
func (e *Engine) jobCreatorForMessage(msg *Message) *jobCreator {
	if msg == nil {
		return nil
	}
	grant, ok := originatorGrantFor(msg.FromBot, msg.Platform, msg.UserID, msg.MessageID, turnTriggerOf(msg))
	if !ok {
		return nil
	}
	return e.newJobCreator(grant.platform, grant.userID, nil)
}

// setScheduledCreator records who the turn now running on session works for,
// replacing whatever the previous turn recorded. It is the exact companion of
// the originatorTurns Delete/Store pair: a turn with no creator clears the
// record instead of leaving the previous turn's behind.
func (e *Engine) setScheduledCreator(session string, creator *jobCreator) {
	if session == "" {
		return
	}
	e.originatorScheduled.Delete(session)
	if creator != nil && creator.Platform != "" && creator.UserID != "" {
		e.originatorScheduled.Store(session, *creator)
	}
}

// clearScheduledCreator drops the record when a turn ends, so a finished turn
// never answers for the next one on the same session.
func (e *Engine) clearScheduledCreator(session string) {
	if session != "" {
		e.originatorScheduled.Delete(session)
	}
}
