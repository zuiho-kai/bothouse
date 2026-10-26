package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type exitSent struct{ rc, text string }

type exitTestPlatform struct {
	inputTestPlatform
	mu  sync.Mutex
	out []exitSent
}

func (p *exitTestPlatform) Send(_ context.Context, rc any, content string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, _ := rc.(string)
	p.out = append(p.out, exitSent{s, content})
	return nil
}
func (p *exitTestPlatform) Reply(ctx context.Context, rc any, content string) error {
	return p.Send(ctx, rc, content)
}
func (p *exitTestPlatform) sentTo(rc string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []string
	for _, s := range p.out {
		if s.rc == rc {
			out = append(out, s.text)
		}
	}
	return out
}

type mapParent map[string]string

func (m mapParent) WorkspaceParent(id string) (string, bool) { p, ok := m[id]; return p, ok }

const (
	exitWSKey   = "discord:ws1:u1"
	exitChatKey = "discord:chat1:u1"
)

func exitFixture(t *testing.T, parents WorkspaceParentResolver) (*Engine, *inputTestAgent, *exitTestPlatform) {
	t.Helper()
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	if parents != nil {
		e.SetWorkspaceParentResolver(parents)
	}
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	return e, ag, p
}

func exitSay(e *Engine, p Platform, key, channel, content string) {
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "discord", ChannelID: channel, MessageID: content, UserID: "human", UserName: "瑞凤", Content: content, Mentioned: true, ReplyCtx: key})
}

func TestTeamModeRulesInEveryPrompt(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)
	exitSay(e, p, exitWSKey, "ws1", "开始")
	prompt := inputPrompt(t, a)
	for _, want := range []string{"[团队模式规矩", "聊天频道要保持畅通", "预计超过 10 分钟", "接活这一轮就写交接", "跑 `ws-handoff <交接文件> \"<任务>\"`", "不算开子 agent", "/collab/api/rooms/{聊天频道 id}/workspaces", "默认达到 3 件就算忙", "多步骤的活先开公开任务卡", "`/bind <队友项目名>`", "机器人自己发的 /bind 不生效", "拿不准的设定", "主角色拿不准也一样", "写的人不验收自己的活", "派活方式：混合", "[ask]", "[report]", "参照的现成实现", "「无（新建）」", "写明底分支", "改公共接口的那份先合", "每 10 分钟前推一次半成品分支", "「自验：」", "「类别：」", "方向、花钱、需要用户看的成品、权限确认", "在发布包上验", "审过的 PR 当场合", "整点只做发版、重启和真实入口验证", "真实配置的副本（去掉密钥）", "回到改前配置"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("team rules missing %q in %q", want, prompt)
		}
	}
	inputDone(a, "ok")
	// One source: the embedded copy is the DSH member file.
	src, err := os.ReadFile(filepath.Join("..", "..", "dsh", "collab", "team-mode-rules.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(src) != teamModeRulesText {
		t.Fatal("dsh/collab/team-mode-rules.md and the embedded dsh_bundle copy differ")
	}
}

func TestWorkspaceAskForwardsAndAnswerGoesBack(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", false)
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[ask]\n用 A 还是 B？<@123> 看一下\n自验：无需\n类别：方向")
	inputWait(t, func() bool { return len(p.sentTo("discord:chat1")) == 1 })
	fwd := p.sentTo("discord:chat1")[0]
	if !strings.HasPrefix(fwd, "📬") || !strings.Contains(fwd, "<#ws1>") || !strings.Contains(fwd, "「橘」") || !strings.Contains(fwd, "用 A 还是 B？") {
		t.Fatalf("forward = %q", fwd)
	}
	// A visible record only: it must not ping anyone (other bots drop 📬 notices).
	if strings.Contains(fwd, "<@123>") {
		t.Fatalf("forward pings a user: %q", fwd)
	}
	id := askRef.FindString(fwd)
	if id == "" {
		t.Fatalf("no ask id in %q", fwd)
	}
	inputWait(t, func() bool { return len(p.sentTo(exitWSKey)) > 0 })
	if ws := p.sentTo(exitWSKey); len(ws) != 1 || !strings.HasPrefix(ws[0], "[ask]") {
		t.Fatalf("workspace original not kept: %q", ws)
	}

	// The user replies to the forward in the chat channel (Discord quotes it).
	exitSay(e, p, exitChatKey, "chat1", "[replying to 橘: "+fwd+"]\n用 A")
	prompt := inputPrompt(t, a)
	if !strings.Contains(prompt, "在聊天频道回复了你的提问 "+id) || !strings.HasSuffix(strings.TrimSpace(prompt), "用 A") {
		t.Fatalf("answer not delivered to the asking bot: %q", prompt)
	}
	if strings.Contains(prompt, "用 A 还是 B") {
		t.Fatalf("reply quote not stripped: %q", prompt)
	}
	ws := p.sentTo(exitWSKey)
	if len(ws) != 2 || !strings.HasPrefix(ws[1], "📬") || !strings.Contains(ws[1], id) || !strings.HasSuffix(ws[1], "用 A") {
		t.Fatalf("answer not posted in workspace: %q", ws)
	}
	if idToKey, _ := e.sessions.SessionKeyMap(); func() bool {
		for _, k := range idToKey {
			if k == exitChatKey {
				return true
			}
		}
		return false
	}() {
		t.Fatal("the answer started a turn in the chat channel")
	}
	inputDone(a, "好，用 A 继续")
	inputWait(t, func() bool { return len(p.sentTo(exitWSKey)) == 3 })
	if got := p.sentTo(exitWSKey)[2]; got != "好，用 A 继续" {
		t.Fatalf("bot reply went elsewhere: %q", got)
	}
	if len(p.sentTo("discord:chat1")) != 1 || len(p.sentTo(exitChatKey)) != 0 {
		t.Fatal("chat channel got extra messages")
	}
}

func TestWorkspaceReportForwardsOnly(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[report]\n第一阶段做完")
	inputWait(t, func() bool { return len(p.sentTo("discord:chat1")) == 1 })
	fwd := p.sentTo("discord:chat1")[0]
	if !strings.Contains(fwd, "阶段结果") || askRef.MatchString(fwd) {
		t.Fatalf("report forward = %q", fwd)
	}
	if n := len(e.teamExit.asks); n != 0 {
		t.Fatalf("report recorded %d asks", n)
	}
}

func TestNoParentNoForward(t *testing.T) {
	e, a, p := exitFixture(t, nil) // default resolver: no recorded workspace, exit off
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[ask]\n问一下")
	inputWait(t, func() bool { return len(p.sentTo(exitWSKey)) == 1 })
	if len(p.out) != 1 {
		t.Fatalf("forwarded without a parent: %+v", p.out)
	}
}

// The default resolver is the engine itself: a workspace recorded by block D
// forwards without any SetWorkspaceParentResolver call (PR #138 review 1).
func TestWorkspaceExitDefaultResolverUsesRecordedWorkspaces(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Parents: map[string][]TeamWorkspace{
		"discord:chat1": {{Name: "工作区1", ID: "ws1"}},
	}, Version: teamWorkspaceStateVersion})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[report]\n第一阶段做完")
	inputWait(t, func() bool { return len(p.sentTo("discord:chat1")) == 1 })
	if fwd := p.sentTo("discord:chat1")[0]; !strings.HasPrefix(fwd, "📬") || !strings.Contains(fwd, "第一阶段做完") {
		t.Fatalf("forward = %q", fwd)
	}
}

func TestAskSurvivesRestart(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	id := e.forwardWorkspaceExit(p, exitWSKey, "[ask] 选哪个\n自验：go test ./core 通过\n类别：验收")
	if id == "" {
		t.Fatal("no ask")
	}
	e2 := NewEngine("orange", e.agent, []Platform{p}, "", LangEnglish)
	e2.dataDir = e.dataDir
	t.Cleanup(func() { e2.cancel(); _ = e2.Stop() })
	if a := e2.takeAsk(id, "discord", "chat1"); a == nil || a.SessionKey != exitWSKey {
		t.Fatalf("ask lost on restart: %+v", a)
	}
	if e2.takeAsk(id, "discord", "chat1") != nil {
		t.Fatal("answered ask still open")
	}
}

func TestParseExitKind(t *testing.T) {
	for in, want := range map[string]string{"[ask]\nx": "ask", "  [REPORT] y": "report", "[ask]": "", "ask x": "", "x\n[ask]\ny": ""} {
		k, _, _ := parseExitKind(in)
		if k != want {
			t.Errorf("parseExitKind(%q) = %q, want %q", in, k, want)
		}
	}
}

// Only the configured mode's section is injected (PR #138 review 4).
func TestTeamModeRulesOnlyCurrentMode(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetDispatchMode(DispatchSolo)
	exitSay(e, p, exitWSKey, "ws1", "开始")
	prompt := inputPrompt(t, a)
	inputDone(a, "ok")
	if !strings.Contains(prompt, "单模型多进程") || strings.Contains(prompt, "先当面派给成员") || strings.Contains(prompt, "## ") {
		t.Fatalf("solo prompt: %q", prompt)
	}
	for mode, want := range map[string]string{DispatchTeam: "派活方式：完全团队", DispatchMixed: "派活方式：混合", "bogus": "派活方式：混合"} {
		r := teamModeRulesFor(mode)
		if !strings.Contains(r, want) || !strings.Contains(r, "成员空着时先当面派给成员") || !strings.Contains(r, "reason 字段") || !strings.Contains(r, "同时带 ref（参照实现：文件:行") || !strings.Contains(r, "带 base（底分支名）") {
			t.Fatalf("%s rules: %q", mode, r)
		}
	}
	if teamModeRulesFor(DispatchTeam) == teamModeRulesFor(DispatchMixed) {
		t.Fatal("team and mixed share one section")
	}
}

// The three collaboration conventions must reach every bot in every dispatch mode: a
// teammate has to know the four stances, how to call another member, and that task
// dispatch already reminds the owner. Sources: task stances dsh/collab/tasks.mjs
// (STANCE_LINE), mention forms dsh/collab/mentions.mjs (CALL_PUNCT), auto reminder
// tasks.mjs CHECK_AFTER_S in assign().
func TestTeamModeRulesCarryCollaborationConventions(t *testing.T) {
	for _, mode := range []string{DispatchSolo, DispatchTeam, DispatchMixed} {
		r := teamModeRulesFor(mode)
		for _, want := range []string{
			"【接】", "【问】", "【退】", "【升】", // the four stances
			"@名字", "行首", // how to call a teammate
			"自动催", "不用自己再挂计时", // dispatch already reminds; only task dispatch does
		} {
			if !strings.Contains(r, want) {
				t.Fatalf("%s rules missing %q:\n%s", mode, want, r)
			}
		}
		if strings.Contains(r, "每个平台") || strings.Contains(r, "所有平台") {
			t.Fatalf("%s rules claim every platform reminds: %q", mode, r)
		}
	}
}
