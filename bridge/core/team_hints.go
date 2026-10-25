package core

// Actionable hints for the primary role when team work cannot start (#587): a teammate's
// bot not bound in the channel, or no workspace yet. Before, assignments and relay sends to
// an unbound bot failed with wording that did not say what to do, and the cards stayed
// unposted with nothing in the channel; an empty workspace list read as "workspaces come by
// themselves". Workspaces stay on-demand (team_workspace.go header); this only says how to
// make the first one.

import (
	"errors"
	"fmt"
	"strings"
)

// teamWorkspaceNoneHint: the chat channel has no workspace yet.
const teamWorkspaceNoneHint = "还没有工作区，用 bothouse workspace new 建工作区1"

// notBoundHint is the one sentence both the command and the channel get.
func notBoundHint(project string) string {
	return fmt.Sprintf("%s 在本频道没绑定，请用户在本频道发 /bind %s", project, project)
}

// ErrNotBoundInChannel marks a bot not bound in the channel (errors.Is).
var ErrNotBoundInChannel = errors.New("not bound in this channel")

// notBoundError says which project to /bind. permanent: the binding is loaded with the relay
// manager, so retrying the same fact cannot succeed (ErrTaskFactUndeliverable).
type notBoundError struct {
	project   string
	permanent bool
	detail    string // optional, e.g. the bots that are bound
}

func (e *notBoundError) Error() string {
	if e.detail == "" {
		return notBoundHint(e.project)
	}
	return notBoundHint(e.project) + "（" + e.detail + "）"
}

func (e *notBoundError) Unwrap() []error {
	if e.permanent {
		return []error{ErrNotBoundInChannel, ErrTaskFactUndeliverable}
	}
	return []error{ErrNotBoundInChannel}
}

// noticeNotBound posts notBoundHint once in the session's channel, so the user sees it even
// when the primary role does not relay the command error. Repeats for the same channel and
// project stay quiet until the bot is seen bound there again (clearNotBound).
func (e *Engine) noticeNotBound(sessionKey, project string) {
	if e == nil || project == "" {
		return
	}
	key := notBoundKey(sessionKey, project)
	if _, seen := e.notBoundNoticed.LoadOrStore(key, struct{}{}); seen {
		return
	}
	go e.noticeChannel(sessionKey, notBoundHint(project))
}

// noteBound is noticeNotBound (bound=false) or clearNotBound (bound=true).
func (e *Engine) noteBound(sessionKey, project string, bound bool) {
	if bound {
		e.clearNotBound(sessionKey, project)
	} else {
		e.noticeNotBound(sessionKey, project)
	}
}

func (e *Engine) clearNotBound(sessionKey, project string) {
	if e != nil {
		e.notBoundNoticed.Delete(notBoundKey(sessionKey, project))
	}
}

func notBoundKey(sessionKey, project string) string {
	if plat, chat, err := parseSessionKeyParts(sessionKey); err == nil {
		return plat + ":" + chat + "|" + project
	}
	return sessionKey + "|" + project
}

// noticeChannel sends text to the channel of sessionKey on its platform (like relay's group
// visibility messages); errors are only logged by the caller's platform.
func (e *Engine) noticeChannel(sessionKey, text string) {
	plat, _, _ := strings.Cut(sessionKey, ":")
	for _, p := range e.platforms {
		if p.Name() != plat {
			continue
		}
		rc, ok := p.(ReplyContextReconstructor)
		if !ok {
			return
		}
		rctx, err := rc.ReconstructReplyCtx(sessionKey)
		if err != nil {
			return
		}
		_ = p.Send(e.ctx, rctx, text)
		return
	}
}
