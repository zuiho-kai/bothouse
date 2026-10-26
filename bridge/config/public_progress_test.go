package config

import (
	"testing"

	"github.com/BurntSushi/toml"
)

// public_progress: unset = on; false is an explicit opt-out.
func TestPublicProgressEnabledDefaultsOn(t *testing.T) {
	for raw, want := range map[string]bool{
		"":                        true,
		"public_progress = true":  true,
		"public_progress = false": false,
	} {
		var p ProjectConfig
		if _, err := toml.Decode(raw, &p); err != nil {
			t.Fatalf("decode %q: %v", raw, err)
		}
		if got := p.PublicProgressEnabled(); got != want {
			t.Errorf("%q: PublicProgressEnabled() = %v, want %v", raw, got, want)
		}
	}
}

func TestPublicProgressThreadArchiveMinsParses(t *testing.T) {
	for raw, want := range map[string]*int{
		"": nil,
		"public_progress_thread_archive_mins = 60": ptr(60),
		"public_progress_thread_archive_mins = 0":  ptr(0),
	} {
		var p ProjectConfig
		if _, err := toml.Decode(raw, &p); err != nil {
			t.Fatalf("decode %q: %v", raw, err)
		}
		got := p.PublicProgressThreadArchiveMins
		if want == nil {
			if got != nil {
				t.Errorf("%q: got %v, want nil", raw, *got)
			}
			continue
		}
		if got == nil || *got != *want {
			t.Errorf("%q: got %v, want %v", raw, got, *want)
		}
	}
}

func ptr(n int) *int { return &n }
