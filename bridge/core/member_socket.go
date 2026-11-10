package core

import (
	"crypto/ed25519"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The member socket (<dataDir>/run/member.sock) is the one door a role running under run_as_user can
// use: api.sock is 0600 (bridge account, full control of the bridge) so the role cannot open it, and
// opening it to everyone would let any member's turn drive another member's directory. This socket
// carries nothing but /member, and it asks two things before it runs anything:
//
//  1. who is on the other end (peer uid): the bridge's own account, or the project's run_as_user;
//  2. a caller token signed by this bridge (identity_api.go) naming the same project and session, so
//     the operation belongs to the turn the caller claims to be in.
//
// A role cannot mint that token: it comes from identity.sock, which only signs for a turn that is
// running right now, and the claims say which person started it.

// MemberSocketPath is the member socket under dataDir.
func MemberSocketPath(dataDir string) string {
	return filepath.Join(dataDir, "run", "member.sock")
}

func (s *APIServer) startMemberSocket() {
	if s.dataDir == "" || !memberSocketSupported {
		return
	}
	path := MemberSocketPath(s.dataDir)
	os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		slog.Warn("member socket unavailable", "error", err)
		return
	}
	// Connectable by any local account; every request is checked by peer uid + caller token below.
	if err := os.Chmod(path, 0o666); err != nil {
		slog.Warn("member socket chmod", "error", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/member", s.handleMember)
	s.memberLn = ln
	s.memberSrv = &http.Server{Handler: mux, ConnContext: withPeerConn, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := s.memberSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("member socket error", "error", err)
		}
	}()
}

func (s *APIServer) stopMemberSocket() {
	if s.memberSrv != nil {
		_ = s.memberSrv.Close()
		os.Remove(MemberSocketPath(s.dataDir))
	}
}

// callerTokenFromRequest reads a caller token from the header the CLI uses (X-Bothouse-Caller), or an
// Authorization: Bearer header.
func callerTokenFromRequest(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("X-Bothouse-Caller")); v != "" {
		return v
	}
	if v := strings.TrimSpace(r.Header.Get("Authorization")); v != "" {
		if after, ok := strings.CutPrefix(v, "Bearer "); ok {
			return strings.TrimSpace(after)
		}
	}
	return ""
}

// memberPeerCaller decides whether this request may run a member operation for project req.Project in
// session req.Session, and returns the signed claims when a token was the way in (nil for the bridge's
// own account, whose turn record is trusted as before).
func (s *APIServer) memberPeerCaller(r *http.Request, e *Engine, req MemberRequest) (*CallerClaims, error) {
	if peerIsBridgeAccount(r) {
		// The bridge's own account already holds api.sock; nothing new is granted here.
		return nil, nil
	}
	if !peerIsRunAsUser(r, e.runAsUser()) {
		return nil, errors.New("这个 socket 只给桥和本项目的 run_as_user 用；换个账号来也不行")
	}
	tok := callerTokenFromRequest(r)
	if tok == "" {
		return nil, errors.New("角色账号调用 /member 要带这一轮的凭证：在轮里跑 `bothouse member …`（它会自己取），或先 `bothouse identity token`")
	}
	k, err := LoadOrCreateIdentityKey(s.dataDir)
	if err != nil {
		return nil, err
	}
	c, err := VerifyCallerToken(tok, []ed25519.PublicKey{k.Public().(ed25519.PublicKey)}, time.Now())
	if err != nil {
		return nil, err
	}
	if c.Project != e.name || c.Session != req.Session {
		return nil, errors.New("凭证不是这个项目这一轮的（项目和会话对不上）")
	}
	if c.Kind != CallerHuman {
		return nil, errors.New("这一轮不是真人发起的，不能用成员的目录和 GitHub 授权")
	}
	return &c, nil
}
