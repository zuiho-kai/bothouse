package core

import (
	"regexp"
	"strings"
	"testing"
)

// The default avatar library is the five original pictures (maintainer, 2026-10-23: keep the
// originals, no newly drawn ones); every preset's Avatar is empty or one of them.
func TestPersonaPresetAvatarsInLibrary(t *testing.T) {
	want := []string{"orange", "whale", "dragon", "rainbow", "lanxi"}
	if strings.Join(AvatarLibrary, ",") != strings.Join(want, ",") {
		t.Fatalf("AvatarLibrary = %v, want %v", AvatarLibrary, want)
	}
	for _, lang := range []string{"zh", "en", "ja"} {
		for _, p := range PersonaPresets(lang) {
			if p.Avatar != "" && !IsAvatar(p.Avatar) {
				t.Errorf("%s/%s: avatar %q not in library", lang, p.ID, p.Avatar)
			}
		}
	}
}

// All presets are female (maintainer, 2026-10-23: 「不要男的」).
func TestPersonaPresetsAllFemale(t *testing.T) {
	he := regexp.MustCompile(`(?i)\b(he|his|him|himself)\b`)
	for _, p := range PersonaPresets("zh") {
		s := strings.ReplaceAll(p.Name+p.Intro+p.Text, "其他", "")
		if strings.Contains(s, "他") {
			t.Errorf("zh/%s contains 他", p.ID)
		}
	}
	for _, p := range PersonaPresets("en") {
		if m := he.FindString(p.Name + " " + p.Intro + " " + p.Text); m != "" {
			t.Errorf("en/%s contains %q", p.ID, m)
		}
	}
}
