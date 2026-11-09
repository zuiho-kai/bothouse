package core

import (
	"strings"
	"testing"
	"time"
)

const watchPersonID = "1567378737698439248" // a user (not a bot) who asked for the task

// #1280: a claim that names a person (the user who asked for the task) is claimed for the lead:
// the watch must never mention that person to hand back or carry on.
func TestWatchClaimForPersonDropsOwner(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	hp := &historyTestPlatform{exitTestPlatform: p}
	e.platforms = []Platform{hp}
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(hp)
	e.handoffWatchOn.Store(true)
	hp.add("chatA", ChannelHistoryMessage{ID: "m1", AuthorID: watchPersonID, Content: "验证vllm-omni PR9977", Time: time.Now()})
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区2", "<@"+watchPersonID+">", "验证vllm-omni PR9977"); err != nil {
		t.Fatal(err)
	}
	if got := handoffsOf(e, "discord:ws1")[0].Owner; got != "" {
		t.Fatalf("a person must not become the task owner, got %q", got)
	}
}

// A handoff saved with a person as owner (before the claim check): the nudge and the auto-resume
// post carry no mention.
func TestWatchPersonOwnerNotMentioned(t *testing.T) {
	_, p, w, h := progressFixture(t, watchPersonID)
	p.add("chatA", ChannelHistoryMessage{ID: "m1", AuthorID: watchPersonID, Content: "验证一下", Time: h.At})
	w.tick(h.Due) // no progress: nudge
	now := h.Due.Add(watchCheckAfter())
	w.tick(now) // no progress after the nudge: auto-resume
	for _, s := range p.sentTo("discord:ws1") {
		if strings.Contains(s, watchPersonID) || strings.Contains(s, "<@") {
			t.Fatalf("watch post mentions the person: %q (all %q)", s, p.sentTo("discord:ws1"))
		}
	}
	if len(watchNudges(p.sentTo("discord:ws1"))) != 1 {
		t.Fatalf("one nudge without a mention, got %q", p.sentTo("discord:ws1"))
	}
	if txt := watchNudgeText("discord", TeamHandoff{Owner: "", Title: "x"}); strings.Contains(txt, "<@") {
		t.Fatalf("no owner: no mention, got %q", txt)
	}
}

// A teammate bot (posts are a bot's) on another bridge keeps its mention.
func TestWatchBotOwnerStillMentioned(t *testing.T) {
	_, p, w, h := progressFixture(t, k5aOwner)
	p.post("chatA", k5aOwner, "【接】", h.At)
	w.tick(h.Due)
	sent := p.sentTo("discord:ws1")
	if len(sent) == 0 || !strings.HasPrefix(sent[0], "<@"+k5aOwner+">") {
		t.Fatalf("a bot owner is mentioned, got %q", sent)
	}
}
