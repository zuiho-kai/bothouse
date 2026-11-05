package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

// fallbackAgent: a resultAgent that can switch between two models, like G哥's codex.
type fallbackAgent struct {
	resultAgent
	model string
}

func (a *fallbackAgent) SetModel(m string) { a.model = m }
func (a *fallbackAgent) GetModel() string  { return a.model }
func (a *fallbackAgent) AvailableModels(context.Context) []ModelOption {
	return []ModelOption{{Name: "xiao/gpt-6-astra"}, {Name: "xiao/gpt-6.1-sol"}}
}

func TestNextFallbackModel(t *testing.T) {
	both := []string{"xiao/gpt-6-astra", "xiao/gpt-6.1-sol"}
	for _, c := range []struct {
		list    []string
		current string
		want    string
	}{
		{both, "xiao/gpt-6-astra", "xiao/gpt-6.1-sol"},
		{both, "xiao/gpt-6.1-sol", "xiao/gpt-6-astra"}, // wraps: the two back each other up
		{both, "other", "xiao/gpt-6-astra"},
		{[]string{"xiao/gpt-6-astra"}, "xiao/gpt-6-astra", ""},
		{nil, "xiao/gpt-6-astra", ""},
	} {
		if got := nextFallbackModel(c.list, c.current); got != c.want {
			t.Errorf("nextFallbackModel(%v, %q) = %q, want %q", c.list, c.current, got, c.want)
		}
	}
}

func fallbackEngine(t *testing.T, script []string, models []string) (*Engine, *stubPlatformEngine, *capacityScriptSession) {
	t.Helper()
	oldBase, oldCool := rateLimitBackoffBase, capacityCooldownBase
	rateLimitBackoffBase, capacityCooldownBase = time.Millisecond, time.Hour
	t.Cleanup(func() { rateLimitBackoffBase, capacityCooldownBase = oldBase, oldCool })
	sess := &capacityScriptSession{events: make(chan Event, 16), script: script}
	p := &stubPlatformEngine{n: "test"}
	agent := &fallbackAgent{resultAgent: resultAgent{session: sess}, model: "xiao/gpt-6-astra"}
	e := NewEngine("test", agent, []Platform{p}, "", LangEnglish)
	e.SetFallbackModels(models)
	return e, p, sess
}

// Three failures in a row switch to the fallback model, keep the conversation, say so once, and
// re-send the same message on it — no bot-wide cooldown.
func TestFallbackModel_SwitchesAfterRepeatedFailuresAndResends(t *testing.T) {
	e, p, sess := fallbackEngine(t, []string{"rl", "rl", "rl", "on-sol"}, []string{"xiao/gpt-6-astra", "xiao/gpt-6.1-sol"})
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "reply on the fallback model", func() bool { return strings.Contains(joined(p), "reply:on-sol") })
	if n := sess.sends(); n != 4 {
		t.Fatalf("sends = %d, want 4 (3 on astra + 1 on sol)", n)
	}
	for _, s := range sess.sentPrompts() {
		if !strings.Contains(s, "hello") {
			t.Fatalf("the re-send changed the message: %q", s)
		}
	}
	out := joined(p)
	if strings.Count(out, "已切到备用模型 xiao/gpt-6.1-sol") != 1 || !strings.Contains(out, "中转限流（429）") {
		t.Fatalf("want one switch notice naming the reason and the model:\n%s", out)
	}
	if strings.Contains(out, "冷却") || e.capacityWait() != 0 {
		t.Fatalf("switched to a fallback but still cooled down:\n%s", out)
	}
	if got := e.sessionModelFor("test:c1"); got != "xiao/gpt-6.1-sol" {
		t.Fatalf("session model = %q, want the fallback saved for this session", got)
	}
}

// The fallback failing the same way does not switch back (no ping-pong): the normal cooldown runs.
func TestFallbackModel_OneSwitchPerStreakThenCooldown(t *testing.T) {
	e, p, sess := fallbackEngine(t, []string{"rl", "rl", "rl", "rl", "rl", "rl"}, []string{"xiao/gpt-6-astra", "xiao/gpt-6.1-sol"})
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "cooldown after the fallback failed too", func() bool { return e.capacityWait() > 0 })
	if n := sess.sends(); n != 6 {
		t.Fatalf("sends = %d, want 6", n)
	}
	waitFor(t, "cooldown notice", func() bool { return strings.Contains(joined(p), "冷却") })
	if c := strings.Count(joined(p), "已切到备用模型"); c != 1 {
		t.Fatalf("switch notices = %d, want 1:\n%s", c, joined(p))
	}
}

// No fallback_models (the default): behaviour is unchanged, three failures cool down.
func TestFallbackModel_EmptyListNeverSwitches(t *testing.T) {
	e, p, _ := fallbackEngine(t, []string{"rl", "rl", "rl"}, nil)
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "cooldown notice", func() bool { return strings.Contains(joined(p), "冷却") })
	if strings.Contains(joined(p), "备用模型") || e.sessionModelFor("test:c1") != "" {
		t.Fatalf("switched without fallback_models:\n%s", joined(p))
	}
}

// An "at capacity" re-send now waits a backoff step first instead of going out at once.
func TestCapacityRetry_AtCapacityWaitsBeforeResend(t *testing.T) {
	old := rateLimitBackoffBase
	rateLimitBackoffBase = time.Hour // full jitter over an hour: no re-send within the window below
	t.Cleanup(func() { rateLimitBackoffBase = old })
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "second"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "first send", func() bool { return sess.sends() >= 1 })
	time.Sleep(200 * time.Millisecond)
	if n := sess.sends(); n != 1 {
		t.Fatalf("sends = %d within 200ms, want 1: at capacity must wait before re-sending", n)
	}
}

func TestRetryOnceErrorFromLiveLogs(t *testing.T) {
	once := []string{
		"acp: prompt did not complete successfully",
		"json-rpc -32603: Internal error: turn failed: 原模型请求失败：上游模型请求失败；已完成的工具操作可能已生效，请先核对成果。",
		"json-rpc -32603: Internal error: turn failed: 公开答复生成失败；工具操作可能已完成，请核对成果后再要求补充结论。",
	}
	never := []string{
		"antigravity: stream turn failed (ERROR; command_step=9965 exit_code=1 kind=shell-or-unknown nonzero_commands=1)",
		"codex app-server: turn interrupted",
		"json-rpc -32603: Internal error: turn failed: 原模型请求失败：上游认证失败；已完成的工具操作可能已生效，请先核对成果。",
	}
	for _, m := range once {
		if !isRetryOnceError(m) || isTransientError(m) {
			t.Errorf("want exactly one re-send for %q", m)
		}
	}
	for _, m := range never {
		if isRetryOnceError(m) || isTransientError(m) || isModelCapacityError(m) {
			t.Errorf("must not retry: %q", m)
		}
	}
}

// A retry-once error gets one re-send; when that works the user sees only the answer.
func TestRetryOnce_SecondSendSucceeds(t *testing.T) {
	old := rateLimitBackoffBase
	rateLimitBackoffBase = time.Millisecond
	t.Cleanup(func() { rateLimitBackoffBase = old })
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"once", "fine"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "second send reply", func() bool { return strings.Contains(joined(p), "reply:fine") })
	if n := sess.sends(); n != 2 {
		t.Fatalf("sends = %d, want 2", n)
	}
	if out := joined(p); strings.Contains(out, "公开答复生成失败") || strings.Contains(out, "冷却") {
		t.Fatalf("the first failure leaked or cooled down:\n%s", out)
	}
}

// A second failure is a normal one: reported, no third send, no cooldown.
func TestRetryOnce_SecondFailureIsNormalError(t *testing.T) {
	old := rateLimitBackoffBase
	rateLimitBackoffBase = time.Millisecond
	t.Cleanup(func() { rateLimitBackoffBase = old })
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"once", "once", "never"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "error reported", func() bool { return strings.Contains(joined(p), "公开答复生成失败") })
	time.Sleep(100 * time.Millisecond)
	if n := sess.sends(); n != 2 {
		t.Fatalf("sends = %d, want 2 (one re-send only)", n)
	}
	if strings.Contains(joined(p), "冷却") || e.capacityWait() != 0 {
		t.Fatalf("a retry-once failure must not cool down:\n%s", joined(p))
	}
}
