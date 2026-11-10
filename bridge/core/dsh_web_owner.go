package core

// Whether a loopback listener is *this* bridge's DSH host cannot be settled by the launch token: a
// second DSH on the same machine accepts its own token just as happily, so "the port answers
// GET /?token= with 303" only says "some dsh lives here" (审稿 #1255 阻塞一). Before the state file
// is rewritten or a pid is signalled, the listener itself has to say it is a DSH host started for
// this account: a web/desktop profile in its command line and, wherever the environment can be read,
// this bridge's data directory in it.
//
// Anything else — an unrelated service that happens to hold the old port, a second bothouse's DSH, a
// process whose command line cannot be read — is left alone: the state file keeps pointing where it
// did and nothing is stopped. Refusing costs a 503 the panel already knows how to show; adopting
// someone else's host points the panel at a stranger and, with roles waiting for import, kills it.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	ccconnect "github.com/chenhg5/cc-connect"
)

// dshWebProcess is what a pid's command line and environment say about it.
type dshWebProcess struct {
	Argv []string
	// Profile is the value after `--profile`, "" when the command line has none.
	Profile string
	// DataDir is the BOTHOUSE_DATA_DIR / CC_DATA_DIR / CONEST_LEAD_FILE directory the process was
	// started with, "" when it sets none of them.
	DataDir string
	// EnvKnown: the environment could be read at all. Windows cannot read another process's
	// environment without a PEB walk, so there only the command line decides.
	EnvKnown bool
}

// isDSHHost: the command line belongs to a DSH host of one of the profiles bothouse runs — `dsh web`
// (dsh/install.sh PROFILE=web) or the desktop app's host (DSHDesktopProfile). dsh/scripts/reload-web.py
// is_web_host applies the same rule to `--profile`; the app carries its profile as a
// `…/profiles/desktop` argument instead of a flag, so both spellings are accepted.
func (p dshWebProcess) isDSHHost() bool {
	if p.Profile != "" {
		// It says which profile it runs: only the two bothouse starts count. A `--profile headless`
		// dsh is a DSH too, but it is not a web host and must never be adopted as one.
		return p.Profile == DSHProfile || p.Profile == DSHDesktopProfile
	}
	// No --profile: the desktop app carries its profile as a path argument, and an older launch may
	// have none at all. Fall back to the binary name, and let the data-dir check decide the rest.
	for _, a := range p.Argv {
		if base := filepath.Base(a); base == "dsh" || base == "dsh.exe" {
			return true
		}
		for _, profile := range []string{DSHProfile, DSHDesktopProfile} {
			if strings.Contains(a, string(filepath.Separator)+"profiles"+string(filepath.Separator)+profile) {
				return true
			}
		}
	}
	return false
}

// dshWebProcessOf reads pid's command line and environment; ok is false when the platform cannot (a
// process of another user, a kernel that hides it, a pid that just exited).
func dshWebProcessOf(pid int) (dshWebProcess, bool) {
	argv, env, envKnown, ok := dshWebProcLookup(pid)
	if !ok || len(argv) == 0 {
		return dshWebProcess{}, false
	}
	p := dshWebProcess{Argv: argv, EnvKnown: envKnown}
	for i, a := range argv {
		if a == "--profile" && i+1 < len(argv) {
			p.Profile = argv[i+1]
		}
	}
	if envKnown {
		switch {
		case env[ccconnect.DataDirEnv] != "":
			p.DataDir = filepath.Clean(env[ccconnect.DataDirEnv])
		case env["CC_DATA_DIR"] != "":
			p.DataDir = filepath.Clean(env["CC_DATA_DIR"])
		case env["CONEST_LEAD_FILE"] != "":
			p.DataDir = filepath.Dir(filepath.Clean(env["CONEST_LEAD_FILE"]))
		case env["HOME"] != "":
			// No variable of ours at all: the host resolves its data directory from HOME like we do,
			// so that is what it uses. Without this, every hand-started `dsh web` looked like a
			// stranger and would have been refused (#1255 阻塞一 must not break the real host).
			p.DataDir = filepath.Clean(ccconnect.DataDir(env["HOME"]))
		}
	}
	return p, true
}

// dshWebOwnDataDir: the data directory this bridge hands the hosts it starts — the value openDSHWeb
// passes (BOTHOUSE_DATA_DIR), the one the launchd unit passes (CC_DATA_DIR), or what both resolve
// from HOME when neither is set. One name is not enough: a host started by an older build, by the
// launchd unit or by hand may carry a different one of these than the bridge process itself.
func dshWebOwnDataDir() string {
	dirs := dshWebOwnDataDirs()
	if len(dirs) == 0 {
		return ""
	}
	return dirs[0]
}

// dshWebOwnDataDirs is every data directory a host of this bridge may legitimately have been given.
func dshWebOwnDataDirs() []string {
	var dirs []string
	add := func(d string) {
		if d = strings.TrimSpace(d); d == "" {
			return
		}
		d = filepath.Clean(d)
		for _, have := range dirs {
			if have == d {
				return
			}
		}
		dirs = append(dirs, d)
	}
	add(os.Getenv(ccconnect.DataDirEnv))
	add(os.Getenv("CC_DATA_DIR"))
	if home, err := os.UserHomeDir(); err == nil {
		add(ccconnect.DataDir(home))
	}
	return dirs
}

// dshWebProcLookup reads pid's argv, environment and whether the environment was readable at all.
// Replaceable in tests, which describe a process instead of starting one.
var dshWebProcLookup = dshWebProcLookupNow

// dshWebEnvMap turns KEY=VALUE tokens into a map, skipping blanks and tokens without a name. A
// duplicated name keeps the last value, which is what the process itself sees.
func dshWebEnvMap(tokens []string) map[string]string {
	env := make(map[string]string, len(tokens))
	for _, kv := range tokens {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || k == "" {
			continue
		}
		env[k] = v
	}
	return env
}

// dshWebPortClaims lets a test say what stands behind a fake port, since the fake host is the test
// binary and its own command line is not `dsh` (dsh_web_owner_test.go claimDSHWebPort). Production
// never fills it, so there the real process check below decides.
var dshWebPortClaims = struct {
	sync.RWMutex
	m map[string]bool // port → true: a host of ours, false: someone else's
}{m: map[string]bool{}}

func dshWebPortClaimed(port string) (ours, claimed bool) {
	dshWebPortClaims.RLock()
	defer dshWebPortClaims.RUnlock()
	ours, claimed = dshWebPortClaims.m[port]
	return ours, claimed
}

// dshWebPortOwned answers whether the host listening on port is provably this bridge's own DSH, with
// the pid it proved it on. Replaceable in tests, like dshWebProcLookup.
var dshWebPortOwned = dshWebPortOwnedNow

func dshWebPortOwnedNow(ctx context.Context, port string) (pid int, owned bool, why string) {
	if port == "" {
		return 0, false, "no port"
	}
	pid = pidListeningOnPortCtx(ctx, port)
	if ours, claimed := dshWebPortClaimed(port); claimed {
		if pid <= 0 {
			pid = os.Getpid() // a fake host in a test: the test process serves it
		}
		if ours {
			return pid, true, ""
		}
		return pid, false, fmt.Sprintf("pid %d on port %s belongs to another instance", pid, port)
	}
	if pid <= 0 {
		return 0, false, "nothing says which process listens on port " + port +
			" (no lsof, or no permission), so it cannot be shown to be this bridge's host"
	}
	if owned, why := dshWebPIDOwned(pid); !owned {
		return pid, false, fmt.Sprintf("on port %s: %s", port, why)
	}
	return pid, true, ""
}

// dshWebPIDOwned answers whether pid is this bridge's own DSH host, with the reason when it is not.
// Both the adoption check above and openDSHWeb's "stop the host I am replacing" go through it: a pid
// in a state file or in lsof's answer is a hint, not proof, and a reused pid is exactly how a stray
// process got killed (#1255 阻塞二).
func dshWebPIDOwned(pid int) (bool, string) {
	if pid <= 0 {
		return false, "no pid"
	}
	p, ok := dshWebProcessOf(pid)
	if !ok {
		return false, fmt.Sprintf("the command line of pid %d cannot be read", pid)
	}
	if !p.isDSHHost() {
		return false, fmt.Sprintf("pid %d is not a dsh host (no web/desktop profile in its command line)", pid)
	}
	// Compare the data directories when both are known. An empty one means the environment could not
	// be read at all (Windows) or the process reveals nothing: then the profile above is all the
	// evidence there is, and refusing would break the real host on such a machine.
	if p.EnvKnown && p.DataDir != "" {
		ours := dshWebOwnDataDirs()
		if len(ours) == 0 {
			return true, "" // this bridge cannot say where its own data lives; the profile decides
		}
		for _, d := range ours {
			if d == p.DataDir {
				return true, ""
			}
		}
		return false, fmt.Sprintf("pid %d runs on another data directory (%s, ours: %s)",
			pid, p.DataDir, strings.Join(ours, ", "))
	}
	return true, ""
}
