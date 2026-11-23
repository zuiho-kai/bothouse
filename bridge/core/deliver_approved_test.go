package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core/team"
)

// deliverFixture: a task board dir with #1904 handed from discord:100 to workspace discord:200, #1905 added
// in discord:300, and nothing else on the board.
func deliverFixture(t *testing.T) (*Engine, string) {
	t.Helper()
	dir := t.TempDir()
	board := `{"id":1904,"what":"宣传片样片","short":"宣传片","status":"进行中","ws":"discord:200","sk":"discord:200","chat":"discord:100"}` + "\n" +
		`{"id":1905,"what":"别的频道的活","status":"进行中","sk":"discord:300"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, team.TaskBoardFile), []byte(board), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "deliver"), 0o755); err != nil {
		t.Fatal(err)
	}
	e := &Engine{name: "lead", dataDir: t.TempDir(), team: &teamState{dir: dir}}
	e.workspaceChatForTest = func(s string) bool { return teamChatKey(s) == "discord:200" }
	return e, dir
}

func writeDeliver(t *testing.T, dir, id, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "deliver", id+".json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

const deliverRec1904 = `{
  "id": "1904", "title": "宣传片样片", "chat": "discord:100", "stage": "样",
  "product": "/tmp/out/sample-v3.mp4", "refs": ["/tmp/ref/origin.mp4"],
  "approvals": [{"file": "/tmp/out/sample-v3.mp4", "sha256": "ab12", "quote": "可以，就照这个出全量",
                 "at": "2026-11-23T14:05:00+08:00", "locked": ["开头三秒的镜头", "橘色主色"]}],
  "compares": []
}`

func TestDeliverApprovedBlockText(t *testing.T) {
	e, dir := deliverFixture(t)
	if got := e.deliverApprovedBlock(&Session{}, "discord:100:u1"); got != "" {
		t.Fatalf("no record, yet injected: %q", got)
	}
	writeDeliver(t, dir, "1904", deliverRec1904)
	got := e.deliverApprovedBlock(&Session{}, "discord:100:u1")
	t.Logf("injected block:\n%s", got)
	for _, want := range []string{deliverApprovedHead, "#1904 宣传片样片", "/tmp/out/sample-v3.mp4", "「可以，就照这个出全量」",
		"开头三秒的镜头", "橘色主色", "改动不得碰上面不许动的部分", deliverApprovedEnd} {
		if !strings.Contains(got, want) {
			t.Errorf("block lacks %q", want)
		}
	}
	if !strings.HasPrefix(got, deliverApprovedHead) || !strings.HasSuffix(got, deliverApprovedEnd) {
		t.Errorf("block must open and close with its markers (staleBlocks): %q", got)
	}
}

func TestDeliverApprovedOncePerContext(t *testing.T) {
	e, dir := deliverFixture(t)
	writeDeliver(t, dir, "1904", deliverRec1904)
	s := &Session{}
	first := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1"))
	if first == "" {
		t.Fatal("first turn of the context got nothing")
	}
	if got := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1")); got != "" {
		t.Fatalf("second turn of the same context got it again: %q", got)
	}
	// The record changes (one more locked part): sent again, once.
	writeDeliver(t, dir, "1904", strings.Replace(deliverRec1904, `"橘色主色"`, `"橘色主色", "片尾字幕"`, 1))
	changed := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1"))
	if !strings.Contains(changed, "片尾字幕") || changed == first {
		t.Fatalf("changed record not sent again: %q", changed)
	}
	if got := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1")); got != "" {
		t.Fatalf("changed record repeated: %q", got)
	}
	// A new agent context (TurnCtx dropped with the old one) gets it again.
	s.ResetTurnCtx()
	if got := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1")); got != changed {
		t.Fatalf("new context: want the block again, got %q", got)
	}
	// That turn was not sent: the next one carries the block; once sent, no more.
	s.SettleHandoff(false)
	if got := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1")); got != changed {
		t.Fatalf("after an unsent turn: want the block again, got %q", got)
	}
	s.SettleHandoff(true)
	if got := e.injectBlock(s, "approved", e.deliverApprovedBlock(s, "discord:100:u1")); got != "" {
		t.Fatalf("after a sent turn: repeated %q", got)
	}
}

func TestDeliverApprovedOnlyOpenTasksOfThisChat(t *testing.T) {
	e, dir := deliverFixture(t)
	writeDeliver(t, dir, "1904", deliverRec1904)
	// #1800 is not on the open board (done or never there); #1905 belongs to another chat;
	// #1906 has no approval yet.
	writeDeliver(t, dir, "1800", strings.ReplaceAll(deliverRec1904, "1904", "1800"))
	writeDeliver(t, dir, "1905", `{"id":"1905","title":"别的频道的活","chat":"discord:300","approvals":[{"file":"/tmp/x.png","quote":"行","locked":[]}]}`)
	writeDeliver(t, dir, "1906", `{"id":"1906","title":"还没认可","chat":"discord:100","approvals":[]}`)

	got := e.deliverApprovedBlock(&Session{}, "discord:100:u1")
	if !strings.Contains(got, "#1904") || strings.Contains(got, "#1800") || strings.Contains(got, "#1905") || strings.Contains(got, "#1906") {
		t.Fatalf("discord:100 must get #1904 only: %q", got)
	}
	// The workspace #1904 is bound to gets it too, though the record names the chat channel.
	if ws := e.deliverApprovedBlock(&Session{}, "discord:200:u1"); ws != got {
		t.Fatalf("workspace of #1904: want the same block, got %q", ws)
	}
	// discord:300 sees its own task; an approval without locked parts says the whole file stays.
	other := e.deliverApprovedBlock(&Session{}, "discord:300:u1")
	if !strings.Contains(other, "#1905") || strings.Contains(other, "#1904") || !strings.Contains(other, "整份不改") {
		t.Fatalf("discord:300: %q", other)
	}
	if got := e.deliverApprovedBlock(&Session{}, "discord:999:u1"); got != "" {
		t.Fatalf("a chat with no task got: %q", got)
	}
	// #1904 leaves the open board: nothing for its chat any more.
	if err := os.WriteFile(filepath.Join(dir, team.TaskBoardFile),
		[]byte(`{"id":1905,"what":"别的频道的活","status":"进行中","sk":"discord:300"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := e.deliverApprovedBlock(&Session{}, "discord:100:u1"); got != "" {
		t.Fatalf("#1904 is off the board, yet injected: %q", got)
	}
}

// The block goes in through withTurnBlocks, in a workspace as well (where the life page is skipped), and a
// handoff to the next context strips the old copy.
func TestDeliverApprovedInTurnBlocks(t *testing.T) {
	e, dir := deliverFixture(t)
	writeDeliver(t, dir, "1904", deliverRec1904)
	for _, key := range []string{"discord:100:u1", "discord:200:u1"} {
		s := &Session{}
		got := e.withTurnBlocks(s, key, "", "继续做", false)
		if !strings.Contains(got, "「可以，就照这个出全量」") || !strings.HasSuffix(got, "继续做") {
			t.Fatalf("%s: first turn lacks the block: %q", key, got)
		}
		if again := e.withTurnBlocks(s, key, "", "继续做", false); strings.Contains(again, deliverApprovedHead) {
			t.Fatalf("%s: second turn repeats the block: %q", key, again)
		}
		if kept := stripStaleBlocks(got); kept != "继续做" {
			t.Fatalf("%s: handoff must keep the user's words only, got %q", key, kept)
		}
	}
}
