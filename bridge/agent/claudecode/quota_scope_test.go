package claudecode

import (
	"errors"
	"os"
	"sync"
	"testing"
	"time"
)

func TestQuotaScopeCredentialSource(t *testing.T) {
	a := &Agent{activeIdx: -1, configEnv: []string{"ANTHROPIC_API_KEY=fixture-a"}}
	first, pool := a.QuotaScope("sonnet")
	second, _ := a.QuotaScope("opus")
	if first != second || pool != "account" {
		t.Fatal("model ID incorrectly split account quota")
	}
	a.configEnv = []string{"ANTHROPIC_API_KEY=fixture-b"}
	if other, _ := a.QuotaScope("sonnet"); other == first {
		t.Fatal("different credentials share identity")
	}
	a.spawnOpts.RunAsUser = "fixture-user"
	if user, _ := a.QuotaScope("sonnet"); user != "os-user:fixture-user" {
		t.Fatal("isolated user inherited supervisor credentials")
	}
}

// TestQuotaScope_SameDirectoryAccountSwitchChangesIdentity is the regression for
// the reported gap: the user swapped the Claude account and stayed blocked by the
// old account's cooldown because only the config directory identified the account.
func TestQuotaScope_SameDirectoryAccountSwitchChangesIdentity(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	t.Setenv("HOME", t.TempDir())
	old := readAuthStatus
	accountCache = sync.Map{}
	t.Cleanup(func() { readAuthStatus = old; accountCache = sync.Map{} })
	a := &Agent{activeIdx: -1}

	first := authStatus{LoggedIn: true, AuthMethod: "claude.ai", ApiProvider: "firstParty", Email: "first@example.com", OrgID: "org-first"}
	readAuthStatus = func() (authStatus, error) { return first, nil }
	scopeA, _ := a.QuotaScope("")

	// Same directory, different account: the CLI rewrites its files, so the
	// directory changes too.
	stampDirectory(t, dir)
	second := first
	second.Email = "second@example.com"
	second.OrgID = "org-second"
	readAuthStatus = func() (authStatus, error) { return second, nil }
	scopeB, _ := a.QuotaScope("")

	if scopeA == scopeB {
		t.Fatal("swapping the account in the same directory kept the old quota identity")
	}

	// Switching back must land on the first bucket again, not a third one.
	stampDirectory(t, dir)
	readAuthStatus = func() (authStatus, error) { return first, nil }
	if back, _ := a.QuotaScope(""); back != scopeA {
		t.Fatal("switching back to the first account did not restore its own identity")
	}
}

// TestQuotaScope_TokenRefreshKeepsIdentity guards the other direction: a new
// access token for the same account must not hand out a fresh allowance.
func TestQuotaScope_TokenRefreshKeepsIdentity(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	t.Setenv("HOME", t.TempDir())
	old := readAuthStatus
	accountCache = sync.Map{}
	t.Cleanup(func() { readAuthStatus = old; accountCache = sync.Map{} })
	a := &Agent{activeIdx: -1}

	st := authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "same@example.com", OrgID: "org-same"}
	readAuthStatus = func() (authStatus, error) { return st, nil }
	before, _ := a.QuotaScope("")

	stampDirectory(t, dir) // credentials rewritten by a refresh
	if after, _ := a.QuotaScope(""); after != before {
		t.Fatal("a token refresh for the same account was treated as a new account")
	}
}

// TestQuotaScope_AuthQueryFailureDoesNotFabricateIdentity keeps a failed query
// conservative: it must not mint a new bucket that would bypass a cooldown.
func TestQuotaScope_AuthQueryFailureDoesNotFabricateIdentity(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	t.Setenv("HOME", t.TempDir())
	old := readAuthStatus
	accountCache = sync.Map{}
	t.Cleanup(func() { readAuthStatus = old; accountCache = sync.Map{} })
	a := &Agent{activeIdx: -1}

	readAuthStatus = func() (authStatus, error) { return authStatus{}, errors.New("cli missing") }
	failed, _ := a.QuotaScope("")
	stampDirectory(t, dir)
	stillFailed, _ := a.QuotaScope("")
	if failed != stillFailed {
		t.Fatal("a failing auth query minted a new identity on every call")
	}

	// Logged out reports no account either: same conservative bucket.
	readAuthStatus = func() (authStatus, error) { return authStatus{LoggedIn: false, Email: "leaked@example.com"}, nil }
	stampDirectory(t, dir)
	loggedOut, _ := a.QuotaScope("")
	if loggedOut != failed {
		t.Fatal("logged-out state was treated as a distinct account")
	}
	// The unknown bucket must not be the bare directory, or an old cooldown
	// recorded against the directory would silently transfer.
	if loggedOut == dir {
		t.Fatal("unknown account fell back to the bare config directory")
	}
}

// TestQuotaScope_CachedUntilCredentialsChange checks the query is not launched
// per call, and is re-read when the credentials directory changes.
func TestQuotaScope_CachedUntilCredentialsChange(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	t.Setenv("HOME", t.TempDir())
	old := readAuthStatus
	calls := 0
	readAuthStatus = func() (authStatus, error) {
		calls++
		return authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "c@example.com", OrgID: "o"}, nil
	}
	accountCache = sync.Map{}
	t.Cleanup(func() { readAuthStatus = old; accountCache = sync.Map{} })
	a := &Agent{activeIdx: -1}

	a.QuotaScope("")
	a.QuotaScope("")
	if calls != 1 {
		t.Fatalf("auth status ran %d times for an unchanged account, want 1", calls)
	}
	stampDirectory(t, dir)
	a.QuotaScope("")
	if calls != 2 {
		t.Fatalf("auth status ran %d times after the credentials changed, want 2", calls)
	}
}

// stampDirectory moves the directory mtime forward so a rewrite is visible even
// on filesystems with coarse timestamps.
func stampDirectory(t *testing.T, dir string) {
	t.Helper()
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(dir, future, future); err != nil {
		t.Fatal(err)
	}
}
