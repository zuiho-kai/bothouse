package core

import (
	"fmt"
	"strings"
)

// DMMemberChecker is an optional interface for platforms that can tell whether userID belongs to the
// server (guild) of the conversation fromSession, so `send --dm --to <id>` reaches only people in
// that server. fromSession may be empty or a private chat; then any server the bot shares counts.
type DMMemberChecker interface {
	IsDMMember(fromSession, userID string) (bool, error)
}

// PrivateThreadOpener is an optional interface for platforms that can open a thread in the channel of
// fromSession that only userID (and server moderators) can see. `send --dm` falls back to it when the
// platform refuses the DM (the person does not accept DMs from server members), so nobody has to change
// a privacy setting to receive it (#1352).
type PrivateThreadOpener interface {
	OpenPrivateThread(fromSession, userID, name string) (sessionKey string, err error)
}

// DMRefusalDetector is implemented by platforms that can tell a send error means "this user does not
// accept the DM" (Discord 50007), as opposed to any other failure.
type DMRefusalDetector interface {
	IsDMRefused(err error) bool
}

func (e *Engine) isDMRefused(err error) bool {
	if err == nil {
		return false
	}
	for _, p := range e.platforms {
		if d, ok := p.(DMRefusalDetector); ok && d.IsDMRefused(err) {
			return true
		}
	}
	return false
}

// dmFallbackThread opens a private thread with userID in fromSession's channel after the DM was refused.
func (e *Engine) dmFallbackThread(fromSession, userID string) (string, Platform, error) {
	prefix := ""
	if i := strings.Index(fromSession, ":"); i > 0 {
		prefix = fromSession[:i]
	}
	for _, p := range e.platforms {
		if o, ok := p.(PrivateThreadOpener); ok && p.Name() == prefix {
			key, err := o.OpenPrivateThread(fromSession, userID, "私信 / private")
			return key, p, err
		}
	}
	return "", nil, fmt.Errorf("no private thread available here")
}

// dmUser is the person `bothouse send --dm` writes to: the first explicit ID in
// admin_from, i.e. the project owner already configured there. No new config key; "*"
// names no one.
func (e *Engine) dmUser() string {
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, id := range strings.Split(af, ",") {
		if id = strings.TrimSpace(id); id != "" && id != "*" {
			return id
		}
	}
	return ""
}

// isDMOwner reports whether userID is named explicitly in admin_from (the DM owner is the
// first such ID). Unlike isAdmin, "*" grants nothing: a wildcard would let anyone who can
// DM the bot bypass the gate.
func (e *Engine) isDMOwner(userID string) bool {
	if userID == "" {
		return false
	}
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, id := range strings.Split(af, ",") {
		if id = strings.TrimSpace(id); id != "" && id != "*" && strings.EqualFold(id, userID) {
			return true
		}
	}
	return false
}

// OpenDMSession opens (or reuses) the private chat between this bot and the user named by
// admin_from on the first platform that supports it, and returns its session key. Sending to
// that key then goes through the normal send path (ReconstructReplyCtx), and the user's reply
// in the chat lands in the same session.
func (e *Engine) OpenDMSession() (string, error) {
	user := e.dmUser()
	if user == "" {
		return "", fmt.Errorf("--dm: admin_from has no user ID to message. Fix: in config.toml put " +
			"admin_from = \"<your user ID>\" in this project's [[projects]] block (next to name; " +
			"under [projects.platforms.options] it is ignored), get the ID by sending /whoami to the bot, " +
			"then restart bothouse")
	}
	for _, p := range e.platforms {
		if o, ok := p.(DirectMessageOpener); ok {
			return o.OpenDM(user)
		}
	}
	return "", fmt.Errorf("--dm: no platform in this project can open a private chat")
}

// normalizeDMTarget accepts a bare user ID or a mention written as <@id> / <@!id>.
func normalizeDMTarget(to string) string {
	to = strings.TrimSpace(to)
	if strings.HasPrefix(to, "<@") && strings.HasSuffix(to, ">") {
		to = strings.TrimPrefix(strings.TrimSuffix(to[2:], ">"), "!")
	}
	return strings.TrimSpace(to)
}

// OpenDMSessionFor is `send --dm [--to <id>]` sent from a tool running in fromSession.
//
// Without to it messages the owner (admin_from), as before — but when the turn running in fromSession
// was started by a person who is not the owner, it refuses: the model usually means that person, and
// silently writing to the owner is how other people's messages ended up in the owner's DMs (#1352).
// With to it messages that user, who must be the owner or a member of the conversation's server; a
// failure is returned as is and never redirected to someone else.
func (e *Engine) OpenDMSessionFor(fromSession, to string) (key, user string, err error) {
	to = normalizeDMTarget(to)
	if to == "" {
		if t, ok := e.callerTurnOf(fromSession); ok && t.kind == CallerHuman && !e.isDMOwner(t.userID) {
			owner := e.dmUser()
			return "", "", fmt.Errorf("--dm without --to goes only to the project owner (%s), but this turn was "+
				"started by %s (%s), who is not the owner. Nothing was sent. To message that person privately "+
				"use --dm --to %s; to message the owner on purpose use --dm --to %s", owner, t.userName, t.userID, t.userID, owner)
		}
		key, err := e.OpenDMSession()
		return key, e.dmUser(), err
	}
	var opener DirectMessageOpener
	var plat Platform
	prefix := ""
	if i := strings.Index(fromSession, ":"); i > 0 {
		prefix = fromSession[:i]
	}
	for _, p := range e.platforms {
		o, ok := p.(DirectMessageOpener)
		if !ok {
			continue
		}
		if opener == nil || (prefix != "" && p.Name() == prefix) {
			opener, plat = o, p
		}
	}
	if opener == nil {
		return "", "", fmt.Errorf("--dm: no platform in this project can open a private chat")
	}
	if !e.isDMOwner(to) {
		mc, ok := plat.(DMMemberChecker)
		if !ok {
			return "", "", fmt.Errorf("--dm --to: %s cannot check server membership, so it can only message the owner; nothing was sent", plat.Name())
		}
		member, err := mc.IsDMMember(fromSession, to)
		if err != nil {
			return "", "", fmt.Errorf("--dm --to %s: cannot check membership: %w; nothing was sent", to, err)
		}
		if !member {
			return "", "", fmt.Errorf("--dm --to %s: not a member of this server; nothing was sent", to)
		}
	}
	key, err = opener.OpenDM(to)
	return key, to, err
}
