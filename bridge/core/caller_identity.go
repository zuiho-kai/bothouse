package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Caller identity: the bridge is the only party that knows which platform user started a turn (the
// model only sees text, which anyone can type). For every turn it records that sender and, on request
// from a tool inside the turn, issues a short-lived token signed with the bridge's own Ed25519 key.
// A guard (`bothouse guard`, or any other program holding only the public key) verifies the token and
// decides what the caller may do. Self-reported identity in the prompt never counts.
//
// The key is protected only as far as the OS protects it: when the bridge and the role processes share
// one system account the model can read the key file. See docs/caller-identity.md for the split setup.

const (
	callerTokenPrefix = "bh1"
	// CallerTokenTTL bounds how long a fetched token can be replayed (e.g. kept by the model from one
	// user's turn into another's). Short: a tool fetches a fresh one right before each call.
	CallerTokenTTL = 5 * time.Minute
	// callerTurnMaxAge: a turn record older than this is not trusted even if its end was never seen.
	callerTurnMaxAge = 6 * time.Hour
	// callerClockSkew tolerates a guard host whose clock is slightly behind the bridge.
	callerClockSkew = 60 * time.Second
)

// Caller kinds. Only CallerHuman is a real platform user; the reference guard refuses the rest unless
// the policy lists them.
const (
	CallerHuman     = "human"     // a platform message from a person
	CallerBot       = "bot"       // a teammate bot / relay
	CallerScheduled = "scheduled" // cron, timer, heartbeat, workspace hand-off wake-up
	CallerLocal     = "local"     // the local input API (no platform sender)
)

// CallerClaims is the signed content of a caller token.
type CallerClaims struct {
	V        int    `json:"v"`
	KeyID    string `json:"kid"`
	Project  string `json:"project"`
	Platform string `json:"platform"`
	UserID   string `json:"user_id"`
	UserName string `json:"user_name,omitempty"`
	ChatID   string `json:"chat_id,omitempty"`
	Session  string `json:"session"`
	Kind     string `json:"kind"`
	Turn     string `json:"turn"`
	TurnAt   int64  `json:"turn_at"` // unix seconds the turn started
	Iat      int64  `json:"iat"`
	Exp      int64  `json:"exp"`
	Nonce    string `json:"nonce"`
}

// callerTurn is what the bridge remembers about the turn running in a session.
type callerTurn struct {
	platform, userID, userName, chatID, kind, turn string
	at                                             time.Time
}

// IdentityKeyPaths returns the private and public key files under dataDir.
func IdentityKeyPaths(dataDir string) (priv, pub string) {
	dir := filepath.Join(dataDir, "identity")
	return filepath.Join(dir, "signing.key"), filepath.Join(dir, "signing.pub")
}

// LoadOrCreateIdentityKey reads the bridge signing key, creating it (0600) on first use, and keeps the
// public half next to it (0644) so admins can copy it to guard hosts.
func LoadOrCreateIdentityKey(dataDir string) (ed25519.PrivateKey, error) {
	if dataDir == "" {
		return nil, errors.New("no data dir")
	}
	privPath, pubPath := IdentityKeyPaths(dataDir)
	if b, err := os.ReadFile(privPath); err == nil {
		seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b)))
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("bad signing key %s", privPath)
		}
		k := ed25519.NewKeyFromSeed(seed)
		if _, err := os.Stat(pubPath); err != nil {
			_ = os.WriteFile(pubPath, []byte(FormatIdentityPubKey(k.Public().(ed25519.PublicKey))+"\n"), 0o644)
		}
		return k, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(privPath), 0o700); err != nil {
		return nil, err
	}
	pub, k, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(privPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) { // another process won the race
			return LoadOrCreateIdentityKey(dataDir)
		}
		return nil, err
	}
	_, werr := f.WriteString(base64.StdEncoding.EncodeToString(k.Seed()) + "\n")
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return nil, werr
	}
	if err := os.WriteFile(pubPath, []byte(FormatIdentityPubKey(pub)+"\n"), 0o644); err != nil {
		return nil, err
	}
	return k, nil
}

// FormatIdentityPubKey is the one-line public key format: "bothouse-ed25519 <base64>".
func FormatIdentityPubKey(pub ed25519.PublicKey) string {
	return "bothouse-ed25519 " + base64.StdEncoding.EncodeToString(pub)
}

// ParseIdentityPubKey accepts the line written by FormatIdentityPubKey (or the bare base64).
func ParseIdentityPubKey(s string) (ed25519.PublicKey, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimSpace(strings.TrimPrefix(s, "bothouse-ed25519"))
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != ed25519.PublicKeySize {
		return nil, errors.New("not a bothouse ed25519 public key")
	}
	return ed25519.PublicKey(b), nil
}

// IdentityKeyID is a short fingerprint of a public key, carried in tokens so a guard trusting several
// bridges can tell them apart in its log.
func IdentityKeyID(pub ed25519.PublicKey) string {
	h := sha256.Sum256(pub)
	return hex.EncodeToString(h[:8])
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// SignCallerClaims encodes and signs claims: "bh1.<base64url json>.<base64url sig>".
func SignCallerClaims(k ed25519.PrivateKey, c CallerClaims) (string, error) {
	body, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	payload := callerTokenPrefix + "." + base64.RawURLEncoding.EncodeToString(body)
	sig := ed25519.Sign(k, []byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// VerifyCallerToken checks the signature against any of the trusted keys and the time window.
func VerifyCallerToken(token string, keys []ed25519.PublicKey, now time.Time) (CallerClaims, error) {
	var c CallerClaims
	token = strings.TrimSpace(token)
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != callerTokenPrefix {
		return c, errors.New("not a bothouse caller token")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return c, errors.New("bad token signature encoding")
	}
	signed := []byte(parts[0] + "." + parts[1])
	ok := false
	for _, k := range keys {
		if len(k) == ed25519.PublicKeySize && ed25519.Verify(k, signed, sig) {
			ok = true
			break
		}
	}
	if !ok {
		return c, errors.New("signature does not match any trusted bridge key")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return c, errors.New("bad token payload encoding")
	}
	if err := json.Unmarshal(body, &c); err != nil {
		return c, errors.New("bad token payload")
	}
	if c.V != 1 {
		return c, fmt.Errorf("unsupported token version %d", c.V)
	}
	t := now.Unix()
	if c.Iat > t+int64(callerClockSkew/time.Second) {
		return c, errors.New("token issued in the future (check clocks)")
	}
	if t > c.Exp+int64(callerClockSkew/time.Second) {
		return c, fmt.Errorf("token expired %ds ago; fetch a fresh one for each call", t-c.Exp)
	}
	return c, nil
}

// callerKindOf classifies a turn's sender from what the engine knows about the message.
func callerKindOf(userID string, fromBot, scheduled, local bool) string {
	switch {
	case scheduled || scheduledTurnUser(userID) || userID == "handoff":
		return CallerScheduled
	case local:
		return CallerLocal
	case fromBot:
		return CallerBot
	case userID == "":
		return CallerLocal
	}
	return CallerHuman
}

// noteCallerTurn records who started the turn now being sent in session. Called at every send point
// (direct, queued, chained queued), next to withPublicProgress.
func (e *Engine) noteCallerTurn(session, platform, userID, userName, channelKey string, fromBot, scheduled, local bool) {
	if session == "" {
		return
	}
	chat := channelKey
	if chat == "" {
		chat = extractChannelID(session)
	}
	t := callerTurn{platform: platform, userID: userID, userName: userName, chatID: chat,
		kind: callerKindOf(userID, fromBot, scheduled, local), turn: randomHex(8), at: time.Now()}
	e.callerMu.Lock()
	if e.callerTurns == nil {
		e.callerTurns = map[string]callerTurn{}
	}
	e.callerTurns[session] = t
	e.callerMu.Unlock()
}

// callerTurnOf returns who started the turn running in session now, if one is recorded and fresh.
func (e *Engine) callerTurnOf(session string) (callerTurn, bool) {
	if session == "" {
		return callerTurn{}, false
	}
	e.callerMu.Lock()
	t, ok := e.callerTurns[session]
	e.callerMu.Unlock()
	if !ok || time.Since(t.at) > callerTurnMaxAge {
		return callerTurn{}, false
	}
	return t, true
}

// endCallerTurn forgets the session's sender once its turn (and its queue) has finished: a tool run
// later, outside any turn, gets no token.
func (e *Engine) endCallerTurn(session string) {
	e.callerMu.Lock()
	delete(e.callerTurns, session)
	e.callerMu.Unlock()
}

// IssueCallerToken signs a token for the turn running in session now.
func (e *Engine) IssueCallerToken(session string, now time.Time) (string, CallerClaims, error) {
	var c CallerClaims
	e.callerMu.Lock()
	t, ok := e.callerTurns[session]
	e.callerMu.Unlock()
	if !ok || now.Sub(t.at) > callerTurnMaxAge {
		return "", c, fmt.Errorf("session %s has no turn running now; caller tokens are issued only inside a turn", session)
	}
	k, err := LoadOrCreateIdentityKey(e.dataDir)
	if err != nil {
		return "", c, fmt.Errorf("signing key: %w", err)
	}
	c = CallerClaims{V: 1, KeyID: IdentityKeyID(k.Public().(ed25519.PublicKey)), Project: e.name,
		Platform: t.platform, UserID: t.userID, UserName: t.userName, ChatID: t.chatID, Session: session,
		Kind: t.kind, Turn: t.turn, TurnAt: t.at.Unix(), Iat: now.Unix(), Exp: now.Add(CallerTokenTTL).Unix(),
		Nonce: randomHex(8)}
	tok, err := SignCallerClaims(k, c)
	return tok, c, err
}
