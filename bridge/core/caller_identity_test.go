package core

import (
	"crypto/ed25519"
	"strings"
	"testing"
	"time"
)

func TestCallerTokenIssueAndVerify(t *testing.T) {
	e := &Engine{name: "bot", dataDir: t.TempDir()}
	now := time.Now()
	if _, _, err := e.IssueCallerToken("discord:c1", now); err == nil {
		t.Fatal("token issued with no turn running")
	}
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	tok, c, err := e.IssueCallerToken("discord:c1", now)
	if err != nil {
		t.Fatal(err)
	}
	if c.Kind != CallerHuman || c.UserID != "u-alice" || c.Project != "bot" || c.ChatID != "c1" {
		t.Fatalf("claims %+v", c)
	}
	k, _ := LoadOrCreateIdentityKey(e.dataDir)
	pub := k.Public().(ed25519.PublicKey)
	got, err := VerifyCallerToken(tok, []ed25519.PublicKey{pub}, now)
	if err != nil || got.UserID != "u-alice" {
		t.Fatalf("verify: %v %+v", err, got)
	}
	if _, err := VerifyCallerToken(tok, []ed25519.PublicKey{pub}, now.Add(CallerTokenTTL+2*callerClockSkew)); err == nil {
		t.Fatal("expired token accepted")
	}
	other, _, _ := ed25519.GenerateKey(nil)
	if _, err := VerifyCallerToken(tok, []ed25519.PublicKey{other}, now); err == nil {
		t.Fatal("foreign key accepted")
	}
	// tampering with the payload (claiming another user) breaks the signature
	parts := strings.Split(tok, ".")
	forged, _ := SignCallerClaims(ed25519.NewKeyFromSeed(make([]byte, 32)), CallerClaims{V: 1, UserID: "u-bob", Exp: now.Add(time.Minute).Unix()})
	fp := strings.Split(forged, ".")
	if _, err := VerifyCallerToken(parts[0]+"."+fp[1]+"."+parts[2], []ed25519.PublicKey{pub}, now); err == nil {
		t.Fatal("tampered payload accepted")
	}
	e.endCallerTurn("discord:c1")
	if _, _, err := e.IssueCallerToken("discord:c1", now); err == nil {
		t.Fatal("token issued after the turn ended")
	}
}

func TestCallerKind(t *testing.T) {
	for _, c := range []struct {
		user              string
		bot, sched, local bool
		want              string
	}{
		{"u1", false, false, false, CallerHuman},
		{"u1", true, false, false, CallerBot},
		{"cron", false, false, false, CallerScheduled},
		{"handoff", false, false, false, CallerScheduled},
		{"u1", false, true, false, CallerScheduled},
		{"u1", false, false, true, CallerLocal},
		{"", false, false, false, CallerLocal},
	} {
		if got := callerKindOf(c.user, c.bot, c.sched, c.local); got != c.want {
			t.Errorf("%+v: got %s", c, got)
		}
	}
}

func TestEndResetTurnEndsCallerTurn(t *testing.T) {
	e := &Engine{name: "bot", dataDir: t.TempDir()}
	e.beginResetTurn("k")
	e.noteCallerTurn("k", "discord", "u1", "", "", false, false, false)
	e.endResetTurn("k")
	if _, _, err := e.IssueCallerToken("k", time.Now()); err == nil {
		t.Fatal("caller turn survived the end of the turn")
	}
}
