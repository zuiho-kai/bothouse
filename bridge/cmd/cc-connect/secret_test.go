package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const testNotes = "# 服务器记录\n\n| 地址 | 备注 | 用户 | 密码 |\n|---|---|---|---|\n| `10.0.0.1` | arm | `root` | `p@ss-One!` |\n| `10.0.0.2` | x86 | `admin` | `Two2two` |\n\n## 其他\n- 不是表格的密码 abc\n"

func writeSecretFixtures(t *testing.T) secretSources {
	t.Helper()
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	notes := filepath.Join(dir, "notes.md")
	if err := os.WriteFile(cfg, []byte("[management]\n  enabled = true\n  token = \"tok-SECRET-123\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(notes, []byte(testNotes), 0o600); err != nil {
		t.Fatal(err)
	}
	return secretSources{ConfigPath: cfg, NotesPath: notes}
}

func TestLoadSecretsReadsTokenAndServerTable(t *testing.T) {
	items := loadSecrets(writeSecretFixtures(t))
	got := map[string]secretItem{}
	for _, it := range items {
		got[it.Name] = it
	}
	if len(items) != 3 {
		t.Fatalf("want 3 secrets, got %d: %+v", len(items), items)
	}
	if got["admin-token"].Value != "tok-SECRET-123" || got["admin-token"].Kind != "token" {
		t.Fatalf("admin-token: %+v", got["admin-token"])
	}
	if it := got["ssh-10.0.0.1"]; it.User != "root" || it.Value != "p@ss-One!" || it.Kind != "ssh" {
		t.Fatalf("ssh-10.0.0.1: %+v", it)
	}
	if it := got["ssh-10.0.0.2"]; it.User != "admin" || it.Value != "Two2two" {
		t.Fatalf("ssh-10.0.0.2: %+v", it)
	}
}

func TestFindSecretResolvesSSHAlias(t *testing.T) {
	items := loadSecrets(writeSecretFixtures(t))
	resolve := func(a string) string {
		if a == "vps-arm" {
			return "10.0.0.1"
		}
		return ""
	}
	it, ok := findSecret(items, "ssh-vps-arm", resolve)
	if !ok || it.Value != "p@ss-One!" || it.Host != "10.0.0.1" {
		t.Fatalf("alias lookup: ok=%v %+v", ok, it)
	}
	if _, ok := findSecret(items, "ssh-nope", resolve); ok {
		t.Fatal("unknown alias must not match")
	}
}

func TestRedactWriterMasksAcrossWrites(t *testing.T) {
	var out bytes.Buffer
	w := newRedactWriter(&out, "hunter2-long")
	for _, chunk := range []string{"a hun", "ter2-lo", "ng b\nhunter2-longhunter2-long", " end", "hunter2-"} {
		if _, err := w.Write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Flush(); err != nil {
		t.Fatal(err)
	}
	if want := "a *** b\n****** endhunter2-"; out.String() != want {
		t.Fatalf("got %q want %q", out.String(), want)
	}
}

func TestRunWithSecretInjectsEnvAndRedactsOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sh")
	}
	it := secretItem{Name: "ssh-10.0.0.1", Kind: "ssh", User: "root", Host: "10.0.0.1", Value: "p@ss-One!"}
	var stdout, stderr bytes.Buffer
	// The askpass script ssh would call must print the value; the run's own output must not.
	code, err := runWithSecret(it, []string{"sh", "-c", `echo "out $BH_SECRET"; "$SSH_ASKPASS" "pw:" >&2; echo "$BH_SECRET_USER@$BH_SECRET_HOST $SSH_ASKPASS_REQUIRE"; exit 3`}, nil, &stdout, &stderr)
	if err != nil || code != 3 {
		t.Fatalf("code=%d err=%v", code, err)
	}
	all := stdout.String() + stderr.String()
	if strings.Contains(all, "p@ss-One!") {
		t.Fatalf("secret leaked: %q", all)
	}
	if !strings.Contains(stdout.String(), "out ***") || !strings.Contains(stdout.String(), "root@10.0.0.1 force") {
		t.Fatalf("stdout %q", stdout.String())
	}
	if strings.TrimSpace(stderr.String()) != "***" {
		t.Fatalf("askpass should print the (masked) value, stderr %q", stderr.String())
	}
}
