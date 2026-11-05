package core

import (
	"bytes"
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
	"time"
)

// OriginatorClaims identifies the platform event that owns the running turn.
// Content is deliberately absent: message text is not an authorization source.
type OriginatorClaims struct {
	Version   int    `json:"version"`
	Platform  string `json:"platform"`
	UserID    string `json:"user_id"`
	Project   string `json:"project"`
	Session   string `json:"session"`
	Action    string `json:"action"`
	MessageID string `json:"message_id"`
	Nonce     string `json:"nonce"`
	IssuedAt  string `json:"issued_at"`
	ExpiresAt string `json:"expires_at"`
}

type OriginatorTicket struct {
	Claims    OriginatorClaims `json:"claims"`
	KeyID     string           `json:"key_id"`
	PublicKey string           `json:"public_key"`
	Signature string           `json:"signature"`
}

type originatorRequest struct {
	Project   string `json:"project"`
	Session   string `json:"session"`
	Action    string `json:"action"`
	ExpiresAt string `json:"expires_at"`
}

type OriginatorSigner struct {
	privateKey ed25519.PrivateKey
}

type originatorGrant struct {
	platform  string
	userID    string
	messageID string
}

// OriginatorClaimsJSON is the canonical, cross-language signing payload.
// Gateway verification must use exactly these bytes, not re-marshal a map.
//
// json.Marshal escapes HTML (& < >) by default, which Python's json.dumps does
// not: a user_id of "a&b" would sign as "a&b" here and as "a&b" there, and
// the gateway's signature check would fail. SetEscapeHTML(false) makes the bytes
// match. The encoder appends a newline, so it is trimmed.
func OriginatorClaimsJSON(claims OriginatorClaims) ([]byte, error) {
	if claims.Version != 1 || claims.Platform == "" || claims.UserID == "" || claims.Project == "" ||
		claims.Session == "" || claims.Action == "" || claims.Nonce == "" || claims.IssuedAt == "" || claims.ExpiresAt == "" {
		return nil, errors.New("originator claims are incomplete or unsupported")
	}
	if _, err := time.Parse(time.RFC3339Nano, claims.IssuedAt); err != nil {
		return nil, fmt.Errorf("issued_at must be RFC3339: %w", err)
	}
	if _, err := time.Parse(time.RFC3339Nano, claims.ExpiresAt); err != nil {
		return nil, fmt.Errorf("expires_at must be RFC3339: %w", err)
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(claims); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// NewOriginatorSigner loads the bridge-private key, creating it on first use.
// OS separation between the bridge and agents is a deployment requirement; a
// same-uid agent can read this file and must not be described as isolated.
func NewOriginatorSigner(dataDir string) (*OriginatorSigner, error) {
	if dataDir == "" {
		return nil, errors.New("originator signing requires a data directory")
	}
	dir := filepath.Join(dataDir, "originator")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create originator key directory: %w", err)
	}
	path := filepath.Join(dir, "ed25519.key")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		// First use: generate a seed and create the file exclusively, so a
		// concurrent bridge cannot silently share or overwrite the key.
		_, privateKey, generateErr := ed25519.GenerateKey(rand.Reader)
		if generateErr != nil {
			return nil, fmt.Errorf("generate originator key: %w", generateErr)
		}
		f, createErr := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if createErr != nil {
			return nil, fmt.Errorf("create originator private key: %w", createErr)
		}
		if _, writeErr := f.Write(privateKey.Seed()); writeErr != nil {
			_ = f.Close()
			return nil, fmt.Errorf("write originator private key: %w", writeErr)
		}
		if closeErr := f.Close(); closeErr != nil {
			return nil, fmt.Errorf("close originator private key: %w", closeErr)
		}
		return &OriginatorSigner{privateKey: privateKey}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("inspect originator private key: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("originator private key must be a regular file")
	}
	if info.Mode().Perm() != 0o600 {
		if err := os.Chmod(path, 0o600); err != nil {
			return nil, fmt.Errorf("restrict originator private key permissions: %w", err)
		}
	}
	seed, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read originator private key: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("originator private key has invalid length")
	}
	return &OriginatorSigner{privateKey: ed25519.NewKeyFromSeed(seed)}, nil
}

// VerifyOriginatorTicket verifies the configured bridge key, canonical claims,
// signature and caller-supplied time. It does not apply an implicit time window.
func VerifyOriginatorTicket(ticket OriginatorTicket, trustedPublicKey ed25519.PublicKey, now time.Time) error {
	publicKey, err := base64.StdEncoding.DecodeString(ticket.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("invalid originator public key")
	}
	fingerprint := sha256.Sum256(publicKey)
	if ticket.KeyID != hex.EncodeToString(fingerprint[:]) || !ed25519.PublicKey(publicKey).Equal(trustedPublicKey) {
		return errors.New("untrusted originator public key")
	}
	payload, err := OriginatorClaimsJSON(ticket.Claims)
	if err != nil {
		return err
	}
	signature, err := base64.StdEncoding.DecodeString(ticket.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return errors.New("invalid originator signature encoding")
	}
	if !ed25519.Verify(publicKey, payload, signature) {
		return errors.New("invalid originator signature")
	}
	issuedAt, _ := time.Parse(time.RFC3339Nano, ticket.Claims.IssuedAt)
	expiresAt, _ := time.Parse(time.RFC3339Nano, ticket.Claims.ExpiresAt)
	if now.Before(issuedAt) {
		return errors.New("originator ticket is not yet valid")
	}
	if !now.Before(expiresAt) {
		return errors.New("originator ticket has expired")
	}
	return nil
}

// originatorGrantFor is the grant one turn may claim, given who its message came
// from. A bot message, a scheduled turn (cron/timer/heartbeat/handoff) and a turn
// with no platform identity have no human originator, so they claim none.
func originatorGrantFor(fromBot bool, platform, userID, messageID, trigger string) (originatorGrant, bool) {
	if fromBot || platform == "" || userID == "" || trigger != TurnTriggerUser || scheduledTurnUser(userID) {
		return originatorGrant{}, false
	}
	return originatorGrant{platform: platform, userID: userID, messageID: messageID}, true
}

// originatorGrantForQueued is originatorGrantFor for a queued turn. A merged batch
// (several instructions folded into one turn) has no single human originator
// either. The batch marker is a structured field set by the merge helpers
// (queue_batch.go), not a match on the merged prompt's wording.
func originatorGrantForQueued(q queuedMessage) (originatorGrant, bool) {
	if q.batched {
		return originatorGrant{}, false
	}
	return originatorGrantFor(q.fromBot, q.msgPlatform, q.userID, q.messageID, queuedTurnTrigger(&q))
}

func (e *Engine) getOriginatorSigner() (*OriginatorSigner, error) {
	e.originatorSignerOnce.Do(func() {
		e.originatorSignerValue, e.originatorSignerErr = NewOriginatorSigner(e.dataDir)
	})
	return e.originatorSignerValue, e.originatorSignerErr
}

func (e *Engine) signOriginator(req originatorRequest) (OriginatorTicket, error) {
	if req.Project != e.name || req.Session == "" {
		return OriginatorTicket{}, errors.New("originator project or session does not match the caller")
	}
	// The turn records its grant under the message's own session key — the one
	// CC_SESSION_KEY carries and a signing request names. Not the interactive key:
	// in workspace mode that is "<workspace>:<session>", which a request cannot
	// name (2026-11-05 review, item 1).
	grantValue, ok := e.originatorTurns.Load(req.Session)
	if !ok {
		return OriginatorTicket{}, errors.New("no active platform originator for this session")
	}
	grant := grantValue.(originatorGrant)
	if req.Action == "" || req.ExpiresAt == "" {
		return OriginatorTicket{}, errors.New("action and expires_at are required")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, req.ExpiresAt)
	if err != nil {
		return OriginatorTicket{}, fmt.Errorf("expires_at must be RFC3339: %w", err)
	}
	now := time.Now().UTC()
	if !expiresAt.After(now) {
		return OriginatorTicket{}, errors.New("expires_at must be in the future")
	}
	signer, err := e.getOriginatorSigner()
	if err != nil {
		return OriginatorTicket{}, err
	}
	nonce := make([]byte, 32) // Ed25519 generates 256-bit keys; use a fresh 256-bit replay identifier.
	if _, err := rand.Read(nonce); err != nil {
		return OriginatorTicket{}, fmt.Errorf("generate originator nonce: %w", err)
	}
	claims := OriginatorClaims{
		Version: 1, Platform: grant.platform, UserID: grant.userID, Project: e.name,
		Session: req.Session, Action: req.Action, MessageID: grant.messageID,
		Nonce: base64.RawURLEncoding.EncodeToString(nonce), IssuedAt: now.Format(time.RFC3339Nano), ExpiresAt: expiresAt.Format(time.RFC3339Nano),
	}
	payload, err := OriginatorClaimsJSON(claims)
	if err != nil {
		return OriginatorTicket{}, err
	}
	publicKey := signer.privateKey.Public().(ed25519.PublicKey)
	fingerprint := sha256.Sum256(publicKey)
	return OriginatorTicket{
		Claims: claims, KeyID: hex.EncodeToString(fingerprint[:]),
		PublicKey: base64.StdEncoding.EncodeToString(publicKey),
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(signer.privateKey, payload)),
	}, nil
}
