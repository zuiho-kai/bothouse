package main

import (
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"

	ccconnect "github.com/chenhg5/cc-connect"
)

// A test run that still reaches the live bridge posts into the user's real channels (2026-10-26: a
// workspace self-check in its own HOME inherited the live bot token and channel variables, and its
// test task card landed in a real channel). testEnvLeak refuses such a run before anything starts.
//
// A run is a test when BOTHOUSE_TEST is set or HOME is under a temp dir (iso-check puts it in
// /tmp/iso.*). It is refused when it points at the live data dir (the account's real home), carries
// a live bot token (a token or secret from the live config.toml, in an env var or in the config it
// loads), or carries the live channel variables (CC_SESSION_KEY with a CC_PROJECT the live config
// names).

var (
	liveSecretLine  = regexp.MustCompile(`(?m)^\s*[A-Za-z_]*(?:token|secret|password)[A-Za-z_]*\s*=\s*"([^"]{12,})"`)
	liveProjectLine = regexp.MustCompile(`(?m)^\s*name\s*=\s*"([^"]+)"`)
)

// testEnvLeak returns why this test run must not start, or "".
func testEnvLeak(configPath string, args []string) string {
	home := os.Getenv("HOME")
	if os.Getenv("BOTHOUSE_TEST") == "" && !underTempDir(home) {
		return ""
	}
	real := accountHome()
	if real == "" || samePath(real, home) {
		return ""
	}
	live := []string{filepath.Join(real, ".bothouse"), filepath.Join(real, ".cc-connect")}
	if d := os.Getenv(ccconnect.DataDirEnv); d != "" && !underTempDir(d) {
		live = append(live, filepath.Clean(d))
	}
	inLive := func(p string) bool {
		if p == "" {
			return false
		}
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
		for _, d := range live {
			if samePath(p, d) || strings.HasPrefix(p, d+string(filepath.Separator)) {
				return true
			}
		}
		return false
	}
	for _, k := range []string{ccconnect.DataDirEnv, "CC_DATA_DIR", "CC_LOG_FILE"} {
		if v := os.Getenv(k); v != "" && inLive(v) {
			return k + " 指向线上数据目录 " + v
		}
	}
	for _, a := range args {
		if _, v, ok := strings.Cut(a, "="); ok && strings.HasPrefix(a, "-") {
			a = v
		}
		if strings.Contains(a, string(filepath.Separator)) && inLive(a) {
			return "参数指向线上数据目录 " + a
		}
	}
	if inLive(configPath) {
		return "配置文件是线上的 " + configPath
	}
	liveCfg, _ := os.ReadFile(filepath.Join(live[0], "config.toml"))
	if len(liveCfg) == 0 {
		liveCfg, _ = os.ReadFile(filepath.Join(live[1], "config.toml"))
	}
	if len(liveCfg) == 0 {
		return ""
	}
	cfg, _ := os.ReadFile(configPath)
	for _, m := range liveSecretLine.FindAllSubmatch(liveCfg, -1) {
		s := string(m[1])
		for _, kv := range os.Environ() {
			if k, v, _ := strings.Cut(kv, "="); v == s {
				return "环境变量 " + k + " 是线上 bot 的令牌"
			}
		}
		if len(cfg) > 0 && strings.Contains(string(cfg), s) {
			return "配置 " + configPath + " 带着线上 bot 的令牌（预演用去掉密钥的副本）"
		}
	}
	if os.Getenv("CC_SESSION_KEY") != "" || os.Getenv("CC_SESSION") != "" {
		proj := os.Getenv("CC_PROJECT")
		for _, m := range liveProjectLine.FindAllSubmatch(liveCfg, -1) {
			if proj != "" && string(m[1]) == proj {
				return "带着线上频道变量 CC_PROJECT=" + proj + " 和 CC_SESSION_KEY（先 unset CC_SESSION_KEY CC_SESSION CC_PROJECT CC_DATA_DIR）"
			}
		}
	}
	return ""
}

// accountHome is the account's real home from the user database, not $HOME.
func accountHome() string {
	if u, err := user.Current(); err == nil && u.HomeDir != "" && !underTempDir(u.HomeDir) {
		return filepath.Clean(u.HomeDir)
	}
	return ""
}

func underTempDir(p string) bool {
	if p == "" {
		return false
	}
	p = filepath.Clean(p)
	for _, t := range []string{os.TempDir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"} {
		t = filepath.Clean(t)
		if t != "" && t != "/" && (p == t || strings.HasPrefix(p, t+string(filepath.Separator))) {
			return true
		}
	}
	return false
}

func samePath(a, b string) bool {
	return filepath.Clean(a) == filepath.Clean(b)
}
