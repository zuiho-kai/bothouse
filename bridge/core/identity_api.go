package core

import (
	"crypto/ed25519"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// The identity socket (<dataDir>/run/identity.sock) serves only caller tokens and the public key. It
// is separate from api.sock (0600, full control of the bridge) and world-connectable (0666) so a role
// running under its own system account can fetch the token of its own turn without being able to send
// messages, switch models or read the signing key. Directories above it must allow traversal.

// IdentitySocketPath is the identity socket under dataDir.
func IdentitySocketPath(dataDir string) string {
	return filepath.Join(dataDir, "run", "identity.sock")
}

func (s *APIServer) startIdentitySocket() {
	if s.dataDir == "" {
		return
	}
	path := IdentitySocketPath(s.dataDir)
	os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		slog.Warn("identity socket unavailable", "error", err)
		return
	}
	if err := os.Chmod(path, 0o666); err != nil {
		slog.Warn("identity socket chmod", "error", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/identity/token", s.handleIdentityToken)
	mux.HandleFunc("/identity/pubkey", s.handleIdentityPubKey)
	s.identityLn = ln
	s.identitySrv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := s.identitySrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			slog.Error("identity socket error", "error", err)
		}
	}()
}

func (s *APIServer) stopIdentitySocket() {
	if s.identitySrv != nil {
		_ = s.identitySrv.Close()
		os.Remove(IdentitySocketPath(s.dataDir))
	}
}

// handleIdentityToken: GET /identity/token?project=&session= → {"token": ..., "claims": {...}}.
func (s *APIServer) handleIdentityToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	project, session := q.Get("project"), q.Get("session")
	if project == "" || session == "" {
		inputHTTPError(w, 400, errors.New("project and session required (CC_PROJECT / CC_SESSION_KEY)"))
		return
	}
	s.mu.RLock()
	e := s.engines[project]
	s.mu.RUnlock()
	if e == nil {
		inputHTTPError(w, 404, errors.New("no such project: "+project))
		return
	}
	tok, c, err := e.IssueCallerToken(session, time.Now())
	if err != nil {
		inputHTTPError(w, 409, err)
		return
	}
	apiJSON(w, 200, map[string]any{"token": tok, "claims": c})
}

// handleIdentityPubKey: GET /identity/pubkey → {"pubkey": "bothouse-ed25519 ...", "kid": ...}.
func (s *APIServer) handleIdentityPubKey(w http.ResponseWriter, r *http.Request) {
	k, err := LoadOrCreateIdentityKey(s.dataDir)
	if err != nil {
		inputHTTPError(w, 500, err)
		return
	}
	pub := k.Public().(ed25519.PublicKey)
	apiJSON(w, 200, map[string]string{"pubkey": FormatIdentityPubKey(pub), "kid": IdentityKeyID(pub)})
}
