package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/chenhg5/cc-connect/core"
)

// bothouse guard: the reference permission gate. It trusts nothing the model says: it verifies a
// caller token signed by the bridge, looks the platform user up in an admin-owned policy file, and runs
// a fixed command for that action as the mapped system user, writing an audit line either way.
// Nothing in it is GPU-specific; GPU, ssh, API calls are all just "actions" in the policy.

const guardUsage = `Usage: bothouse guard [options] <action> [args...]

Verifies the caller token, checks the policy, runs the action's command as the mapped user, audits.

Options:
  --policy FILE   policy file (default $BOTHOUSE_GUARD_POLICY or /etc/bothouse/guard.toml)
  --token TOKEN   caller token (default $BOTHOUSE_CALLER_TOKEN, else fetched from the local bridge
                  for $CC_PROJECT/$CC_SESSION_KEY)
  --check         decide and print the decision only; run nothing
  --ssh           forced-command mode: read "<token> <action> [args...]" from $SSH_ORIGINAL_COMMAND

Policy (TOML), see docs/caller-identity.md:
  trusted_keys = ["/etc/bothouse/bridge.pub"]   # bridge public keys (bothouse identity pubkey)
  audit_log    = "/var/log/bothouse-guard.jsonl"
  allow_kinds  = ["human"]                        # default; bot/scheduled/local are refused

  [roles.member]
  actions     = ["gpu-run"]                       # "*" = every action
  max_seconds = N                                 # optional per-run time limit; omit for none

  [[users]]
  platform = "discord"
  user_id  = "<platform user id>"
  run_as   = "alice"
  role     = "member"

  [actions.gpu-run]
  command = ["gpu", "run"]                        # caller args are appended; no shell
  as_user = true                                  # run as run_as (false: run as the guard's user,
                                                  # e.g. command = ["ssh", "{run_as}@gpu-host", ...])
  Placeholders in command: {run_as} {user_id} {platform} {project} {user_name}
`

// Exit codes.
const (
	guardExitDenied   = 1   // 来源：通用约定，非 0 即失败
	guardExitUsage    = 2   // 来源：沿用 flag/shell 用法错惯例
	guardExitAudit    = 3   // 来源：与上两个区分，审计不可写即拒绝
	guardExitTimeout  = 124 // 来源：沿用 GNU timeout 超时退出码
	guardExitCannot   = 126 // 来源：沿用 POSIX shell「不能执行」
	guardExitNotFound = 127 // 来源：沿用 POSIX shell「找不到命令」
)

type guardPolicy struct {
	TrustedKeys []string               `toml:"trusted_keys"`
	AuditLog    string                 `toml:"audit_log"`
	AllowKinds  []string               `toml:"allow_kinds"`
	Roles       map[string]guardRole   `toml:"roles"`
	Users       []guardUser            `toml:"users"`
	Actions     map[string]guardAction `toml:"actions"`
}

type guardRole struct {
	Actions    []string `toml:"actions"`
	MaxSeconds int      `toml:"max_seconds"`
}

type guardUser struct {
	Platform string `toml:"platform"`
	UserID   string `toml:"user_id"`
	RunAs    string `toml:"run_as"`
	Role     string `toml:"role"`
}

type guardAction struct {
	Command []string `toml:"command"`
	AsUser  *bool    `toml:"as_user"`
}

type guardDecision struct {
	Allow   bool
	Reason  string
	Claims  core.CallerClaims
	User    guardUser
	Action  string
	Command []string
	AsUser  bool
	Timeout time.Duration
}

func runGuard(args []string) {
	code, err := guardCommand(args, os.Stdin, os.Stdout, os.Stderr, time.Now())
	if err != nil {
		fmt.Fprintln(os.Stderr, "guard:", err)
	}
	os.Exit(code)
}

func guardCommand(args []string, stdin io.Reader, stdout, stderr io.Writer, now time.Time) (int, error) {
	fs := flag.NewFlagSet("guard", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	defPolicy := os.Getenv("BOTHOUSE_GUARD_POLICY")
	if defPolicy == "" {
		defPolicy = "/etc/bothouse/guard.toml"
	}
	policyPath := fs.String("policy", defPolicy, "")
	token := fs.String("token", os.Getenv("BOTHOUSE_CALLER_TOKEN"), "")
	check := fs.Bool("check", false, "")
	sshMode := fs.Bool("ssh", false, "")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprint(stdout, guardUsage)
			return 0, nil
		}
		return guardExitUsage, fmt.Errorf("%w\n%s", err, guardUsage)
	}
	rest := fs.Args()
	if *sshMode {
		f := strings.Fields(os.Getenv("SSH_ORIGINAL_COMMAND"))
		if len(f) < 2 {
			return guardExitUsage, errors.New(`--ssh: SSH_ORIGINAL_COMMAND must be "<token> <action> [args...]"`)
		}
		*token, rest = f[0], f[1:]
	}
	if len(rest) > 0 && rest[0] == "--" {
		rest = rest[1:]
	}
	if len(rest) == 0 {
		fmt.Fprint(stderr, guardUsage)
		return guardExitUsage, errors.New("no action")
	}
	action, callerArgs := rest[0], rest[1:]
	if len(callerArgs) > 0 && callerArgs[0] == "--" {
		callerArgs = callerArgs[1:]
	}

	pol, err := loadGuardPolicy(*policyPath)
	if err != nil {
		return guardExitUsage, err
	}
	if *token == "" && !*sshMode {
		if t, _, ferr := fetchCallerToken("", os.Getenv("CC_PROJECT"), os.Getenv("CC_SESSION_KEY")); ferr == nil {
			*token = t
		}
	}
	d := pol.decide(*token, action, now)
	d.Command = append(d.Command, callerArgs...)
	audit := map[string]any{
		"time": now.UTC().Format(time.RFC3339), "action": action, "args": callerArgs,
		"decision": map[bool]string{true: "allow", false: "deny"}[d.Allow], "reason": d.Reason,
		"platform": d.Claims.Platform, "user_id": d.Claims.UserID, "user_name": d.Claims.UserName,
		"kind": d.Claims.Kind, "project": d.Claims.Project, "chat_id": d.Claims.ChatID,
		"turn": d.Claims.Turn, "kid": d.Claims.KeyID, "run_as": d.User.RunAs, "role": d.User.Role,
	}
	if *check {
		audit["check"] = true
	}
	if err := pol.writeAudit(audit); err != nil {
		return guardExitAudit, fmt.Errorf("audit log unavailable, refusing: %w", err)
	}
	if *check {
		b, _ := json.MarshalIndent(map[string]any{"allow": d.Allow, "reason": d.Reason, "run_as": d.User.RunAs,
			"role": d.User.Role, "command": d.Command, "caller": d.Claims}, "", "  ")
		fmt.Fprintln(stdout, string(b))
		if !d.Allow {
			return guardExitDenied, nil
		}
		return 0, nil
	}
	if !d.Allow {
		return guardExitDenied, errors.New("denied: " + d.Reason)
	}
	start := time.Now()
	code, runErr := guardExec(d, stdin, stdout, stderr)
	done := map[string]any{"time": time.Now().UTC().Format(time.RFC3339), "action": action,
		"decision": "finished", "platform": d.Claims.Platform, "user_id": d.Claims.UserID,
		"turn": d.Claims.Turn, "run_as": d.User.RunAs, "exit": code,
		"seconds": int(time.Since(start).Seconds())}
	if runErr != nil {
		done["error"] = runErr.Error()
	}
	_ = pol.writeAudit(done)
	return code, runErr
}

func loadGuardPolicy(path string) (*guardPolicy, error) {
	var p guardPolicy
	md, err := toml.DecodeFile(path, &p)
	if err != nil {
		return nil, fmt.Errorf("policy %s: %w", path, err)
	}
	if und := md.Undecoded(); len(und) > 0 {
		return nil, fmt.Errorf("policy %s: unknown keys %v", path, und)
	}
	if len(p.TrustedKeys) == 0 {
		return nil, fmt.Errorf("policy %s: trusted_keys is empty", path)
	}
	if p.AuditLog == "" {
		return nil, fmt.Errorf("policy %s: audit_log is required", path)
	}
	if len(p.AllowKinds) == 0 {
		p.AllowKinds = []string{core.CallerHuman}
	}
	return &p, nil
}

func (p *guardPolicy) decide(token, action string, now time.Time) guardDecision {
	d := guardDecision{Action: action}
	if token == "" {
		d.Reason = "no caller token"
		return d
	}
	keys, err := loadTrustedKeys(strings.Join(p.TrustedKeys, ","), "")
	if err != nil {
		d.Reason = err.Error()
		return d
	}
	c, err := core.VerifyCallerToken(token, keys, now)
	if err != nil {
		d.Reason = "token: " + err.Error()
		return d
	}
	d.Claims = c
	if !containsStr(p.AllowKinds, c.Kind) {
		d.Reason = fmt.Sprintf("caller kind %q not allowed (turn not started by a person)", c.Kind)
		return d
	}
	var u *guardUser
	for i := range p.Users {
		if p.Users[i].Platform == c.Platform && p.Users[i].UserID == c.UserID {
			u = &p.Users[i]
			break
		}
	}
	if u == nil {
		d.Reason = fmt.Sprintf("%s user %s is not in the policy", c.Platform, c.UserID)
		return d
	}
	d.User = *u
	role, ok := p.Roles[u.Role]
	if !ok {
		d.Reason = fmt.Sprintf("role %q is not defined", u.Role)
		return d
	}
	if !containsStr(role.Actions, action) && !containsStr(role.Actions, "*") {
		d.Reason = fmt.Sprintf("role %q may not run %q", u.Role, action)
		return d
	}
	a, ok := p.Actions[action]
	if !ok || len(a.Command) == 0 {
		d.Reason = fmt.Sprintf("action %q has no command", action)
		return d
	}
	d.AsUser = a.AsUser == nil || *a.AsUser
	r := strings.NewReplacer("{run_as}", u.RunAs, "{user_id}", c.UserID, "{platform}", c.Platform,
		"{project}", c.Project, "{user_name}", c.UserName)
	for _, s := range a.Command {
		d.Command = append(d.Command, r.Replace(s))
	}
	if role.MaxSeconds > 0 {
		d.Timeout = time.Duration(role.MaxSeconds) * time.Second
	}
	d.Allow, d.Reason = true, "ok"
	return d
}

func (p *guardPolicy) writeAudit(rec map[string]any) error {
	f, err := os.OpenFile(p.AuditLog, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o640) // 来源：审计日志只给属主和管理组读
	if err != nil {
		return err
	}
	b, _ := json.Marshal(rec)
	_, err = f.Write(append(b, '\n'))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

func guardExec(d guardDecision, stdin io.Reader, stdout, stderr io.Writer) (int, error) {
	ctx := context.Background()
	if d.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, d.Timeout)
		defer cancel()
	}
	argv := d.Command
	var cred func(*exec.Cmd) error
	if d.AsUser && d.User.RunAs != "" {
		cur, _ := user.Current()
		switch {
		case cur != nil && cur.Username == d.User.RunAs:
		case os.Geteuid() == 0:
			cred = func(c *exec.Cmd) error { return setRunAsUser(c, d.User.RunAs) }
		default:
			argv = append([]string{"sudo", "-n", "-u", d.User.RunAs, "--"}, argv...)
		}
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, stdout, stderr
	cmd.Env = append(os.Environ(),
		"BOTHOUSE_CALLER_PLATFORM="+d.Claims.Platform, "BOTHOUSE_CALLER_USER_ID="+d.Claims.UserID,
		"BOTHOUSE_CALLER_USER_NAME="+d.Claims.UserName, "BOTHOUSE_CALLER_PROJECT="+d.Claims.Project,
		"BOTHOUSE_CALLER_TURN="+d.Claims.Turn, "BOTHOUSE_CALLER_RUN_AS="+d.User.RunAs)
	if cred != nil {
		if err := cred(cmd); err != nil {
			return guardExitCannot, err
		}
	}
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return guardExitTimeout, fmt.Errorf("stopped after role limit %s", d.Timeout)
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode(), nil
	}
	if err != nil {
		return guardExitNotFound, err
	}
	return 0, nil
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
