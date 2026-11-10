//go:build !windows

package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Under run_as_user the member's gh / git and the file copies are spawned through sudo as the role's
// OS user, with only GH_TOKEN (this person's) added; the bridge never reads a path for the role.
func TestMemberCommandsRunAsRoleUser(t *testing.T) {
	cmd := memberSpawn(context.Background(), "bh-role", "/work/a", []string{"GH_TOKEN=tok-a", "SECRET=x", "LANG=C"}, "/usr/bin/git", "push")
	argv := strings.Join(cmd.Args, " ")
	if !strings.HasPrefix(argv, "sudo -n -iu bh-role --preserve-env=") || !strings.Contains(argv, "GH_TOKEN") || !strings.HasSuffix(argv, "/usr/bin/git push") {
		t.Fatalf("not spawned as the role user: %s", argv)
	}
	env := strings.Join(cmd.Env, " ")
	if !strings.Contains(env, "GH_TOKEN=tok-a") || strings.Contains(env, "SECRET=x") || !strings.Contains(env, RunAsChdirEnv+"=/work/a") {
		t.Fatalf("env across sudo: %v", cmd.Env)
	}
	plain := memberSpawn(context.Background(), "", "/work/a", []string{"A=1"}, "/usr/bin/git", "push")
	if plain.Args[0] != "/usr/bin/git" || plain.Dir != "/work/a" {
		t.Fatalf("default install should run directly: %v dir=%q", plain.Args, plain.Dir)
	}
}

func TestMemberPutGetLs(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "files"), 0o700)
	work := t.TempDir()
	os.WriteFile(filepath.Join(work, "a.txt"), []byte("hello"), 0o644)
	ctx := context.Background()
	if got, err := memberPut(ctx, "", dir, work, "a.txt", ""); err != nil || got != "a.txt" {
		t.Fatalf("put: %q %v", got, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "files", "a.txt")); string(b) != "hello" {
		t.Fatalf("put content %q", b)
	}
	if names := memberList(dir); len(names) != 1 || names[0] != "a.txt" {
		t.Fatalf("ls %v", names)
	}
	if _, err := memberGet(ctx, "", dir, work, "a.txt", "b.txt"); err != nil {
		t.Fatalf("get: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(work, "b.txt")); string(b) != "hello" {
		t.Fatalf("get content %q", b)
	}
	for _, bad := range []string{"../x", ".gh-config", "a/b", ""} {
		if _, err := memberGet(ctx, "", dir, work, bad, ""); err == nil {
			t.Fatalf("get %q allowed", bad)
		}
	}
	if _, err := memberPut(ctx, "", dir, work, "missing.txt", ""); err == nil {
		t.Fatal("put of a missing file passed")
	}
}
