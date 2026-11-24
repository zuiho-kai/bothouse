package discord

import (
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// privateThreadAPI records what a private channel's post does on Discord.
type privateThreadAPI struct {
	categoryForumAPI
	sent    []string // channel of each message sent
	started []string // channel:message of each thread started on a message
	forum   int
	edited  []*discordgo.MessageEdit
	tagged  bool
}

func (a *privateThreadAPI) GuildThreadsActive(string, ...discordgo.RequestOption) (*discordgo.ThreadsList, error) {
	return &discordgo.ThreadsList{}, nil
}
func (a *privateThreadAPI) ChannelMessageSendComplex(ch string, _ *discordgo.MessageSend, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	a.sent = append(a.sent, ch)
	return &discordgo.Message{ID: "card", ChannelID: ch}, nil
}
func (a *privateThreadAPI) MessageThreadStartComplex(ch, msg string, _ *discordgo.ThreadStart, _ ...discordgo.RequestOption) (*discordgo.Channel, error) {
	a.started = append(a.started, ch+":"+msg)
	return &discordgo.Channel{ID: msg, ParentID: ch}, nil
}
func (a *privateThreadAPI) ForumThreadStartComplex(string, *discordgo.ThreadStart, *discordgo.MessageSend, ...discordgo.RequestOption) (*discordgo.Channel, error) {
	a.forum++
	return &discordgo.Channel{ID: "forumpost"}, nil
}
func (a *privateThreadAPI) ChannelEdit(id string, e *discordgo.ChannelEdit, _ ...discordgo.RequestOption) (*discordgo.Channel, error) {
	if ch := a.channels[id]; ch != nil && ch.Type == discordgo.ChannelTypeGuildForum {
		return a.categoryForumAPI.ChannelEdit(id, e)
	}
	if e.AppliedTags != nil {
		a.tagged = true
	}
	return &discordgo.Channel{ID: id}, nil
}
func (a *privateThreadAPI) ChannelMessageEditComplex(m *discordgo.MessageEdit, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	a.edited = append(a.edited, m)
	return &discordgo.Message{}, nil
}

// User 11-24「把帖子变成私密帖吧，如果是那种私人频道的话」: a channel @everyone cannot view gets its
// posts as threads in itself, never the category forum other private channels share.
func TestTaskForumPrivateChannelPostsInItself(t *testing.T) {
	hidden := []*discordgo.PermissionOverwrite{{ID: "g", Type: discordgo.PermissionOverwriteTypeRole, Deny: discordgo.PermissionViewChannel | 1048576}}
	api := &privateThreadAPI{categoryForumAPI: categoryForumAPI{channels: map[string]*discordgo.Channel{
		"C":    {ID: "C", GuildID: "g", Type: discordgo.ChannelTypeGuildCategory, Name: "小群", PermissionOverwrites: hidden},
		"mine": {ID: "mine", GuildID: "g", ParentID: "C", Type: discordgo.ChannelTypeGuildText, PermissionOverwrites: hidden},
		"open": {ID: "open", GuildID: "g", ParentID: "C", Type: discordgo.ChannelTypeGuildText},
		"solo": {ID: "solo", GuildID: "g", Type: discordgo.ChannelTypeGuildText, PermissionOverwrites: hidden},
	}}}
	p := &Platform{}
	f, err := p.ensureTaskForum(api, "mine", "", []string{core.TaskForumTagRunning})
	if err != nil || f.ID != "mine" || f.Channel != "mine" || len(api.created) != 0 {
		t.Fatalf("private channel: %+v %v created=%v", f, err, api.created)
	}
	open, err := p.ensureTaskForum(api, "open", "", []string{core.TaskForumTagRunning})
	if err != nil || open.Channel != "" || len(api.created) != 1 {
		t.Fatalf("public channel must keep the category forum: %+v %v", open, err)
	}
	if solo, err := p.ensureTaskForum(api, "solo", "", nil); err != nil || solo.ID != "solo" {
		t.Fatalf("a private channel outside any category posts in itself too: %+v %v", solo, err)
	}
	id, err := p.openTaskPost(api, f, core.TaskForumPost{Marker: "#1", Title: "#1 活", Card: "卡", Tag: core.TaskForumTagRunning})
	if err != nil || id != "card" || len(api.sent) != 1 || api.sent[0] != "mine" || len(api.started) != 1 || api.started[0] != "mine:card" || api.forum != 0 {
		t.Fatalf("post must be a thread on a card in the channel: id=%s err=%v sent=%v started=%v forum=%d", id, err, api.sent, api.started, api.forum)
	}
	if err := p.updateTaskPost(api, f, id, core.TaskForumPost{Title: "#1 活", Card: "新卡", Tag: core.TaskForumTagDone, Archived: true}); err != nil {
		t.Fatal(err)
	}
	if api.tagged || len(api.edited) != 1 || api.edited[0].Channel != "mine" || api.edited[0].ID != "card" {
		t.Fatalf("card must be edited in the channel without forum tags: tagged=%v edits=%+v", api.tagged, api.edited)
	}
}
