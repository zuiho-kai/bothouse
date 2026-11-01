package claudecode

import (
	"errors"
	"sync"
	"testing"
)

// quotaFixture replaces the CLI query and the credential stamp, and resets the
// cache. The returned stamp pointer lets a test simulate the CLI rewriting the
// stored credentials.
func quotaFixture(t *testing.T) *int64 {
	t.Helper()
	oldAuth, oldStamp := readAuthStatus, credentialStamp
	stamp := int64(100)
	credentialStamp = func(string) int64 { return stamp }
	accountCache = sync.Map{}
	t.Cleanup(func() {
		readAuthStatus, credentialStamp = oldAuth, oldStamp
		accountCache = sync.Map{}
	})
	return &stamp
}

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

// TestQuotaScope_SameDirectoryAccountSwitchChangesIdentity is the reported bug:
// the user swapped the Claude account and stayed blocked by the old account's
// cooldown because only the config directory identified the account.
func TestQuotaScope_SameDirectoryAccountSwitchChangesIdentity(t *testing.T) {
	stamp := quotaFixture(t)
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	a := &Agent{activeIdx: -1}

	first := authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "first@example.com", OrgID: "org-first"}
	readAuthStatus = func() (authStatus, error) { return first, nil }
	scopeA, _ := a.QuotaScope("")

	*stamp++ // the CLI rewrote the stored credentials
	second := first
	second.Email, second.OrgID = "second@example.com", "org-second"
	readAuthStatus = func() (authStatus, error) { return second, nil }
	scopeB, _ := a.QuotaScope("")

	if scopeA == scopeB {
		t.Fatal("swapping the account in the same directory kept the old quota identity")
	}

	*stamp++
	readAuthStatus = func() (authStatus, error) { return first, nil }
	if back, _ := a.QuotaScope(""); back != scopeA {
		t.Fatal("switching back to the first account did not restore its own identity")
	}
}

// TestQuotaScope_SameAccountDifferentDirectorySharesIdentity guards the pool
// split: pointing the CLI at another config directory does not create a second
// allowance for the same account, so an old cooldown still applies.
func TestQuotaScope_SameAccountDifferentDirectorySharesIdentity(t *testing.T) {
	quotaFixture(t)
	readAuthStatus = func() (authStatus, error) {
		return authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "same@example.com", OrgID: "org-same"}, nil
	}
	t.Setenv("HOME", t.TempDir())
	a := &Agent{activeIdx: -1}

	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	first, _ := a.QuotaScope("")
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	second, _ := a.QuotaScope("")
	if first != second {
		t.Fatal("the same account was split into two allowances by its config directory")
	}
}

// TestQuotaScope_CachedAccountIsRefreshedOnRelogin covers the missed cache: an
// account switch must be noticed even though an entry already exists.
func TestQuotaScope_CachedAccountIsRefreshedOnRelogin(t *testing.T) {
	stamp := quotaFixture(t)
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	a := &Agent{activeIdx: -1}
	queries := 0
	readAuthStatus = func() (authStatus, error) {
		queries++
		return authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "a@example.com", OrgID: "org-a"}, nil
	}
	before, _ := a.QuotaScope("")
	a.QuotaScope("")
	if queries != 1 {
		t.Fatalf("auth status ran %d times for an unchanged account, want 1", queries)
	}

	*stamp++
	readAuthStatus = func() (authStatus, error) {
		queries++
		return authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "b@example.com", OrgID: "org-b"}, nil
	}
	after, _ := a.QuotaScope("")
	if queries != 2 {
		t.Fatalf("a cached entry hid the new login: auth status ran %d times, want 2", queries)
	}
	if after == before {
		t.Fatal("a cached entry kept the previous account after the user logged in again")
	}
}

// TestQuotaScope_UnknownStampIsNotCached keeps the cache honest when the CLI's
// credential store cannot be located at all: a stale entry must not survive.
func TestQuotaScope_UnknownStampIsNotCached(t *testing.T) {
	quotaFixture(t)
	credentialStamp = func(string) int64 { return 0 }
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	a := &Agent{activeIdx: -1}
	queries := 0
	readAuthStatus = func() (authStatus, error) {
		queries++
		return authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "a@example.com", OrgID: "org-a"}, nil
	}
	a.QuotaScope("")
	readAuthStatus = func() (authStatus, error) {
		queries++
		return authStatus{LoggedIn: true, ApiProvider: "firstParty", Email: "b@example.com", OrgID: "org-b"}, nil
	}
	a.QuotaScope("")
	if queries != 2 {
		t.Fatal("an unstamped account was cached, so a later switch could never be seen")
	}
}

// TestQuotaScope_AuthQueryFailureDoesNotFabricateIdentity keeps a failed query
// conservative: it must not mint a new bucket that would bypass a cooldown.
func TestQuotaScope_AuthQueryFailureDoesNotFabricateIdentity(t *testing.T) {
	quotaFixture(t)
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	a := &Agent{activeIdx: -1}

	readAuthStatus = func() (authStatus, error) { return authStatus{}, errors.New("cli missing") }
	failed, _ := a.QuotaScope("")
	stillFailed, _ := a.QuotaScope("")
	if failed != stillFailed {
		t.Fatal("a failing auth query minted a new identity on every call")
	}

	// Logged out reports no account either: the same conservative bucket.
	readAuthStatus = func() (authStatus, error) {
		return authStatus{LoggedIn: false, Email: "leaked@example.com"}, nil
	}
	loggedOut, _ := a.QuotaScope("")
	if loggedOut != failed {
		t.Fatal("logged-out state was treated as a distinct account")
	}
}
