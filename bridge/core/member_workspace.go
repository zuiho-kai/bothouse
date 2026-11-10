package core

// Member workspaces (#1355, user 2026-11-10 「按用户区分文件夹跟那个gh，别人不能访问这个也做成功能……
// 如果用户说要搞团队的话，给他推荐配置上」). Productized from what the agentm deployment did by hand:
// every real person who joins gets a personal directory, may authorize GitHub with their own device
// code, and the credentials live only in that directory.
//
//	<data_dir>/members/<platform>-<user_id>/      0700, one per person, shared by all roles of this bridge
//	    README.md        who this is (written by the bridge)
//	    github.md        authorization record: status, GitHub login, when (never the token)
//	    files/           work files the roles keep for this person
//	    .gh-config/      GH_CONFIG_DIR of this person (hosts.yml, 0600; gh --insecure-storage so the
//	                     token stays here instead of a keychain entry shared by everyone)
//
// Whose credentials a gh / git call uses is decided by the bridge, not by the model: the CLI
// (`bothouse member gh|git …`) asks the bridge over api.sock, the bridge looks up who started the turn
// running in that session (caller_identity.go: only a real human's turn counts) and runs gh / git with
// that person's GH_CONFIG_DIR. A turn started by A can therefore not run anything as B through this
// path. How strong that is depends on the deployment: when the role processes run under their own
// system account (docs/CALLER_IDENTITY.md, split setup) the members dir is the bridge account's 0700
// directory and a role cannot read it at all; when roles and bridge share one account (the default)
// the files are still readable to a role that bypasses the command, and only the rules tell it not to.
// docs/MEMBER_WORKSPACES.md says so plainly.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	memberDirName        = "members"
	memberGHTimeout      = 10 * time.Minute // one gh / git call
	memberLoginTimeout   = 15 * time.Minute // GitHub device codes expire after 15 minutes
	memberOutputLimit    = 256 << 10
	memberJoinDedupe     = 30 * time.Minute // one join, reported by several bots or twice by the gateway
	memberAuthorizedYes  = "authorized: yes"
	memberAuthorizedNo   = "authorized: no"
	memberAuthorizedLeft = "authorized: removed"
)

var deviceCodeRe = regexp.MustCompile(`\b([A-Z0-9]{4}-[A-Z0-9]{4})\b`)

// memberLogins: device-code logins running now, one per person.
var memberLogins = struct {
	sync.Mutex
	running map[string]bool
}{running: map[string]bool{}}

// memberJoins: last join handled per person (dedupe across bots and gateway resends).
var memberJoins = struct {
	sync.Mutex
	at map[string]time.Time
}{at: map[string]time.Time{}}

// SetMemberWorkspaces turns member workspaces on or off for this project (member_workspaces).
func (e *Engine) SetMemberWorkspaces(on bool) {
	e.memberWSMu.Lock()
	e.memberWS = on
	e.memberWSMu.Unlock()
}

// MemberWorkspacesOn reports member_workspaces.
func (e *Engine) MemberWorkspacesOn() bool {
	e.memberWSMu.Lock()
	defer e.memberWSMu.Unlock()
	return e.memberWS
}

// SetMemberWorkspacesSaver: how `bothouse member enable|disable` persists the switch (config.toml).
func (e *Engine) SetMemberWorkspacesSaver(f func(on bool) error) {
	e.memberWSMu.Lock()
	e.memberWSSave = f
	e.memberWSMu.Unlock()
}

// MemberWorkspaceDir is the personal directory of platform user userID under dataDir.
func MemberWorkspaceDir(dataDir, platform, userID string) (string, error) {
	if dataDir == "" {
		return "", errors.New("no data dir")
	}
	if !safeMemberPart(platform) || !safeMemberPart(userID) {
		return "", fmt.Errorf("bad member id %q/%q", platform, userID)
	}
	return filepath.Join(dataDir, memberDirName, platform+"-"+userID), nil
}

func safeMemberPart(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' || r == '.' || r == '@') {
			return false
		}
	}
	return s != "." && s != ".."
}

// ensureMemberDir creates (or confirms) the personal directory; created reports which.
func ensureMemberDir(dataDir, platform, userID, userName string) (dir string, created bool, err error) {
	dir, err = MemberWorkspaceDir(dataDir, platform, userID)
	if err != nil {
		return "", false, err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, memberDirName), 0o700); err != nil {
		return "", false, err
	}
	_ = os.Chmod(filepath.Join(dataDir, memberDirName), 0o700)
	if _, statErr := os.Stat(dir); os.IsNotExist(statErr) {
		created = true
	}
	for _, d := range []string{dir, filepath.Join(dir, "files"), filepath.Join(dir, ".gh-config")} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return "", false, err
		}
		_ = os.Chmod(d, 0o700)
	}
	readme := filepath.Join(dir, "README.md")
	if _, err := os.Stat(readme); os.IsNotExist(err) {
		body := fmt.Sprintf("# %s 的个人目录\n\n- 平台：%s\n- 账号 id：%s\n- 建于：%s\n\n"+
			"只放这个人的东西。`files/` 是替他干活时放文件的地方；`.gh-config/` 是他自己的 GitHub 授权，"+
			"只经 `bothouse member gh|git` 在他本人发起的那一轮里使用。\n",
			nonEmpty(userName, userID), platform, userID, time.Now().Format("2006-01-02 15:04"))
		if err := AtomicWriteFile(readme, []byte(body), 0o600); err != nil {
			return "", false, err
		}
	}
	return dir, created, nil
}

func nonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

// memberAuthorized reads github.md: whether this person's own GitHub authorization is in place.
func memberAuthorized(dir string) (ok bool, login string) {
	b, err := os.ReadFile(filepath.Join(dir, "github.md"))
	if err != nil {
		return false, ""
	}
	text := string(b)
	if !strings.Contains(text, memberAuthorizedYes) {
		return false, ""
	}
	if _, err := os.Stat(filepath.Join(dir, ".gh-config", "hosts.yml")); err != nil {
		return false, ""
	}
	for _, line := range strings.Split(text, "\n") {
		if v, found := strings.CutPrefix(strings.TrimSpace(line), "github_login:"); found {
			login = strings.TrimSpace(v)
		}
	}
	return true, login
}

func writeMemberGitHubRecord(dir, status, login, note string) error {
	body := fmt.Sprintf("# GitHub 授权\n\n%s\ngithub_login: %s\nupdated: %s\n\n%s\n\n"+
		"凭据只在本目录 .gh-config/hosts.yml（由 gh 管理，0600），不复制、不写进日志或聊天。\n"+
		"只在本人发起的那一轮里经 `bothouse member gh|git` 使用；push、合并 PR、改公开内容前先问本人。\n"+
		"撤销：本人说「撤销我的 GitHub 授权」（角色跑 `bothouse member logout`），或在 GitHub → Settings → "+
		"Applications → Authorized OAuth Apps → GitHub CLI 里 Revoke。\n",
		status, login, time.Now().Format(time.RFC3339), note)
	return AtomicWriteFile(filepath.Join(dir, "github.md"), []byte(body), 0o600)
}

// ── member.joined / member.left ─────────────────────────────────────

// memberEventTarget: this engine acts for the team (lead) or alone (no team), like the intent notice.
func (e *Engine) memberEventTarget() bool {
	return e.MemberWorkspacesOn() && e.memberNoticeTarget()
}

// onMemberPlatformEvent: with member_workspaces on, a real person joining gets their directory and
// the lead gets one silent turn saying what was done; leaving drops their GitHub credentials.
func (e *Engine) onMemberPlatformEvent(p Platform, ev PlatformEvent) {
	if ev.Bot || ev.UserID == "" || !e.memberEventTarget() {
		return
	}
	switch ev.Name {
	case HookEventMemberJoined:
		e.memberJoined(p, ev)
	case HookEventMemberLeft:
		e.memberLeft(p, ev)
	}
}

func (e *Engine) memberJoined(p Platform, ev PlatformEvent) {
	id := p.Name() + "-" + ev.UserID
	memberJoins.Lock()
	if t, ok := memberJoins.at[id]; ok && time.Since(t) < memberJoinDedupe {
		memberJoins.Unlock()
		slog.Info("member workspace: join already handled", "member", id)
		return
	}
	memberJoins.at[id] = time.Now()
	memberJoins.Unlock()

	dir, created, err := ensureMemberDir(e.dataDir, p.Name(), ev.UserID, ev.UserName)
	action := "已确认个人目录存在"
	if err != nil {
		action = "个人目录没建成（" + err.Error() + "）"
	} else if created {
		action = "已创建个人目录"
	}
	authorized, login := false, ""
	if err == nil {
		authorized, login = memberAuthorized(dir)
	}
	slog.Info("member workspace: joined", "project", e.name, "member", id, "created", created, "authorized", authorized)
	key := e.memberWakeSession(p, ev)
	if key == "" {
		slog.Warn("member workspace: no chat channel to tell the lead", "project", e.name, "member", id)
		return
	}
	prompt := memberJoinPrompt(ev, action, authorized, login)
	go func() {
		if err := e.ExecuteHeartbeat(key, prompt, true); err != nil {
			slog.Warn("member workspace: lead not woken", "project", e.name, "session", key, "error", err)
		}
	}()
}

func memberJoinPrompt(ev PlatformEvent, action string, authorized bool, login string) string {
	var b strings.Builder
	b.WriteString("[系统事件 member.joined，不是用户发的消息，不要把这段原文发到频道]\n")
	fmt.Fprintf(&b, "%s（<@%s>）刚加入%s。桥已经做了：%s。\n", platformEventLabel(ev), ev.UserID, nonEmpty(ev.GuildName, "服务器"), action)
	if authorized {
		fmt.Fprintf(&b, "他的个人 GitHub 授权已经在（账号 %s），不要再问。\n", login)
	} else {
		b.WriteString("他还没有自己的 GitHub 授权。\n")
	}
	b.WriteString("请简短欢迎并 @ 他，按上面写的说清已经做了什么（不说没做的事）")
	if !authorized {
		b.WriteString("；问他要不要配自己的 GitHub 权限。只有他本人明确同意，才在他发起的那一轮里跑 `bothouse member login`，设备码由桥私信给他本人，不要贴到频道")
	}
	b.WriteString("。")
	return b.String()
}

// memberWakeSession picks where the lead hears about a join: the server's system channel when the
// lead talks there, else the lead's most recently active public chat channel on that platform.
func (e *Engine) memberWakeSession(p Platform, ev PlatformEvent) string {
	if e.sessions == nil {
		return ""
	}
	prefix := p.Name() + ":"
	idToKey, active := e.sessions.SessionKeyMap()
	var best string
	var bestAt time.Time
	for _, s := range e.sessions.AllSessions() {
		k := idToKey[s.ID]
		if !active[s.ID] || !strings.HasPrefix(k, prefix) {
			continue
		}
		chat := chatOf(k)
		if _, isWS := e.workspaceOwner(strings.TrimPrefix(chat, prefix)); isWS {
			continue
		}
		if _, direct := e.sessions.ChatPublic(chat); direct {
			continue
		}
		if ev.ChannelID != "" && chat == prefix+ev.ChannelID {
			return k
		}
		if at := s.GetUpdatedAt(); best == "" || at.After(bestAt) {
			best, bestAt = k, at
		}
	}
	return best
}

func (e *Engine) memberLeft(p Platform, ev PlatformEvent) {
	dir, err := MemberWorkspaceDir(e.dataDir, p.Name(), ev.UserID)
	if err != nil {
		return
	}
	if _, err := os.Stat(dir); err != nil {
		return
	}
	// Leaving drops the local copy of the person's GitHub token; the directory and its files stay (so
	// nothing of theirs is lost if they come back). The token itself stays valid on GitHub until they
	// revoke it there; the record says how.
	if ok, login := memberAuthorized(dir); ok {
		_ = os.RemoveAll(filepath.Join(dir, ".gh-config"))
		_ = os.MkdirAll(filepath.Join(dir, ".gh-config"), 0o700)
		_ = writeMemberGitHubRecord(dir, memberAuthorizedLeft, login,
			"本人 "+time.Now().Format("2006-01-02 15:04")+" 退出服务器，本机凭据已删除。GitHub 上的授权要本人到 GitHub 设置里撤销。")
		slog.Info("member workspace: left, credentials removed", "project", e.name, "member", p.Name()+"-"+ev.UserID)
	}
}

// ── api.sock: POST /member ───────────────────────────────────────────

// MemberRequest is what `bothouse member` sends.
type MemberRequest struct {
	Project string   `json:"project"`
	Session string   `json:"session"`
	Op      string   `json:"op"` // status | dir | login | gh | git | logout | enable | disable
	Args    []string `json:"args,omitempty"`
	Cwd     string   `json:"cwd,omitempty"`
}

// MemberResponse: Text is for the model; Stdout/Stderr/Exit for gh / git.
type MemberResponse struct {
	Text   string `json:"text,omitempty"`
	Dir    string `json:"dir,omitempty"`
	Stdout string `json:"stdout,omitempty"`
	Stderr string `json:"stderr,omitempty"`
	Exit   int    `json:"exit"`
}

func (s *APIServer) handleMember(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req MemberRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	e, err := s.engineFor(req.Project)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	resp, status := e.memberOp(r.Context(), req)
	apiJSON(w, status, resp)
}

// memberCaller: who started the turn running in session. Only a real person counts: a teammate bot,
// a timer or a hand-off wake-up has nobody's GitHub authorization.
func (e *Engine) memberCaller(session string) (callerTurn, error) {
	e.callerMu.Lock()
	t, ok := e.callerTurns[session]
	e.callerMu.Unlock()
	if session == "" || !ok || time.Since(t.at) > callerTurnMaxAge {
		return t, errors.New("这条命令只能在一轮对话里用（桥不知道这一轮是谁发起的）")
	}
	if t.kind != CallerHuman || t.userID == "" {
		return t, fmt.Errorf("这一轮不是真人发起的（%s），不能用任何成员的目录和 GitHub 授权；等本人在频道里说话时再用", t.kind)
	}
	return t, nil
}

func (e *Engine) memberOp(ctx context.Context, req MemberRequest) (MemberResponse, int) {
	fail := func(status int, format string, a ...any) (MemberResponse, int) {
		return MemberResponse{Text: fmt.Sprintf(format, a...), Exit: 1}, status
	}
	t, err := e.memberCaller(req.Session)
	if err != nil {
		return fail(http.StatusForbidden, "%s", err.Error())
	}
	switch req.Op {
	case "enable", "disable":
		return e.memberSwitch(t, req.Op == "enable")
	}
	if !e.MemberWorkspacesOn() {
		return fail(http.StatusConflict, "这个项目没开成员个人目录（member_workspaces）。主人说要开时，在他发起的那一轮里跑 `bothouse member enable`。")
	}
	dir, created, err := ensureMemberDir(e.dataDir, t.platform, t.userID, t.userName)
	if err != nil {
		return fail(http.StatusInternalServerError, "个人目录：%v", err)
	}
	who := nonEmpty(t.userName, t.userID)
	switch req.Op {
	case "status", "dir", "":
		ok, login := memberAuthorized(dir)
		text := fmt.Sprintf("%s 的个人目录：%s（文件放 %s）", who, dir, filepath.Join(dir, "files"))
		if created {
			text += "，刚建好"
		}
		if ok {
			text += fmt.Sprintf("；GitHub 已授权，账号 %s", login)
		} else {
			text += "；还没有自己的 GitHub 授权（本人同意后跑 `bothouse member login`）"
		}
		return MemberResponse{Text: text, Dir: dir}, http.StatusOK
	case "login":
		return e.memberLogin(t, req.Session, dir)
	case "logout":
		gh, err := findGH()
		if err != nil {
			return fail(http.StatusConflict, "%s", err.Error())
		}
		ok, login := memberAuthorized(dir)
		if !ok {
			return MemberResponse{Text: who + " 本来就没有 GitHub 授权"}, http.StatusOK
		}
		_, _, _ = runMemberCmd(ctx, dir, "", gh, []string{"auth", "logout", "--hostname", "github.com"}, nil)
		_ = os.RemoveAll(filepath.Join(dir, ".gh-config"))
		_ = os.MkdirAll(filepath.Join(dir, ".gh-config"), 0o700)
		_ = writeMemberGitHubRecord(dir, memberAuthorizedNo, login, "本人 "+time.Now().Format("2006-01-02 15:04")+" 撤销，本机凭据已删除。")
		return MemberResponse{Text: who + " 的本机 GitHub 凭据已删除；GitHub 上的授权要本人到 GitHub 设置里撤销"}, http.StatusOK
	case "gh", "git":
		ok, _ := memberAuthorized(dir)
		if !ok {
			return fail(http.StatusConflict, "%s 还没有自己的 GitHub 授权，不能用 %s。先问本人要不要配，同意后跑 `bothouse member login`；不借用别人的授权。", who, req.Op)
		}
		gh, err := findGH()
		if err != nil {
			return fail(http.StatusConflict, "%s", err.Error())
		}
		bin, args := gh, req.Args
		if req.Op == "git" {
			if bin, err = exec.LookPath("git"); err != nil {
				return fail(http.StatusConflict, "本机没有 git")
			}
			// Only this person's gh answers GitHub's credential prompt; helpers from the user's own
			// git config are switched off for this call.
			helper := "!" + shellQuoteHelper(gh) + " auth git-credential"
			args = append([]string{"-c", "credential.helper=", "-c", "credential.https://github.com.helper=" + helper,
				"-c", "credential.https://gist.github.com.helper=" + helper}, req.Args...)
		}
		cctx, cancel := context.WithTimeout(ctx, memberGHTimeout)
		defer cancel()
		out, errOut, code := runMemberCmd(cctx, dir, req.Cwd, bin, args, nil)
		slog.Info("member workspace: command", "project", e.name, "member", t.platform+"-"+t.userID, "op", req.Op, "exit", code)
		return MemberResponse{Stdout: out, Stderr: errOut, Exit: code}, http.StatusOK
	}
	return fail(http.StatusBadRequest, "不认识的操作 %q", req.Op)
}

func shellQuoteHelper(p string) string {
	if !strings.ContainsAny(p, " '\"\\$`") {
		return p
	}
	return "'" + strings.ReplaceAll(p, "'", `'\''`) + "'"
}

// memberSwitch: `bothouse member enable|disable`, only in a turn the owner (admin_from) started —
// the user agrees to the recommendation, then it takes effect; nobody else can turn it on.
func (e *Engine) memberSwitch(t callerTurn, on bool) (MemberResponse, int) {
	if !e.isDMOwner(t.userID) { // explicit admin_from only: "*" would let anyone turn it on
		return MemberResponse{Text: "只有主人（admin_from 里的人）发起的那一轮能开关成员个人目录", Exit: 1}, http.StatusForbidden
	}
	e.memberWSMu.Lock()
	save := e.memberWSSave
	e.memberWSMu.Unlock()
	if save != nil {
		if err := save(on); err != nil {
			return MemberResponse{Text: "写 config.toml 失败：" + err.Error(), Exit: 1}, http.StatusInternalServerError
		}
	}
	for _, x := range append([]*Engine{e}, e.watchEngines()...) {
		x.SetMemberWorkspaces(on)
	}
	if on {
		return MemberResponse{Text: "成员个人目录已开：之后有人进群，桥给他建个人目录，并让你问他要不要配自己的 GitHub 授权（已写进 config.toml，重启也在）"}, http.StatusOK
	}
	return MemberResponse{Text: "成员个人目录已关：已有的目录和授权不动，新进群的人不再建目录"}, http.StatusOK
}

// findGH: the gh binary the bridge runs for members.
func findGH() (string, error) {
	if p, err := exec.LookPath("gh"); err == nil {
		return p, nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		for _, p := range []string{filepath.Join(home, ".local", "bin", "gh"), "/opt/homebrew/bin/gh", "/usr/local/bin/gh"} {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, nil
			}
		}
	}
	return "", errors.New("本机没装 GitHub CLI（gh），装好再用：https://cli.github.com")
}

// memberEnv: the bridge's environment with this person's gh config, nothing of anyone else's.
func memberEnv(dir string) []string {
	var env []string
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		switch k {
		case "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_CONFIG_DIR",
			"GIT_ASKPASS", "SSH_ASKPASS", "GIT_CONFIG_GLOBAL", "GH_BROWSER", "BROWSER":
			continue
		}
		env = append(env, kv)
	}
	return append(env, "GH_CONFIG_DIR="+filepath.Join(dir, ".gh-config"), "GH_PROMPT_DISABLED=1",
		"GH_NO_UPDATE_NOTIFIER=1", "GIT_TERMINAL_PROMPT=0", "BROWSER=true", "GH_BROWSER=true")
}

func runMemberCmd(ctx context.Context, dir, cwd, bin string, args []string, stdin io.Reader) (string, string, int) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = memberEnv(dir)
	if cwd != "" {
		cmd.Dir = cwd
	} else {
		cmd.Dir = filepath.Join(dir, "files")
	}
	cmd.Stdin = stdin
	var out, errOut limitedBuffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
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

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if room := memberOutputLimit - b.Len(); room > 0 {
		if len(p) > room {
			b.Buffer.Write(p[:room])
		} else {
			b.Buffer.Write(p)
		}
	}
	return len(p), nil
}

// ── device-code login ─────────────────────────────────────────────

// memberLogin starts `gh auth login` for this person in the background: the one-time code goes to
// them in a private message (or, when the platform refuses the DM, to the channel of their turn with
// an @ — the code only links a GitHub account to *their* directory, so seeing it gives nobody access
// to anything of theirs). When GitHub confirms, github.md records the login and they are told.
func (e *Engine) memberLogin(t callerTurn, session, dir string) (MemberResponse, int) {
	gh, err := findGH()
	if err != nil {
		return MemberResponse{Text: err.Error(), Exit: 1}, http.StatusConflict
	}
	id := t.platform + "-" + t.userID
	memberLogins.Lock()
	if memberLogins.running[id] {
		memberLogins.Unlock()
		return MemberResponse{Text: "这个人的授权已经在进行中，等他在 GitHub 页面输完设备码"}, http.StatusOK
	}
	memberLogins.running[id] = true
	memberLogins.Unlock()

	codeCh := make(chan string, 1)
	ctx, cancel := context.WithTimeout(context.Background(), memberLoginTimeout)
	go e.runMemberLogin(ctx, cancel, t, session, dir, gh, codeCh)
	select {
	case code := <-codeCh:
		if code == "" {
			return MemberResponse{Text: "gh 没给出设备码，授权没开始（看桥日志 member workspace: login）", Exit: 1}, http.StatusInternalServerError
		}
		where, derr := e.sendMemberPrivately(t, session, memberLoginCodeText(code))
		if derr != nil {
			cancel() // an undelivered code must not stay usable
			return MemberResponse{Text: "设备码没送到本人，授权已取消，设备码没有发到任何别处：" + derr.Error() +
				"。不要让他改隐私设置；在频道里告诉他私信没送到（不带设备码）。", Exit: 1}, http.StatusBadGateway
		}
		return MemberResponse{Text: "设备码已" + where + "，等他在 GitHub 页面输入；授权完成后桥会告诉他。不要在频道里重复设备码。"}, http.StatusOK
	case <-time.After(30 * time.Second):
		cancel()
		return MemberResponse{Text: "gh 30 秒内没给出设备码，授权没开始", Exit: 1}, http.StatusGatewayTimeout
	}
}

func memberLoginCodeText(code string) string {
	return "你的 GitHub 设备码：" + code + "\n打开 https://github.com/login/device 输入它并确认授权（15 分钟内有效）。" +
		"授权只放在你自己的个人目录，只在你本人让我做事的时候用；不要把密码或令牌发给我。"
}

func (e *Engine) runMemberLogin(ctx context.Context, cancel context.CancelFunc, t callerTurn, session, dir, gh string, codeCh chan<- string) {
	id := t.platform + "-" + t.userID
	defer func() {
		memberLogins.Lock()
		delete(memberLogins.running, id)
		memberLogins.Unlock()
	}()
	defer cancel()
	cmd := exec.CommandContext(ctx, gh, "auth", "login", "--hostname", "github.com", "--git-protocol", "https",
		"--web", "--skip-ssh-key", "--insecure-storage")
	cmd.Env = memberEnv(dir)
	cmd.Dir = dir
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	stdin, _ := cmd.StdinPipe()
	if err := cmd.Start(); err != nil {
		slog.Warn("member workspace: login not started", "member", id, "error", err)
		codeCh <- ""
		return
	}
	var once sync.Once
	give := func(code string) { once.Do(func() { codeCh <- code }) }
	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			line := sc.Text()
			if m := deviceCodeRe.FindStringSubmatch(line); m != nil {
				give(m[1])
			}
			if strings.Contains(line, "Press Enter") && stdin != nil {
				_, _ = io.WriteString(stdin, "\n")
			}
		}
	}()
	err := cmd.Wait()
	_ = pw.Close()
	<-scanned
	give("")
	if err != nil {
		slog.Info("member workspace: login ended without authorization", "member", id, "error", err)
		if ctx.Err() != context.Canceled {
			_, _ = e.sendMemberPrivately(t, session, "GitHub 授权没完成（设备码过期或被取消）。要重来就跟我说一声。")
		}
		return
	}
	login := ""
	if out, _, code := runMemberCmd(context.Background(), dir, "", gh, []string{"api", "user", "--jq", ".login"}, nil); code == 0 {
		login = strings.TrimSpace(out)
	}
	_ = os.Chmod(filepath.Join(dir, ".gh-config", "hosts.yml"), 0o600)
	if err := writeMemberGitHubRecord(dir, memberAuthorizedYes, login, "本人 "+time.Now().Format("2006-01-02 15:04")+" 用设备码授权。"); err != nil {
		slog.Warn("member workspace: record not written", "member", id, "error", err)
	}
	slog.Info("member workspace: authorized", "member", id)
	_, _ = e.sendMemberPrivately(t, session, "GitHub 授权好了，账号 "+nonEmpty(login, "（没查到账号名）")+"。以后你让我做 GitHub 上的事，只用你自己的这份授权。")
}

// sendMemberPrivately writes to the person themself and nobody else: their private chat with this bot
// through the `send --dm --to` path (OpenDMSessionFor, #1352); when Discord refuses the DM (they do not
// take DMs from server members), a private thread in the channel of their turn with only them added
// (dmFallbackThread, #1501). Anything else fails: the text is never posted where others can read it.
func (e *Engine) sendMemberPrivately(t callerTurn, session, text string) (string, error) {
	key, _, err := e.OpenDMSessionFor(session, t.userID)
	if err == nil {
		if err = e.SendToSession(key, text); err == nil {
			return "私信发给本人", nil
		}
	}
	if !e.isDMRefused(err) {
		slog.Info("member workspace: private message not delivered", "member", t.platform+"-"+t.userID, "error", err)
		return "", fmt.Errorf("私信发不出去（%v），什么也没发", err)
	}
	tkey, _, terr := e.dmFallbackThread(session, t.userID)
	if terr != nil {
		return "", fmt.Errorf("他不收服务器成员的私信，私密子话题也开不了（%v），什么也没发", terr)
	}
	if err := e.SendToSessionWithOptions(tkey, "<@"+t.userID+"> "+text, nil, nil, SendOptions{}); err != nil {
		return "", fmt.Errorf("私密子话题发送失败（%v）", err)
	}
	return "发到只有他（和服务器管理员）看得到的私密子话题（他不收服务器成员的私信）", nil
}

// ── per-context note ─────────────────────────────────────────────

const memberNoteOn = "（成员个人目录，系统附上，不用回应）这里开了成员个人目录：每个真人一个自己的目录，GitHub 只用发话人自己的授权。" +
	"替人做 GitHub 上的事用 `bothouse member gh …` / `bothouse member git …`：桥按这一轮真实发话人取他本人的授权，他没授权就拒绝；" +
	"不用共享的 gh 登录或令牌，不读别人的目录。他问自己的目录或授权：`bothouse member status`。" +
	"他还没授权、又要做 GitHub 的事：先问他要不要配，他本人同意才跑 `bothouse member login`（设备码桥直接发给他本人，你不转述）。" +
	"他要撤销：`bothouse member logout`。"

const memberNoteOffer = "（推荐，系统附上，不用回应）用户说要搞团队、拉几个人一起用时，顺带推荐开「成员个人目录」：每个进群的人有自己的目录，" +
	"GitHub 各用各的授权，别人那一轮用不了。只有主人点头，才在他发起的那一轮跑 `bothouse member enable`；不点头就不开，也不再提。" +
	"没说要搞团队就不提。"

// memberBlock: once per agent context, how member workspaces work here (on), or the recommendation
// for when the user wants a team (off; lead or a lone role only, the one a user asks to build a team).
func (e *Engine) memberBlock(session *Session) string {
	if session == nil {
		return ""
	}
	note := ""
	switch {
	case e.MemberWorkspacesOn():
		note = memberNoteOn
	case e.memberNoticeTarget():
		note = memberNoteOffer
	default:
		return ""
	}
	key := "on"
	if note == memberNoteOffer {
		key = "offer"
	}
	send := false
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		if t.Member != key {
			t.Member, send = key, true
		}
	})
	if !send {
		return ""
	}
	return note
}
