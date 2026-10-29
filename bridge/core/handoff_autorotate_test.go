package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The context-size rule leaves workspace channels alone, yields to auto_compress, and clears the
// agent context's sent marks (TurnCtx) like any fresh start, so the first turn of the new context
// gets the per-context blocks (team rules, wiki pages) again.
func TestFreshOnContextSizeScope(t *testing.T) {
	a := &handoffStubAgent{handoffs: map[string]*SessionHandoff{
		"big": {Path: "/x/big.jsonl", LastActivity: time.Now().Add(-time.Minute), ContextTokens: 312000},
	}}
	e := NewEngine("test", a, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangEnglish)
	defer e.Stop()
	e.SetColdCacheFresh(true, time.Hour, 80000, 300000)
	e.workspaceChatForTest = func(s string) bool { return teamChatKey(s) == "discord:ws1" }

	ws := &Session{AgentSessionID: "big"}
	if n := e.freshOnContextSize(a, ws, "discord:ws1"); n != "" || ws.GetAgentSessionID() != "big" {
		t.Fatalf("workspace channel must keep its session, got %q", n)
	}

	e.SetAutoCompressConfig(true, 200000, time.Minute)
	chat := &Session{AgentSessionID: "big"}
	if n := e.freshOnContextSize(a, chat, "discord:chat1"); n != "" || chat.GetAgentSessionID() != "big" {
		t.Fatalf("auto_compress on: must not start fresh, got %q", n)
	}
	e.SetAutoCompressConfig(false, 0, 0)

	chat.TurnCtx = &TurnCtxSent{Wiki: []string{"a.md"}, Team: "k"}
	if n := e.freshOnContextSize(a, chat, "discord:chat1"); !strings.Contains(n, "31.2 万") {
		t.Fatalf("chat channel: notice = %q", n)
	}
	if chat.GetAgentSessionID() != "" || chat.HandoffFrom != "big" || chat.TurnCtx != nil {
		t.Fatalf("agent id %q handoff %q turnctx %+v", chat.GetAgentSessionID(), chat.HandoffFrom, chat.TurnCtx)
	}
}

// The check sits in getOrCreateInteractiveStateWith (before a new message's turn); the event
// loop drains queued messages without coming back there, so a queue keeps its context and the
// switch happens on the first new message after it. Pin the key → channel mapping it relies on.
func TestContextFreshChat(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	for key, want := range map[string]string{
		"discord:chat1:u1":       "discord:chat1",
		"discord:chat1":          "discord:chat1",
		"/w/repo:discord:ws1:u1": "discord:ws1",
		"weixin:abc:u1":          "weixin:abc",
	} {
		if got := contextFreshChat(p, key); got != want {
			t.Fatalf("contextFreshChat(%q) = %q, want %q", key, got, want)
		}
	}
}

func TestHandoffSection(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "h.md")
	os.WriteFile(f, []byte("# 标题\n\n## 总目标\n让 Discord 主会话\n不再混话题\n\n第二段\n\n## 用户原话\n「第一句」\n\n「第二句」\n"), 0o600)
	if got := handoffSection(f, "总目标"); got != "让 Discord 主会话\n不再混话题\n\n第二段" {
		t.Fatalf("总目标 = %q", got)
	}
	if got := firstParagraph(handoffSection(f, "用户原话")); got != "「第一句」" {
		t.Fatalf("first 用户原话 paragraph = %q", got)
	}
	if got := handoffUserWords(f); got != "「第一句」\n「第二句」" {
		t.Fatalf("handoffUserWords = %q", got)
	}
	for _, p := range []string{"", "rel/h.md", filepath.Join(dir, "missing.md")} {
		if got := handoffSection(p, "总目标"); got != "" {
			t.Fatalf("%q: %q", p, got)
		}
	}
	if got := handoffSection(f, "相关改动"); got != "" {
		t.Fatalf("absent section = %q", got)
	}
}

// The handoff lists every open item of the channel, one line each, and nothing of other channels
// or finished items.
func TestHandoffBlockListsChannelTasks(t *testing.T) {
	dir := t.TempDir()
	withGoal := filepath.Join(dir, "a.md")
	os.WriteFile(withGoal, []byte("## 总目标\n会话过阈值自动换新\n\n## 用户原话\n「快速」\n"), 0o600)
	noGoal := filepath.Join(dir, "b.md")
	os.WriteFile(noGoal, []byte("## 用户原话\n「回复任务卡要带上下文」\n\n「别的」\n"), 0o600)
	board := strings.Join([]string{
		`{"id":11,"what":"自动换新","short":"自动换新","sk":"discord:chat1","where":"` + withGoal + `","status":"改完 handoff.go，待测"}`,
		`{"id":12,"what":"任务卡上下文","short":"卡片上下文","sk":"discord:chat1","where":"` + noGoal + `","paused":"10-29 10:00","pause_why":"等用户拍板"}`,
		`{"id":13,"what":"别的频道的活","sk":"discord:chat2","status":"在做"}`,
		`{"id":14,"what":"已做完","sk":"discord:chat1","status":"完成 已合"}`,
	}, "\n") + "\n"
	writeTaskBoard(t, dir, teamTaskBoardFile, board)

	a := &handoffStubAgent{handoffs: map[string]*SessionHandoff{
		"old": {Path: "/x/old.jsonl", ContextTokens: 312000},
	}}
	e := NewEngine("test", a, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangEnglish)
	defer e.Stop()
	e.SetTeam(dir, "橘", false)

	s := &Session{}
	s.SetHandoffFrom("old", "上下文约 31.2 万 token")
	b := e.handoffBlock(s, "discord:chat1:u1")
	for _, want := range []string{
		"## 本频道没做完的活",
		"#11 自动换新 · 总目标：会话过阈值自动换新 · 停点：改完 handoff.go，待测",
		"#12 卡片上下文 · 总目标：（交接没写）任务卡上下文；用户原话：「回复任务卡要带上下文」 · 停点：暂停 10-29 10:00（等用户拍板）",
	} {
		if !strings.Contains(b, want) {
			t.Fatalf("handoff lacks %q:\n%s", want, b)
		}
	}
	for _, bad := range []string{"#13", "#14", "「别的」"} {
		if strings.Contains(b, bad) {
			t.Fatalf("handoff has %q:\n%s", bad, b)
		}
	}
	if !strings.HasSuffix(b, handoffEnd) {
		t.Fatalf("task list must sit inside the handoff:\n%s", b)
	}
}
