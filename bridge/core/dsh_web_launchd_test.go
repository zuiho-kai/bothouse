//go:build darwin

package core

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// writeLaunchdPlist puts a LaunchAgent into the test's HOME at the job's real path.
func writeLaunchdPlist(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(os.Getenv("HOME"), "Library", "LaunchAgents", dshWebLaunchdLabel+".plist")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func launchdPlist(stdout, stderr string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>HOME</key>
		<string>/Users/someone</string>
	</dict>
	<key>Label</key>
	<string>` + dshWebLaunchdLabel + `</string>
	<key>StandardErrorPath</key>
	<string>` + stderr + `</string>
	<key>StandardOutPath</key>
	<string>` + stdout + `</string>
</dict>
</plist>
`
}

// The plist's paths are read in stdout-then-stderr order, and a path that no longer exists is not a
// candidate (a release directory the update removed must not cost a probe).
func TestLaunchdLogPathsComeFromThePlist(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if got := dshWebLaunchdLogPaths(); len(got) != 0 {
		t.Fatalf("no plist: %v", got)
	}
	base := t.TempDir()
	out := filepath.Join(base, "releases", "v0.1.65", "dsh-web.log")
	errPath := filepath.Join(base, "releases", "v0.1.65", "dsh-web.err")
	for _, p := range []string{out, errPath} {
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeLaunchdPlist(t, launchdPlist(out, errPath))
	got := dshWebLaunchdLogPaths()
	if len(got) != 2 || got[0] != out || got[1] != errPath {
		t.Fatalf("launchd logs = %v, want [%s %s]", got, out, errPath)
	}
	gone := filepath.Join(base, "releases", "v0.1.64", "dsh-web.log")
	writeLaunchdPlist(t, launchdPlist(gone, errPath))
	if got := dshWebLaunchdLogPaths(); len(got) != 1 || got[0] != errPath {
		t.Fatalf("a removed release log must not be a candidate: %v", got)
	}
	writeLaunchdPlist(t, launchdPlist(errPath, out))
	if got := dshWebLaunchdLogPaths(); len(got) != 2 || got[0] != errPath {
		t.Fatalf("order must follow the plist keys: %v", got)
	}
}

// #1394: launchd writes the supervised host's announcement to the plist's path, while the state file
// records the default `~/.bothouse/dsh-web.log` (an earlier open wrote it there). The announcement
// carries no port (`--public-url https://<host>.ts.net/`), so that plist log is the only place the
// running host can be found — without it the panel starts a second `dsh web`.
func TestOpenDSHWebReadsTheLaunchdLogWhenTheStateFileRecordsTheDefault(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	w.fake.launch.Store("rotated")
	w.writeLog(t, w.defaultLog(), "dsh web: http://127.0.0.1:1/?token=stale")
	launchdLog := filepath.Join(t.TempDir(), "cc-maomao", "releases", "bothouse-develop-x-20261105", "dsh-web.log")
	w.writeLog(t, launchdLog, "dsh web: https://mac-mini.example.ts.net/?token=rotated")
	writeLaunchdPlist(t, launchdPlist(launchdLog, launchdLog))
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:1/?token=stale#channels", Log: w.defaultLog()})

	web, err := openDSHWeb(context.Background(), t.TempDir())
	w.assertAdopted(t, web, err, "rotated", launchdLog)
}
