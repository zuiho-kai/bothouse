package main

import "testing"

func TestTrayVisibilityByInstance(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		env  map[string]string
		home string
		want bool
	}{
		{name: "installed desktop", home: "/users/me", want: true},
		{name: "isolated HOME", home: "/tmp/preview/home"},
		{name: "selfhost_mainpath", home: "/tmp/mainpath/home", env: map[string]string{"DSH_HOME": "/tmp/mainpath/home/.dsh"}},
		{name: "explicit off", home: "/users/me", env: map[string]string{"BOTHOUSE_TRAY": "off"}},
		{name: "explicit on isolated", home: "/tmp/preview/home", env: map[string]string{"BOTHOUSE_TRAY": "on"}, want: true},
		{name: "legacy no tray", home: "/users/me", env: map[string]string{"BOTHOUSE_NO_TRAY": "1"}},
		{name: "headless", home: "/users/me", args: []string{"--headless"}},
		{name: "headless beats on", home: "/users/me", args: []string{"--headless=true"}, env: map[string]string{"BOTHOUSE_TRAY": "on"}},
		{name: "ssh", home: "/users/me", env: map[string]string{"SSH_CONNECTION": "client server"}},
		{name: "ssh tty", home: "/users/me", env: map[string]string{"SSH_TTY": "/dev/ttys1"}},
		{name: "subcommand beats on", home: "/users/me", args: []string{"version"}, env: map[string]string{"BOTHOUSE_TRAY": "on"}},
		{name: "help", home: "/users/me", args: []string{"--help"}},
		{name: "unknown account home", home: "/tmp/preview"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			account := "/users/me"
			if tc.name == "unknown account home" {
				account = ""
			}
			got := trayEnabledForInstance(tc.args, func(k string) string { return tc.env[k] }, tc.home, account)
			if got != tc.want {
				t.Fatalf("tray enabled = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestParseRootCLIHeadless(t *testing.T) {
	if _, err := parseRootCLIOptions([]string{"--headless"}); err != nil {
		t.Fatal(err)
	}
}
