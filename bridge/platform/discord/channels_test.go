package discord

import (
	"testing"

	"github.com/bwmarrin/discordgo"
)

func TestAboveWorkspacesOrder(t *testing.T) {
	tc := func(id, name, parent string, pos int) *discordgo.Channel {
		return &discordgo.Channel{ID: id, Name: name, ParentID: parent, Position: pos, Type: discordgo.ChannelTypeGuildText}
	}
	list := []*discordgo.Channel{
		tc("a", "聊天", "cat", 3), tc("w1", "工作区1", "cat", 4), tc("w2", "工作区2", "cat", 5),
		tc("new", "新频道", "cat", 6), tc("o", "别处", "other", 0),
	}
	got := aboveWorkspacesOrder(list, "new", "cat")
	want := []string{"a", "new", "w1", "w2"}
	if len(got) != len(want) {
		t.Fatalf("got %d channels", len(got))
	}
	for i, c := range got {
		if c.ID != want[i] || c.Position != 3+i {
			t.Fatalf("pos %d: got %s@%d, want %s@%d", i, c.ID, c.Position, want[i], 3+i)
		}
	}
	if aboveWorkspacesOrder([]*discordgo.Channel{tc("a", "聊天", "cat", 0), tc("new", "x", "cat", 1)}, "new", "cat") != nil {
		t.Fatal("no workspace in category: nothing to move")
	}
}
