package core

import (
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
