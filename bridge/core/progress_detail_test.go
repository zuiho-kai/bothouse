package core

import (
	"context"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// detailTestPlatform is a card-style platform whose detail level the tests set.
type detailTestPlatform struct {
	previewCapturePlatform
	detail string
}

func (p *detailTestPlatform) Name() string                             { return "test" }
func (p *detailTestPlatform) Start(MessageHandler) error               { return nil }
func (p *detailTestPlatform) Reply(context.Context, any, string) error { return nil }
func (p *detailTestPlatform) Send(context.Context, any, string) error  { return nil }
func (p *detailTestPlatform) Stop() error                              { return nil }
func (p *detailTestPlatform) ProgressStyle() string                    { return progressStyleCard }
func (p *detailTestPlatform) ProgressCardDetail() string               { return p.detail }

func newDetailWriter(t *testing.T, detail string) (*compactProgressWriter, *detailTestPlatform) {
	t.Helper()
	p := &detailTestPlatform{detail: detail}
	w := newCompactProgressWriter(context.Background(), p, progressHintReplyCtx{style: progressStyleCard, payload: true}, "cc", LangChinese, nil)
	if !w.enabled || !w.usePayload {
		t.Fatalf("writer should be enabled with payload (enabled=%v usePayload=%v)", w.enabled, w.usePayload)
	}
	return w, p
}

func parsedLatest(t *testing.T, w *compactProgressWriter) *ProgressCardPayload {
	t.Helper()
	payload, ok := ParseProgressCardPayload(w.lastSent)
	if !ok {
		t.Fatalf("bad payload: %q", w.lastSent)
	}
	return payload
}

func TestProgressThinkingEventsMergeIntoOneItem(t *testing.T) {
	w, _ := newDetailWriter(t, "brief")
	w.AppendEvent(ProgressEntryThinking, "先看代码结构。", "", "先看代码结构。")
	w.AppendEvent(ProgressEntryThinking, "再想怎么改。", "", "再想怎么改。")

	payload := parsedLatest(t, w)
	if len(payload.Items) != 1 {
		t.Fatalf("items = %d, want 1 merged thinking item: %#v", len(payload.Items), payload.Items)
	}
	if payload.Items[0].Kind != ProgressEntryThinking {
		t.Fatalf("kind = %q, want thinking", payload.Items[0].Kind)
	}
	if got, want := payload.Items[0].Text, "先看代码结构。\n再想怎么改。"; got != want {
		t.Fatalf("merged text = %q, want %q", got, want)
	}
	if len(payload.Entries) != 1 {
		t.Fatalf("fallback entries = %d, want 1", len(payload.Entries))
	}
}

func TestProgressThinkingTruncationByDetail(t *testing.T) {
	long := strings.Repeat("想", 500)
	w, _ := newDetailWriter(t, "brief")
	w.AppendEvent(ProgressEntryThinking, long, "", long)
	payload := parsedLatest(t, w)
	got := payload.Items[0].Text
	if n := utf8.RuneCountInString(got); n > 400 {
		t.Fatalf("brief thinking = %d runes, want <= 400", n)
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("brief thinking should end with …: %q", got[len(got)-10:])
	}

	mid := strings.Repeat("想", 800)
	w2, _ := newDetailWriter(t, "full")
	w2.AppendEvent(ProgressEntryThinking, mid, "", mid)
	got2 := parsedLatest(t, w2).Items[0].Text
	if utf8.RuneCountInString(got2) != 800 || strings.HasSuffix(got2, "…") {
		t.Fatalf("full thinking = %d runes (…=%v), want 800 untouched", utf8.RuneCountInString(got2), strings.HasSuffix(got2, "…"))
	}
}

func TestProgressToolResultOutputOnlyInFull(t *testing.T) {
	ok := true
	res := ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Bash", Text: " 3 files changed\n 40 insertions ", Success: &ok}

	w, bp := newDetailWriter(t, "brief")
	w.AppendEvent(res.Kind, res.Text, res.Tool, "")
	if w.lastSent != "" {
		for _, item := range parsedLatest(t, w).Items {
			if strings.Contains(item.Text, "🧾") {
				t.Fatalf("brief card must not show tool output: %#v", item)
			}
		}
	}
	if len(bp.started) > 0 && strings.Contains(bp.started[0], "🧾") {
		t.Fatalf("brief card started with tool output: %q", bp.started[0])
	}

	w2, _ := newDetailWriter(t, "full")
	w2.AppendStructured(res, "")
	payload := parsedLatest(t, w2)
	if len(payload.Items) == 0 || payload.Items[len(payload.Items)-1].Kind != ProgressEntryToolResult {
		t.Fatalf("full card items = %#v, want a tool_result item", payload.Items)
	}
	if len(w2.entries) == 0 || !strings.HasPrefix(w2.entries[len(w2.entries)-1], "🧾 输出 · ") {
		t.Fatalf("full card entries = %#v, want 🧾 输出 line", w2.entries)
	}
	if !strings.Contains(w2.entries[len(w2.entries)-1], "3 files changed 40 insertions") {
		t.Fatalf("full tool output lost its text: %q", w2.entries[len(w2.entries)-1])
	}
}

func TestProgressPayloadMaxStepsAndThinkLen(t *testing.T) {
	w, _ := newDetailWriter(t, "brief")
	w.AppendEvent(ProgressEntryThinking, "plan", "", "plan")
	brief := parsedLatest(t, w)
	if brief.MaxSteps != ProgressCardVisibleSteps || brief.ThinkLen != 400 {
		t.Fatalf("brief max_steps/think_len = %d/%d, want %d/400", brief.MaxSteps, brief.ThinkLen, ProgressCardVisibleSteps)
	}

	w2, _ := newDetailWriter(t, "full")
	w2.AppendEvent(ProgressEntryThinking, "plan", "", "plan")
	full := parsedLatest(t, w2)
	if full.MaxSteps != 8 || full.ThinkLen != 1200 {
		t.Fatalf("full max_steps/think_len = %d/%d, want 8/1200", full.MaxSteps, full.ThinkLen)
	}
}

func TestSummarizeProgressStepDetailMatchesBrief(t *testing.T) {
	ok := true
	item := ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Bash", Text: "done", Success: &ok}
	if got := SummarizeProgressStepDetail(item, "zh", progressStepTargetMax, false); got != SummarizeProgressStep(item, "zh") {
		t.Fatalf("brief detail = %q, want same as SummarizeProgressStep", got)
	}
	if got := SummarizeProgressStepDetail(ProgressCardEntry{Kind: ProgressEntryToolResult, Text: "   "}, "zh", progressStepTargetMax, true); got != "" {
		t.Fatalf("empty output = %q, want empty line", got)
	}
}

// sizedDetailPlatform adds progress_card_entries to detailTestPlatform.
type sizedDetailPlatform struct {
	detailTestPlatform
	entries int
}

func (p *sizedDetailPlatform) ProgressCardEntries() int       { return p.entries }
func (p *sizedDetailPlatform) ProgressCardLineLen() int       { return 80 }
func (p *sizedDetailPlatform) ProgressCardHideThinking() bool { return false }

func TestProgressCardEntriesExplicitOneKeepsOneStep(t *testing.T) {
	for _, tc := range []struct {
		detail  string
		entries int
		want    int
	}{
		{"brief", 0, ProgressCardVisibleSteps}, // unset: default 3
		{"brief", 1, 1},                        // explicit 1 is honoured
		{"brief", 6, 6},
		{"full", 1, 8}, // full shows at least 8
		{"full", 12, 12},
	} {
		p := &sizedDetailPlatform{detailTestPlatform: detailTestPlatform{detail: tc.detail}, entries: tc.entries}
		w := newCompactProgressWriter(context.Background(), p, progressHintReplyCtx{style: progressStyleCard, payload: true}, "cc", LangChinese, nil)
		if got := w.maxSteps(); got != tc.want {
			t.Errorf("detail=%s entries=%d: maxSteps = %d, want %d", tc.detail, tc.entries, got, tc.want)
		}
	}
}

func TestProgressStepTextsFollowCardLanguage(t *testing.T) {
	use := ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Read", Text: `{"file_path":"/a/b/main.go"}`}
	failed := false
	res := ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Bash", Success: &failed}
	for lang, want := range map[string][2]string{
		"zh":    {"📖 读文件 · main.go", "⚠️ 失败 · 运行命令"},
		"zh-TW": {"📖 讀檔案 · main.go", "⚠️ 失敗 · 執行命令"},
		"ja":    {"📖 ファイル読込 · main.go", "⚠️ 失敗 · コマンド実行"},
		"es":    {"📖 Leer · main.go", "⚠️ falló · Ejecutar"},
		"en":    {"📖 Read · main.go", "⚠️ failed · Run"},
	} {
		if got := SummarizeProgressStep(use, lang); got != want[0] {
			t.Errorf("%s tool use = %q, want %q", lang, got, want[0])
		}
		if got := SummarizeProgressStep(res, lang); got != want[1] {
			t.Errorf("%s failed result = %q, want %q", lang, got, want[1])
		}
	}
	ok := true
	out := ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Bash", Text: "PASS", Success: &ok}
	if got := SummarizeProgressStepDetail(out, "en", 40, true); got != "🧾 Output · PASS" {
		t.Errorf("full output line in English = %q", got)
	}
}

func TestProgressLiveLineFollowsCardLanguage(t *testing.T) {
	for lang, want := range map[string]string{
		"zh":    "⚠️ 疑似卡住 · 已 12分34秒 · 当前：Bash · 最近动静 10分10秒前",
		"zh-TW": "⚠️ 疑似卡住 · 已 12分34秒 · 目前：Bash · 最近動靜 10分10秒前",
		"ja":    "⚠️ 停止の疑い · 経過 12分34秒 · 実行中：Bash · 最終イベント 10分10秒前",
		"es":    "⚠️ posiblemente atascado · 12m34s · ahora: Bash · último evento hace 10m10s",
		"en":    "⚠️ possibly stalled · 12m34s · now: Bash · last event 10m10s ago",
	} {
		if got := ProgressLiveLine(lang, 754, 610, "Bash", true); got != want {
			t.Errorf("%s live line = %q, want %q", lang, got, want)
		}
	}
	if got := ProgressLiveLine("en", 3700, 0, "", false); got != "⏳ still running · 1h1m" {
		t.Errorf("hour format = %q", got)
	}
}

func TestProgressCardI18nKeysHaveEveryLanguage(t *testing.T) {
	for _, key := range []MsgKey{
		MsgProgressVerbShell, MsgProgressVerbRead, MsgProgressVerbEdit, MsgProgressVerbWrite,
		MsgProgressVerbSearch, MsgProgressVerbGlob, MsgProgressVerbFetch, MsgProgressVerbWebSearch,
		MsgProgressVerbAgent, MsgProgressVerbTodo, MsgProgressVerbTool, MsgProgressStepFailed,
		MsgProgressStepOutput, MsgProgressLiveRunning, MsgProgressLiveStalled, MsgProgressLiveElapsed,
		MsgProgressLiveCurrent, MsgProgressLiveIdle, MsgProgressDurHM, MsgProgressDurMS, MsgProgressDurS,
	} {
		for _, lang := range []Language{LangEnglish, LangChinese, LangTraditionalChinese, LangJapanese, LangSpanish} {
			if strings.TrimSpace(messages[key][lang]) == "" {
				t.Errorf("%s has no %s text", key, lang)
			}
		}
	}
}

// legacyFullDetailPlatform is a legacy-style (no card) platform that still reports full detail.
type legacyFullDetailPlatform struct{ stubPlatformEngine }

func (p *legacyFullDetailPlatform) ProgressCardDetail() string { return "full" }

func TestProgressCardDetailFullLeavesPlainThinkingMessagesAlone(t *testing.T) {
	p := &legacyFullDetailPlatform{stubPlatformEngine{n: "telegram"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{ThinkingMessages: true, ThinkingMaxLen: 20, ToolMaxLen: 500, ToolMessages: true})
	key := "telegram:full-legacy"
	session := e.sessions.GetOrCreateActive(key)
	as := newControllableSession("s-full-legacy")
	state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx-full-legacy"}
	e.interactiveStates[key] = state
	long := strings.Repeat("想", 100)
	as.events <- Event{Type: EventThinking, Content: long}
	as.events <- Event{Type: EventResult, Content: "done", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)
	seen := false
	for _, m := range p.getSent() {
		if n := strings.Count(m, "想"); n > 0 {
			seen = true
			if n > 20 {
				t.Fatalf("thinking message kept %d runes; thinking_max_len (20) must hold outside cards: %q", n, m)
			}
		}
	}
	if !seen {
		t.Fatalf("no thinking message sent: %#v", p.getSent())
	}
}
