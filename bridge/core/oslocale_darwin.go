//go:build darwin

package core

import (
	"os/exec"
	"strings"
	"sync"
)

// osLocaleName returns the macOS user's first preferred language, e.g. "zh-Hans-JP" (AppleLanguages), else the
// region locale (AppleLocale). An app opened from Finder or the Dock (the DSH desktop app that starts bothouse,
// the Bothouse menu-bar app) has no LANG, so without this a Chinese Mac counted as English (#1797).
var osLocaleName = sync.OnceValue(func() string {
	if out, err := exec.Command("/usr/bin/defaults", "read", "-g", "AppleLanguages").Output(); err == nil {
		// "(\n    \"zh-Hans-JP\",\n    \"ja-JP\"\n)"
		for _, line := range strings.Split(string(out), "\n") {
			if l := strings.Trim(strings.TrimSpace(line), "\","); l != "" && l != "(" && l != ")" {
				return l
			}
		}
	}
	if out, err := exec.Command("/usr/bin/defaults", "read", "-g", "AppleLocale").Output(); err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
})
