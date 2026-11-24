package core

import (
	"strings"
	"testing"
	"time"
)

const itemsBody = "[report] #46 背景：你让我修材料。\n看完了，都写进逐条。\n要你做的：没有。\n给你的：无\n我加的：无\n细节：\n材料逐条：\n" +
	"1. 知乎：它在四十多个分身里派活打编程比赛，奖金按贡献分。\n" +
	"2. 情绪引擎：信任分六档，吃醋和记忆没有关系。\n" +
	"3. 免疫系统：证据推翻后，下游的结论一起作废。\n"

// Only the 「材料逐条：」 heading counts (#1949): a four-part section that merely says 「逐条」
// posts nothing extra, so #1948's mistake (a replayed片段 from the details) cannot come back.
func TestChatItemsNeedsTheHeading(t *testing.T) {
	if got := chatItems(itemsBody); len(got) != 1 || !strings.HasPrefix(got[0], "材料逐条：\n1. 知乎") {
		t.Fatalf("heading block = %q", got)
	}
	body := "[report] #46 背景：你让我修材料。\n看完了，十条都写在细节的逐条里。\n要你做的：没有。\n给你的：无\n我加的：无\n细节：\n" +
		"1. 知乎：它在四十多个分身里派活打编程比赛，奖金按贡献分。\n"
	if got := chatItems(body); got != nil {
		t.Fatalf("a mention of 逐条 outside the heading posted %q", got)
	}
	if got := chatItems(acceptBody); got != nil {
		t.Fatalf("a plain report posted %q", got)
	}
}

// #1953: a 「材料逐条：」 inside a ``` fence (pasted test output in the details) is not posted;
// the real block outside the fence still is.
func TestChatItemsSkipsCodeFences(t *testing.T) {
	sample := "细节：\n入口自验：\n```\n材料逐条：\n1. 隔离甲：样例一。\n2. 隔离乙：样例二。\n```\n"
	body := "[report] #1949 背景：修超时。\n做完了。\n要你做的：没有。\n给你的：无\n我加的：无\n" + sample
	if got := chatItems(body); got != nil {
		t.Fatalf("fenced sample posted %q", got)
	}
	got := chatItems(itemsBody + sample)
	if len(got) != 1 || !strings.Contains(got[0], "3. 免疫系统") || strings.Contains(got[0], "隔离") {
		t.Fatalf("real block with a fenced sample = %q", got)
	}
	got = chatItems("[report] #46 背景：x\n细节：\n" + sample + "材料逐条：\n1. 知乎：真条目。\n")
	if len(got) != 1 || got[0] != "材料逐条：\n1. 知乎：真条目。" {
		t.Fatalf("real block after a fence = %q", got)
	}
}

// Long rows split under the message limit, heading on the first message only.
func TestChatItemsSplitsUnderLimit(t *testing.T) {
	row := "1. 知乎：" + strings.Repeat("长", chatItemLimit)
	got := chatItems("材料逐条：\n" + row + "\n")
	if len(got) < 2 {
		t.Fatalf("long row not split: %d messages", len(got))
	}
	if !strings.HasPrefix(got[0], "材料逐条：") {
		t.Fatalf("first message misses the heading: %q", got[0][:30])
	}
	for _, m := range got {
		if n := len([]rune(m)); n > chatItemLimit {
			t.Fatalf("message of %d runes over the limit", n)
		}
	}
}

func holdItemsForTest(t *testing.T, e *Engine, p Platform, item *teamTaskBoardItem) {
	t.Helper()
	e.holdReportForLead(e.ctx, p, "chat1", "ws1", "橘", itemsBody, exitWSKey, 46,
		"背景：你让我修材料。\n看完了，都写进逐条。\n要你做的：没有。\n我加的：无", "", "", item)
}

// The lead's pass posts the four parts and then the 「材料逐条」 block in the same channel.
func TestHeldReportPassPostsChatItems(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdItemsForTest(t, e, p, item)
	if w := verdictCall(t, e, 46, "pass", "逐条：三条都对，证据在细节"); w.Code != 200 {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	got := p.sentTo("discord:chat1")
	if len(got) != 2 {
		t.Fatalf("pass posted %d messages: %q", len(got), got)
	}
	if !strings.HasPrefix(got[0], "③做完【验证报告】") || !strings.HasPrefix(got[1], "材料逐条：\n1. 知乎") ||
		!strings.Contains(got[1], "3. 免疫系统") {
		t.Fatalf("pass post = %q", got)
	}
}

// No verdict in time: the unchecked copy carries the block too.
func TestHeldReportTimeoutPostsChatItems(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdItemsForTest(t, e, p, item)
	key := e.heldReportFor(46).Key
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].CreatedAt = time.Now().Add(-leadAcceptTimeout - time.Second)
	e.teamExit.mu.Unlock()
	e.recoverPendingReports(true)
	got := p.sentTo("discord:chat1")
	if len(got) != 2 {
		t.Fatalf("timeout posted %d messages: %q", len(got), got)
	}
	if !strings.HasPrefix(got[0], "③做完【验证报告】（"+leadUncheckedMark+"）") || !strings.HasPrefix(got[1], "材料逐条：\n1. 知乎") {
		t.Fatalf("timeout post = %q", got)
	}
}

// A report without the block still posts once, exactly as before.
func TestHeldReportWithoutItemsPostsOnce(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	if w := verdictCall(t, e, 46, "pass", "逐条：修汇报做到了"); w.Code != 200 {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	if got := p.sentTo("discord:chat1"); len(got) != 1 {
		t.Fatalf("plain report posted %d messages: %q", len(got), got)
	}
}
