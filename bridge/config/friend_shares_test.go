package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestFriendSharesStayWithinProjectAndPreservePairingPolicy(t *testing.T) {
	prev := ConfigPath
	ConfigPath = filepath.Join(t.TempDir(), "config.toml")
	t.Cleanup(func() { ConfigPath = prev })
	doc := "# retained owner comment\n[[projects]]\nname='a'\n[projects.users.roles.member]\nuser_ids=['arcade:earlier']\n[[projects]]\nname='b'\n"
	if err := os.WriteFile(ConfigPath, []byte(doc), 0600); err != nil {
		t.Fatal(err)
	}
	for _, number := range []string{"paper", "later", "paper"} {
		if _, err := FriendShares("a", number, true); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := FriendShares("a", "later", false); err != nil {
		t.Fatal(err)
	}
	for project, want := range map[string][]string{"a": {"paper"}, "b": {}} {
		got, err := FriendShares(project, "", false)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: got %v %v", project, got, err)
		}
	}
	saved, err := os.ReadFile(ConfigPath)
	if err != nil || !strings.Contains(string(saved), "# retained owner comment") || !strings.Contains(string(saved), "user_ids=['arcade:earlier']") {
		t.Fatalf("other policy or comment changed")
	}
	if _, err = FriendShares("b", "spare", true); err != nil {
		t.Fatal(err)
	}
	if _, err = FriendShares("b", "spare", false); err != nil {
		t.Fatal(err)
	}
	if err := SaveProjectSettings("a", ProjectSettingsUpdate{}); err != nil {
		t.Fatal(err)
	}
	got, err := FriendShares("a", "", false)
	if err != nil || !reflect.DeepEqual(got, []string{"paper"}) {
		t.Fatalf("other setting write: %v %v", got, err)
	}
}
