package core

// member_runas.go (#1359): member commands when the role runs as another OS user (run_as_user).
//
// The member directories belong to the bridge's account (0700), so a role process running as the
// run_as_user cannot open them at all: the kernel stops one member's turn from reading another
// member's directory or credentials. The bridge still reads the caller's own token, but the command
// itself (gh / git, and the file copies of put / get) runs as the role's OS user, so it can only touch
// what the role could touch anyway — `member git diff --no-index <someone else's hosts.yml>` is
// refused by the kernel, not by a rule.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// memberRunAsEnvKeys travel across the sudo boundary for member gh / git (on top of DefaultEnvAllowlist).
var memberRunAsEnvKeys = []string{"GH_TOKEN", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "GIT_TERMINAL_PROMPT", "GH_BROWSER", "BROWSER"}

// memberSpawn builds the command for one member operation: as the bridge user (default install), or
// as the role's OS user with only this person's token added (run_as_user set).
var memberSpawn = func(ctx context.Context, runAs, cwd string, env []string, bin string, args ...string) *exec.Cmd {
	opts := SpawnOptions{RunAsUser: runAs, EnvAllowlist: memberRunAsEnvKeys, WorkDir: cwd}
	cmd := BuildSpawnCommand(ctx, opts, bin, args...)
	if runAs == "" {
		cmd.Env, cmd.Dir = env, cwd
		return cmd
	}
	if cwd != "" {
		env = append(env, RunAsChdirEnv+"="+cwd)
	}
	cmd.Env = FilterEnvForSpawn(env, opts)
	return cmd
}

// memberToken: this person's own GitHub token, read by the bridge from their directory.
func memberToken(ctx context.Context, dir, gh string) (string, error) {
	cmd := exec.CommandContext(ctx, gh, "auth", "token", "--hostname", "github.com")
	cmd.Env = memberEnv(dir)
	out, err := cmd.Output()
	tok := strings.TrimSpace(string(out))
	if err != nil || tok == "" {
		return "", errors.New("读不到他本人的 GitHub 授权，请他重新 `bothouse member login`")
	}
	return tok, nil
}

// runMemberCmdAs runs gh / git as the role's OS user with GH_TOKEN = this person's token. The
// command starts in the role's own cwd (the member's files directory is not readable to that user).
func runMemberCmdAs(ctx context.Context, runAs, tok, cwd, bin string, args []string) (string, string, int) {
	env := append(os.Environ()[:0:0],
		"GH_TOKEN="+tok, "GH_PROMPT_DISABLED=1", "GH_NO_UPDATE_NOTIFIER=1", "GIT_TERMINAL_PROMPT=0",
		"BROWSER=true", "GH_BROWSER=true")
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		for _, a := range DefaultEnvAllowlist {
			if k == a {
				env = append(env, kv)
			}
		}
	}
	cmd := memberSpawn(ctx, runAs, cwd, env, bin, args...)
	var out, errOut limitedBuffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	return finishMemberRun(cmd.Run(), &out, &errOut)
}

// finishMemberRun: stdout, stderr, exit code (1 with the error text when it never started).
func finishMemberRun(err error, out, errOut *limitedBuffer) (string, string, int) {
	code := 0
	if err != nil {
		code = 1
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			errOut.WriteString(err.Error())
		}
	}
	return out.String(), errOut.String(), code
}

const memberFileMax = 64 << 20

// memberFileName: a plain name inside the person's files/ directory, nothing else.
func memberFileName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") || strings.HasPrefix(name, ".") {
		return "", fmt.Errorf("文件名 %q 不行：只写一个名字，不带路径、不以点开头", name)
	}
	return name, nil
}

// memberPut copies src (read as the role's OS user — what the role itself can read) into the person's
// files/ directory, so the bridge never reads a path for the role that the role could not read.
func memberPut(ctx context.Context, runAs, dir, cwd, src, name string) (string, error) {
	if src == "" {
		return "", errors.New("用法：bothouse member put <文件> [存成的名字]")
	}
	if name == "" {
		name = filepath.Base(src)
	}
	name, err := memberFileName(name)
	if err != nil {
		return "", err
	}
	var data bytes.Buffer
	cmd := memberSpawn(ctx, runAs, cwd, os.Environ(), "/bin/cat", "--", src)
	var errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &capWriter{w: &data, max: memberFileMax}, &errOut
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("读不了 %s：%s", src, strings.TrimSpace(nonEmpty(errOut.String(), err.Error())))
	}
	dst := filepath.Join(dir, "files", name)
	if err := AtomicWriteFile(dst, data.Bytes(), 0o600); err != nil {
		return "", err
	}
	return name, nil
}

// memberGet writes one file from the person's files/ directory to dst, the write done as the role's OS
// user (so it lands where the role may write, owned by the role).
func memberGet(ctx context.Context, runAs, dir, cwd, name, dst string) (string, error) {
	name, err := memberFileName(name)
	if err != nil {
		return "", err
	}
	src := filepath.Join(dir, "files", name)
	fi, err := os.Lstat(src)
	if err != nil || !fi.Mode().IsRegular() {
		return "", fmt.Errorf("他的文件里没有 %s", name)
	}
	if fi.Size() > memberFileMax {
		return "", fmt.Errorf("%s 太大（超过 64MB）", name)
	}
	f, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if dst == "" {
		dst = name
	}
	cmd := memberSpawn(ctx, runAs, cwd, os.Environ(), "/bin/sh", "-c", `cat > "$1"`, "sh", dst)
	var errOut bytes.Buffer
	cmd.Stdin, cmd.Stderr = f, &errOut
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("写不了 %s：%s", dst, strings.TrimSpace(nonEmpty(errOut.String(), err.Error())))
	}
	return dst, nil
}

// memberList: names in the person's files/ directory.
func memberList(dir string) []string {
	ents, _ := os.ReadDir(filepath.Join(dir, "files"))
	var names []string
	for _, e := range ents {
		if e.Type().IsRegular() && !strings.HasPrefix(e.Name(), ".") {
			names = append(names, e.Name())
		}
	}
	return names
}

type capWriter struct {
	w   io.Writer
	n   int64
	max int64
}

func (c *capWriter) Write(p []byte) (int, error) {
	if c.n+int64(len(p)) > c.max {
		return 0, errors.New("文件超过 64MB")
	}
	c.n += int64(len(p))
	return c.w.Write(p)
}
