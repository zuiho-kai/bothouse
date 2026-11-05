package config

import "testing"

func TestInjectSenderEnabledDefaults(t *testing.T) {
	on, off := true, false
	pl := func(opts map[string]any) []PlatformConfig { return []PlatformConfig{{Type: "discord", Options: opts}} }
	cases := []struct {
		name string
		p    ProjectConfig
		want bool
	}{
		{"single user", ProjectConfig{Platforms: pl(map[string]any{"allow_from": "123"})}, false},
		{"allow all", ProjectConfig{Platforms: pl(map[string]any{"allow_from": "*"})}, true},
		{"shared session", ProjectConfig{Platforms: pl(map[string]any{"share_session_in_channel": true})}, true},
		{"explicit off wins", ProjectConfig{InjectSender: &off, Platforms: pl(map[string]any{"allow_from": "*"})}, false},
		{"explicit on", ProjectConfig{InjectSender: &on}, true},
		{"disabled platform", ProjectConfig{Platforms: []PlatformConfig{{Type: "discord", Disabled: true, Options: map[string]any{"allow_from": "*"}}}}, false},
	}
	for _, c := range cases {
		if got := c.p.InjectSenderEnabled(); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
