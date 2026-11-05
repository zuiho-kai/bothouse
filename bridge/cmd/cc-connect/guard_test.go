package main

import (
	"bytes"
	"crypto/ed25519"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func guardFixture(t *testing.T) (dir string, k ed25519.PrivateKey, policy string) {
	t.Helper()
	dir = t.TempDir()
	k, err := core.LoadOrCreateIdentityKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, pub := core.IdentityKeyPaths(dir)
	me, _ := user.Current()
	policy = filepath.Join(dir, "guard.toml")
	body := `trusted_keys = ["` + pub + `"]
audit_log = "` + filepath.Join(dir, "audit.jsonl") + `"
[roles.member]
actions = ["whoami"]
[[users]]
platform = "discord"
user_id = "u-alice"
run_as = "` + me.Username + `"
role = "member"
[actions.whoami]
command = ["echo", "run_as={run_as}"]
`
	if err := os.WriteFile(policy, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir, k, policy
}

func guardToken(t *testing.T, k ed25519.PrivateKey, user, kind string, now time.Time) string {
	t.Helper()
	tok, err := core.SignCallerClaims(k, core.CallerClaims{V: 1, Platform: "discord", UserID: user, Kind: kind,
		Project: "bot", Iat: now.Unix(), Exp: now.Add(core.CallerTokenTTL).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestGuardAllowsMappedUserAndAudits(t *testing.T) {
	dir, k, policy := guardFixture(t)
	now := time.Now()
	var out, errb bytes.Buffer
	code, err := guardCommand([]string{"--policy", policy, "--token", guardToken(t, k, "u-alice", core.CallerHuman, now), "whoami", "x"}, nil, &out, &errb, now)
	if err != nil || code != 0 {
		t.Fatalf("code %d err %v stderr %s", code, err, errb.String())
	}
	me, _ := user.Current()
	if strings.TrimSpace(out.String()) != "run_as="+me.Username+" x" {
		t.Fatalf("out %q", out.String())
	}
	log, _ := os.ReadFile(filepath.Join(dir, "audit.jsonl"))
	if !strings.Contains(string(log), `"decision":"allow"`) || !strings.Contains(string(log), `"decision":"finished"`) || !strings.Contains(string(log), `"user_id":"u-alice"`) {
		t.Fatalf("audit %s", log)
	}
}

func TestGuardDenies(t *testing.T) {
	dir, k, policy := guardFixture(t)
	now := time.Now()
	other := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))
	cases := map[string]string{
		"unknown user": guardToken(t, k, "u-bob", core.CallerHuman, now),
		"bot turn":     guardToken(t, k, "u-alice", core.CallerBot, now),
		"scheduled":    guardToken(t, k, "u-alice", core.CallerScheduled, now),
		"foreign key":  guardToken(t, other, "u-alice", core.CallerHuman, now),
		"expired":      guardToken(t, k, "u-alice", core.CallerHuman, now.Add(-time.Hour)),
		"no token":     "",
		"garbage":      "u-alice",
	}
	for name, tok := range cases {
		t.Setenv("BOTHOUSE_CALLER_TOKEN", "")
		t.Setenv("CC_PROJECT", "")
		var out, errb bytes.Buffer
		code, _ := guardCommand([]string{"--policy", policy, "--token", tok, "whoami"}, nil, &out, &errb, now)
		if code != guardExitDenied || out.Len() != 0 {
			t.Errorf("%s: code %d out %q", name, code, out.String())
		}
	}
	var out, errb bytes.Buffer
	code, _ := guardCommand([]string{"--policy", policy, "--token", guardToken(t, k, "u-alice", core.CallerHuman, now), "rm-rf"}, nil, &out, &errb, now)
	if code != guardExitDenied {
		t.Errorf("action outside role allowed: %d", code)
	}
	log, _ := os.ReadFile(filepath.Join(dir, "audit.jsonl"))
	if n := strings.Count(string(log), `"decision":"deny"`); n != len(cases)+1 {
		t.Errorf("deny lines %d\n%s", n, log)
	}
}
