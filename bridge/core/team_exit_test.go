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
	for _, want := range []string{"[团队模式规矩", "聊天频道要保持畅通", "工作区 n+1", "/collab/api/rooms/{聊天频道 id}/workspaces", "主角色或正在干活的角色决定", "达到 6 件", "[ask]", "[report]"} {
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
	if strings.TrimSpace(string(src)) != teamModeRules {
		t.Fatal("dsh/collab/team-mode-rules.md and the embedded dsh_bundle copy differ")
	}
}

func TestWorkspaceAskForwardsAndAnswerGoesBack(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", false)
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[ask]\n用 A 还是 B？<@123> 看一下")
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
	e, a, p := exitFixture(t, nil) // default: D not wired, exit off
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[ask]\n问一下")
	inputWait(t, func() bool { return len(p.sentTo(exitWSKey)) == 1 })
	if len(p.out) != 1 {
		t.Fatalf("forwarded without a parent: %+v", p.out)
	}
}

func TestAskSurvivesRestart(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	id := e.forwardWorkspaceExit(p, exitWSKey, "[ask] 选哪个")
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
