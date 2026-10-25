package main

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// `bothouse update --help` used to run a real update (2026-10-25: an isolated test run without
// HOME reached the real instance's socket and that instance replaced its own binary). This test
// runs every top-level command, and the subcommands that change something, with --help in a child
// process that has a fake HOME, a fake bothouse socket, a recording proxy and stand-ins for
// launchctl/systemctl/open. Each one must print its usage and exit 0 without touching the socket,
// the network, a service manager or any file.

// helpNoopSubcommands: the second-level commands that change something (write config, talk to the
// running bothouse, drive launchd/systemd, log in to a platform).
var helpNoopSubcommands = [][]string{
	{"config", "format"},
	{"provider", "add"}, {"provider", "remove"}, {"provider", "import"}, {"provider", "global"},
	{"cron", "add"}, {"cron", "edit"}, {"cron", "exec"}, {"cron", "del"},
	{"timer", "add"}, {"timer", "del"},
	{"model", "set"}, {"model", "effort"}, {"model", "auto"},
	{"workspace", "new"}, {"workspace", "claim"}, {"workspace", "park"},
	{"relay", "send"},
	{"sessions", "prune"},
	{"session", "new"},
	{"daemon", "install"}, {"daemon", "uninstall"}, {"daemon", "start"}, {"daemon", "stop"}, {"daemon", "restart"},
	{"feishu", "setup"}, {"feishu", "new"}, {"feishu", "bind"},
	{"weixin", "setup"}, {"weixin", "new"}, {"weixin", "bind"},
	{"yuanbao", "setup"}, {"yuanbao", "bind"},
	{"setup", "apply"}, {"setup", "dsh"}, {"setup", "hub"}, {"setup", "hooks"}, {"setup", "lead"}, {"setup", "tools"},
}

// helpNoopSkip: top-level entries that are not user commands.
var helpNoopSkip = map[string]string{
	// Internal: the old binary runs it with a spec in the environment after an update. It takes
	// no arguments and returns at once without that spec.
	core.UpdateGuardArg: "internal",
}

const helpChildEnv = "BOTHOUSE_TEST_HELP_CHILD"

// TestHelpChildProcess is the child side: run one command handler, then exit 0 if it returned.
func TestHelpChildProcess(t *testing.T) {
	spec := os.Getenv(helpChildEnv)
	if spec == "" {
		t.Skip("helper process")
	}
	args := strings.Split(spec, "\x1f")
	h, ok := topLevelCommandHandlers[args[0]]
	if !ok {
		fmt.Fprintf(os.Stderr, "no handler %q\n", args[0])
		os.Exit(99)
	}
	h(args[1:])
	os.Exit(0)
}

func TestEveryCommandHelpHasNoSideEffects(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket and shell stand-ins")
	}
	var cases [][]string
	names := make([]string, 0, len(topLevelCommandHandlers))
	for name := range topLevelCommandHandlers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if _, skip := helpNoopSkip[name]; skip {
			continue
		}
		for _, h := range []string{"--help", "-h", "help"} {
			cases = append(cases, []string{name, h})
		}
	}
	for _, sub := range helpNoopSubcommands {
		if _, ok := topLevelCommandHandlers[sub[0]]; !ok {
			continue // built without this command (build tags)
		}
		for _, h := range []string{"--help", "-h"} {
			cases = append(cases, append(append([]string{}, sub...), h))
		}
	}
	for _, c := range cases {
		c := c
		t.Run(strings.Join(c, "_"), func(t *testing.T) {
			t.Parallel()
			runHelpNoopCase(t, c)
		})
	}
}

func runHelpNoopCase(t *testing.T, args []string) {
	dir, err := os.MkdirTemp("/tmp", "bhh") // short: unix socket paths are capped near 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	home := filepath.Join(dir, "h")
	dataDir := filepath.Join(home, ".bothouse")
	work := filepath.Join(dir, "w")
	stubs := filepath.Join(dir, "bin")
	calls := filepath.Join(dir, "calls")
	for _, d := range []string{filepath.Join(dataDir, "run"), work, stubs} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	// Fake running bothouse: counts every request.
	var sockHits atomic.Int32
	ln, err := net.Listen("unix", filepath.Join(dataDir, "run", "api.sock"))
	if err != nil {
		t.Fatal(err)
	}
	sockSrv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sockHits.Add(1)
		w.WriteHeader(http.StatusTeapot)
	})}
	go sockSrv.Serve(ln)
	t.Cleanup(func() { sockSrv.Close() })

	// Recording proxy: any HTTP(S) request the command makes goes here.
	var netHits atomic.Int32
	pln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			c, err := pln.Accept()
			if err != nil {
				return
			}
			netHits.Add(1)
			c.Close()
		}
	}()
	t.Cleanup(func() { pln.Close() })
	proxy := "http://" + pln.Addr().String()

	for _, name := range []string{"launchctl", "systemctl", "open", "xdg-open", "claude", "codex", "gemini", "node", "npm", "uv"} {
		script := "#!/bin/sh\necho \"" + name + " $*\" >> " + calls + "\nexit 1\n"
		if err := os.WriteFile(filepath.Join(stubs, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	before := snapshotTree(t, dir)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second) // a --help that starts serving never returns
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestHelpChildProcess$")
	cmd.Dir = work
	cmd.Env = []string{
		helpChildEnv + "=" + strings.Join(args, "\x1f"),
		"HOME=" + home, "USERPROFILE=" + home,
		"CC_DATA_DIR=" + dataDir, // agent shells carry it; commands that honour it must still not call
		"PATH=" + stubs + ":/usr/bin:/bin",
		"HTTP_PROXY=" + proxy, "HTTPS_PROXY=" + proxy, "http_proxy=" + proxy, "https_proxy=" + proxy,
		"TMPDIR=" + dir, // the test sandbox accepts a HOME only inside TMPDIR
		"CONEST_TEST_SANDBOX=" + home,
		"BOTHOUSE_NO_TRAY=1",
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	cmd.Stdin = strings.NewReader("")
	err = cmd.Run()
	out := stdout.String() + stderr.String()
	if err != nil {
		t.Errorf("%v: exit %v\n%s", args, err, out)
	}
	if n := sockHits.Load(); n != 0 {
		t.Errorf("%v: %d request(s) to the bothouse socket\n%s", args, n, out)
	}
	if n := netHits.Load(); n != 0 {
		t.Errorf("%v: %d network connection(s)\n%s", args, n, out)
	}
	if b, err := os.ReadFile(calls); err == nil {
		t.Errorf("%v: ran external programs: %s", args, b)
	}
	if after := snapshotTree(t, dir); after != before {
		t.Errorf("%v: files changed\nbefore:\n%s\nafter:\n%s", args, before, after)
	}
	if strings.TrimSpace(out) == "" {
		t.Errorf("%v: printed no usage", args)
	}
}

// snapshotTree lists every path under root with size and mtime (the socket and the
// stand-ins included; the calls file is checked separately).
func snapshotTree(t *testing.T, root string) string {
	t.Helper()
	var b strings.Builder
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if filepath.Base(p) == "calls" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		fmt.Fprintf(&b, "%s %d %s\n", rel, info.Size(), info.ModTime().Format("15:04:05.000000000"))
		return nil
	})
	return b.String()
}
