package core

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// #1346: a late [report] goes to its board item's own chat, not to the chat that owns the
// workspace now (11-10 #1331 → 1562131004234276945 instead of 1563772957040443482).
func TestItemChatParent(t *testing.T) {
	e := &Engine{dataDir: t.TempDir()}
	it := func(chat string) *teamTaskBoardItem { return &teamTaskBoardItem{ID: 1331, Chat: chat} }
	cases := []struct {
		name string
		item *teamTaskBoardItem
		want string
	}{
		{"late report keeps its own chat", it("discord:1563772957040443482"), "1563772957040443482"},
		{"no item: owner", nil, "1562131004234276945"},
		{"no chat recorded: owner", it(""), "1562131004234276945"},
		{"same as owner", it("discord:1562131004234276945"), "1562131004234276945"},
		{"chat is the workspace itself", it("discord:1565264039414603836"), "1562131004234276945"},
		{"other platform", it("feishu:oc_x"), "1562131004234276945"},
	}
	for _, c := range cases {
		got := e.itemChatParent("discord", "1565264039414603836", "1562131004234276945", 1331, c.item)
		if got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
	if got := e.itemChatParent("discord", "1565264039414603836", "1562131004234276945", 1337, it("discord:1563772957040443482")); got != "1562131004234276945" {
		t.Errorf("item of another id must not move the answer: got %s", got)
	}
}

// End to end: workspace ws1 now belongs to chat1 (it moved on to chat1's task), a late [ask] for
// item 1331 whose own chat is chatB goes to chatB, and nothing lands in chat1.
func TestWorkspaceLateExitGoesToItemChat(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", false)
	f, err := os.OpenFile(filepath.Join(e.team.dir, teamTaskBoardFile), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(f, "{\"id\":1331,\"what\":\"笨蛋副歌r7\",\"status\":\"在做\",\"who\":\"橘\",\"chat\":\"discord:chatB\"}\n")
	f.Close()
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, "[ask] #1331 背景：你让我做这件事。\n用 A 还是 B？\n要你做的：没有。\n我加的：无\n自验：无需\n类别：方向")
	inputWait(t, func() bool { return len(p.sentTo("discord:chatB")) == 1 })
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("late answer went to the workspace's current owner: %q", got)
	}
}
