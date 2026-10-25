package core

import (
	"net/url"
	"strconv"
	"testing"
)

func TestDiscordInvitePermissionsBits(t *testing.T) {
	for _, b := range []struct {
		name string
		bit  uint
	}{
		{"View Channels", 10}, {"Send Messages", 11}, {"Read Message History", 16},
		{"Embed Links", 14}, {"Attach Files", 15}, {"Add Reactions", 6},
		{"Manage Channels", 4}, {"Manage Messages", 13}, {"Use Application Commands", 31},
		{"Manage Threads", 34}, {"Create Public Threads", 35}, {"Send Messages in Threads", 38},
	} {
		if DiscordInvitePermissions&(int64(1)<<b.bit) == 0 {
			t.Errorf("DiscordInvitePermissions lacks %s (1<<%d)", b.name, b.bit)
		}
	}
	u, err := url.Parse(DiscordInviteURL("123", ""))
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Query().Get("permissions"); got != strconv.FormatInt(DiscordInvitePermissions, 10) {
		t.Fatalf("invite permissions = %s, want %d", got, DiscordInvitePermissions)
	}
}
