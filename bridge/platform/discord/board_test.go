package discord

import (
	"errors"
	"testing"

	"github.com/bwmarrin/discordgo"
)

type stubBoardAPI struct {
	editErr  error
	edits    int
	sends    []*discordgo.MessageSend
	pins     []string
	deletes  []string
	delErr   error
	unpinned bool
	pinErr   error
}

func (s *stubBoardAPI) ChannelMessageDelete(_, messageID string, _ ...discordgo.RequestOption) error {
	s.deletes = append(s.deletes, messageID)
	return s.delErr
}

func (s *stubBoardAPI) ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	s.sends = append(s.sends, data)
	return &discordgo.Message{ID: "new", ChannelID: channelID}, nil
}

func (s *stubBoardAPI) ChannelMessageEditComplex(_ *discordgo.MessageEdit, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	s.edits++
	return &discordgo.Message{Pinned: !s.unpinned}, s.editErr
}

func (s *stubBoardAPI) ChannelMessagePin(_, messageID string, _ ...discordgo.RequestOption) error {
	s.pins = append(s.pins, messageID)
	return s.pinErr
}

func TestUpsertBoardEditsInPlace(t *testing.T) {
	api := &stubBoardAPI{}
	id, err := upsertBoard(api, "c1", "old", "**谁在干啥**\n**G哥**　🔧 预解码")
	if err != nil || id != "old" {
		t.Fatalf("upsert = (%q, %v)", id, err)
	}
	if api.edits != 1 || len(api.sends) != 0 || len(api.pins) != 0 {
		t.Fatalf("edits=%d sends=%d pins=%d, want an in-place edit only", api.edits, len(api.sends), len(api.pins))
	}
}

func TestUpsertBoardRepostsWhenGone(t *testing.T) {
	api := &stubBoardAPI{editErr: &discordgo.RESTError{Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeUnknownMessage}}}
	id, err := upsertBoard(api, "c1", "old", "**谁在干啥**\n**G哥**　💤 空闲")
	if err != nil || id != "new" {
		t.Fatalf("upsert = (%q, %v)", id, err)
	}
	if len(api.sends) != 1 || len(api.pins) != 1 || api.pins[0] != "new" {
		t.Fatalf("sends=%d pins=%v, want one new pinned board", len(api.sends), api.pins)
	}
	send := api.sends[0]
	if send.AllowedMentions == nil || len(send.AllowedMentions.Parse) != 0 {
		t.Fatal("board must not ping anyone")
	}
	if e := send.Embeds[0]; e.Title != "谁在干啥" || e.Description != "**G哥**　💤 空闲" {
		t.Fatalf("embed = %q / %q", e.Title, e.Description)
	}
}

func TestUpsertBoardFirstPost(t *testing.T) {
	api := &stubBoardAPI{}
	if id, err := upsertBoard(api, "c1", "", "**谁在干啥**"); err != nil || id != "new" || api.edits != 0 {
		t.Fatalf("upsert = (%q, %v), edits=%d", id, err, api.edits)
	}
}

func TestRemoveBoard(t *testing.T) {
	api := &stubBoardAPI{}
	if err := removeBoard(api, "c1", "m1"); err != nil || len(api.deletes) != 1 || api.deletes[0] != "m1" {
		t.Fatalf("remove = %v, deletes=%v", err, api.deletes)
	}
	api.delErr = &discordgo.RESTError{Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeUnknownMessage}}
	if err := removeBoard(api, "c1", "gone"); err != nil {
		t.Fatalf("already-deleted board should count as removed: %v", err)
	}
	api.delErr = errors.New("network")
	if err := removeBoard(api, "c1", "m2"); err == nil {
		t.Fatal("real failure must be reported")
	}
}
