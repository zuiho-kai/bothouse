package core

import (
	"fmt"
	"strings"
)

// dmUser is the person `bothouse send --dm` writes to: the first explicit ID in
// admin_from, the project owner already configured there (maomao fork; user 2026-10-23
// 「平时你们有什么想跟我悄悄说的，也能私信我」). No new config key; "*" names no one.
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

// OpenDMSession opens (or reuses) the private chat between this bot and the user named by
// admin_from on the first platform that supports it, and returns its session key. Sending to
// that key then goes through the normal send path (ReconstructReplyCtx), and the user's reply
// in the chat lands in the same session.
func (e *Engine) OpenDMSession() (string, error) {
	user := e.dmUser()
	if user == "" {
		return "", fmt.Errorf("--dm: admin_from has no user ID to message")
	}
	for _, p := range e.platforms {
		if o, ok := p.(DirectMessageOpener); ok {
			return o.OpenDM(user)
		}
	}
	return "", fmt.Errorf("--dm: no platform in this project can open a private chat")
}
