package main

// `bothouse secret run <name> -- <command…>`: a role uses a server password or the management
// token without ever seeing it. The value is read here from where it already lives (the server
// notes table, the bridge config), handed to the child process only through its environment
// (and, for ssh, through a throwaway SSH_ASKPASS script), and every occurrence of it in the
// child's stdout/stderr is replaced with "***" before it reaches the role's transcript.
// User 2026-11-21 「你都搞一下」 on 橘's point that we had no credential isolation compared with
// Anthropic's always-on agents. Board #1858. First two kinds only: ssh passwords and the
// management token; `secret list` prints names, never values.

import (
	"bufio"
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/BurntSushi/toml"
)

const (
	secretEnvValue = "BH_SECRET"      // the value, for the child only
	secretEnvUser  = "BH_SECRET_USER" // ssh kind: login user from the notes table
	secretEnvHost  = "BH_SECRET_HOST" // ssh kind: address from the notes table
	secretMask     = "***"
)

type secretItem struct {
	Name  string
	Kind  string // "ssh" or "token"
	User  string
	Host  string
	Value string
	From  string // where it was read, shown by `secret list`
}

type secretSources struct {
	ConfigPath string // bridge config.toml ([management].token)
	NotesPath  string // server notes markdown table (地址 | … | 用户 | 密码)
}

func defaultSecretSources(dataDir string) secretSources {
	src := secretSources{ConfigPath: filepath.Join(resolveSecretDataDir(dataDir), "config.toml")}
	if home, err := os.UserHomeDir(); err == nil {
		src.NotesPath = filepath.Join(home, "notes", "服务器记录.md")
	}
	if v := strings.TrimSpace(os.Getenv("BOTHOUSE_SECRET_NOTES")); v != "" {
		src.NotesPath = v
	}
	return src
}

func resolveSecretDataDir(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if v := strings.TrimSpace(os.Getenv("CC_DATA_DIR")); v != "" {
		return v
	}
	return resolveDataDir("")
}

// loadSecrets reads every secret the two sources hold. Missing sources are skipped.
func loadSecrets(src secretSources) []secretItem {
	var out []secretItem
	if tok := readManagementToken(src.ConfigPath); tok != "" {
		out = append(out, secretItem{Name: "admin-token", Kind: "token", Value: tok, From: src.ConfigPath + " [management].token"})
	}
	if b, err := os.ReadFile(src.NotesPath); err == nil {
		for _, r := range parseServerTable(string(b)) {
			out = append(out, secretItem{Name: "ssh-" + r.Host, Kind: "ssh", User: r.User, Host: r.Host, Value: r.Value, From: src.NotesPath})
		}
	}
	return out
}

func readManagementToken(path string) string {
	var cfg struct {
		Management struct {
			Token string `toml:"token"`
		} `toml:"management"`
	}
	if _, err := toml.DecodeFile(path, &cfg); err != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Management.Token)
}

type serverRow struct{ Host, User, Value string }

// parseServerTable reads markdown tables whose header has 地址/用户/密码 (or address/user/password).
func parseServerTable(md string) []serverRow {
	var rows []serverRow
	hostCol, userCol, passCol := -1, -1, -1
	for _, line := range strings.Split(md, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			hostCol, userCol, passCol = -1, -1, -1
			continue
		}
		cells := strings.Split(strings.Trim(line, "|"), "|")
		for i := range cells {
			cells[i] = strings.Trim(strings.TrimSpace(cells[i]), "`")
		}
		if hostCol < 0 {
			for i, c := range cells {
				switch strings.ToLower(c) {
				case "地址", "address", "host":
					hostCol = i
				case "用户", "user":
					userCol = i
				case "密码", "password":
					passCol = i
				}
			}
			if userCol < 0 || passCol < 0 {
				hostCol, userCol, passCol = -1, -1, -1
			}
			continue
		}
		if strings.Trim(cells[0], "-: ") == "" { // separator row
			continue
		}
		if hostCol >= len(cells) || userCol >= len(cells) || passCol >= len(cells) {
			continue
		}
		if cells[hostCol] == "" || cells[passCol] == "" {
			continue
		}
		rows = append(rows, serverRow{Host: cells[hostCol], User: cells[userCol], Value: cells[passCol]})
	}
	return rows
}

// findSecret resolves a name. "ssh-<x>" also matches when <x> is an ~/.ssh/config alias whose
// HostName is a notes-table address.
func findSecret(items []secretItem, name string, resolveHost func(string) string) (secretItem, bool) {
	for _, it := range items {
		if it.Name == name {
			return it, true
		}
	}
	if alias, ok := strings.CutPrefix(name, "ssh-"); ok && resolveHost != nil {
		if h := resolveHost(alias); h != "" {
			for _, it := range items {
				if it.Kind == "ssh" && it.Host == h {
					it.Name = name
					return it, true
				}
			}
		}
	}
	return secretItem{}, false
}

// sshHostName asks ssh (no network) what HostName an alias maps to.
func sshHostName(alias string) string {
	out, err := exec.Command("ssh", "-G", alias).Output()
	if err != nil {
		return ""
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		if v, ok := strings.CutPrefix(sc.Text(), "hostname "); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// redactWriter replaces every occurrence of the secrets with "***", holding back just enough
// bytes that a value split across two writes is still caught.
type redactWriter struct {
	mu      sync.Mutex
	w       io.Writer
	secrets [][]byte
	hold    int
	buf     []byte
}

func newRedactWriter(w io.Writer, secrets ...string) *redactWriter {
	rw := &redactWriter{w: w}
	for _, s := range secrets {
		if s == "" {
			continue
		}
		rw.secrets = append(rw.secrets, []byte(s))
		if len(s)-1 > rw.hold {
			rw.hold = len(s) - 1
		}
	}
	sort.Slice(rw.secrets, func(i, j int) bool { return len(rw.secrets[i]) > len(rw.secrets[j]) })
	return rw
}

func (r *redactWriter) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf = append(r.buf, p...)
	r.mask()
	// Any value starting before len-hold ends inside buf and is already masked; the tail may
	// still be the start of one, so it waits for the next write.
	if n := len(r.buf) - r.hold; n > 0 {
		if _, err := r.w.Write(r.buf[:n]); err != nil {
			return 0, err
		}
		r.buf = append(r.buf[:0], r.buf[n:]...)
	}
	return len(p), nil
}

func (r *redactWriter) mask() {
	for _, s := range r.secrets {
		r.buf = bytes.ReplaceAll(r.buf, s, []byte(secretMask))
	}
}

// Flush writes what is held back. Call once the child has exited.
func (r *redactWriter) Flush() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mask()
	_, err := r.w.Write(r.buf)
	r.buf = r.buf[:0]
	return err
}

// runWithSecret runs argv with the secret in its environment and both output streams redacted.
// It returns the child's exit code.
func runWithSecret(it secretItem, argv []string, stdin io.Reader, stdout, stderr io.Writer) (int, error) {
	if len(argv) == 0 {
		return 2, errors.New("缺少要运行的命令")
	}
	env := append(os.Environ(), secretEnvValue+"="+it.Value)
	if it.Kind == "ssh" {
		dir, err := os.MkdirTemp("", "bh-askpass-")
		if err != nil {
			return 1, err
		}
		defer os.RemoveAll(dir)
		script := filepath.Join(dir, "askpass")
		// The script holds no value: it prints the child's own environment variable.
		if err := os.WriteFile(script, []byte("#!/bin/sh\nprintf '%s\\n' \"$"+secretEnvValue+"\"\n"), 0o700); err != nil {
			return 1, err
		}
		env = append(env, "SSH_ASKPASS="+script, "SSH_ASKPASS_REQUIRE=force", "DISPLAY=:0",
			secretEnvUser+"="+it.User, secretEnvHost+"="+it.Host)
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = env
	cmd.Stdin = stdin
	ow, ew := newRedactWriter(stdout, it.Value), newRedactWriter(stderr, it.Value)
	cmd.Stdout, cmd.Stderr = ow, ew
	err := cmd.Run()
	_ = ow.Flush()
	_ = ew.Flush()
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode(), nil
	}
	if err != nil {
		return 127, err
	}
	return 0, nil
}

func printSecretUsage() {
	fmt.Fprint(os.Stderr, `用法：
  bothouse secret list                       列出能代用的密钥名（只列名字和出处，不显示值）
  bothouse secret run <名字> -- <命令…>       带着密钥跑命令；输出里的密钥原文换成 ***

密钥只进子进程的环境变量 $BH_SECRET，命令行里写名字，别写值：
  ssh 密码：名字 ssh-<地址或 ~/.ssh/config 别名>；ssh 自动经 SSH_ASKPASS 拿密码
    bothouse secret run ssh-vps-arm -- ssh vps-arm uptime
  管理页令牌：名字 admin-token
    bothouse secret run admin-token -- sh -c 'curl -s -H "Authorization: Bearer $BH_SECRET" http://127.0.0.1:9820/api/...'

选项：
  --data-dir <目录>   桥数据目录（默认 $CC_DATA_DIR 或 ~/.bothouse），令牌从这里的 config.toml 读
  服务器密码表默认 ~/notes/服务器记录.md，可用环境变量 BOTHOUSE_SECRET_NOTES 指别处
`)
}

func runSecret(args []string) {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		printSecretUsage()
		if len(args) == 0 {
			os.Exit(2)
		}
		return
	}
	switch args[0] {
	case "list":
		fs := flag.NewFlagSet("secret list", flag.ExitOnError)
		dataDir := fs.String("data-dir", "", "")
		fs.Usage = printSecretUsage
		_ = fs.Parse(args[1:])
		items := loadSecrets(defaultSecretSources(*dataDir))
		if len(items) == 0 {
			fmt.Println("没有找到能代用的密钥。")
			return
		}
		for _, it := range items {
			who := ""
			if it.Kind == "ssh" {
				who = "  用户 " + it.User
			}
			fmt.Printf("%-24s %-5s%s  出处 %s\n", it.Name, it.Kind, who, it.From)
		}
	case "run":
		fs := flag.NewFlagSet("secret run", flag.ExitOnError)
		dataDir := fs.String("data-dir", "", "")
		fs.Usage = printSecretUsage
		_ = fs.Parse(args[1:])
		rest := fs.Args()
		if len(rest) == 0 {
			printSecretUsage()
			os.Exit(2)
		}
		name, argv := rest[0], rest[1:]
		if len(argv) > 0 && argv[0] == "--" {
			argv = argv[1:]
		}
		if len(argv) == 0 {
			printSecretUsage()
			os.Exit(2)
		}
		it, ok := findSecret(loadSecrets(defaultSecretSources(*dataDir)), name, sshHostName)
		if !ok {
			fmt.Fprintf(os.Stderr, "secret: 没有叫 %q 的密钥；bothouse secret list 看有哪些\n", name)
			os.Exit(2)
		}
		code, err := runWithSecret(it, argv, os.Stdin, os.Stdout, os.Stderr)
		if err != nil {
			fmt.Fprintln(os.Stderr, "secret:", err)
		}
		os.Exit(code)
	default:
		printSecretUsage()
		os.Exit(2)
	}
}
