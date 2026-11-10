package discord

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

func TestMissingPermissionErrNamesPermissionAndReinviteLink(t *testing.T) {
	p := &Platform{appID: "123"}
	denied := &discordgo.RESTError{Response: &http.Response{StatusCode: 403, Status: "403 Forbidden"}, ResponseBody: []byte(`{"message": "Missing Permissions", "code": 50013}`), Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeMissingPermissions, Message: "Missing Permissions"}}
	for _, perm := range []string{permManageChannels, permPinMessages} {
		err := p.missingPermissionErr(denied, perm)
		msg := err.Error()
		for _, want := range []string{perm, "client_id=123", "permissions=" + strconv.FormatInt(core.DiscordInvitePermissions, 10), "Missing Permissions", "服务器设置 → 身份组", "重新点链接不会更新权限"} {
			if !strings.Contains(msg, want) {
				t.Errorf("error %q lacks %q", msg, want)
			}
		}
		if !errors.Is(err, denied) {
			t.Error("original error not wrapped")
		}
		if !errors.Is(workspaceErr(err), core.ErrTeamWorkspacePermanent) {
			t.Error("403 no longer marked permanent")
		}
	}
	other := &discordgo.RESTError{Response: &http.Response{StatusCode: 403}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeMissingAccess}}
	if got := p.missingPermissionErr(other, permManageChannels); got != error(other) {
		t.Errorf("non-50013 error changed: %v", got)
	}
	if p.missingPermissionErr(nil, permManageChannels) != nil {
		t.Error("nil error changed")
	}
}

// agentm 11-10: the bot serves two servers; the hint for a channel in the other one must name that
// server, not the configured guild_id, and use the label the Chinese client shows (标注消息).
func TestMissingPermissionErrInNamesTheChannelsServer(t *testing.T) {
	s, _ := discordgo.New("Bot x")
	_ = s.State.GuildAdd(&discordgo.Guild{ID: "g-other"})
	_ = s.State.ChannelAdd(&discordgo.Channel{ID: "c1", GuildID: "g-other"})
	p := &Platform{appID: "123", guildID: "g-config", session: s}
	denied := &discordgo.RESTError{Response: &http.Response{StatusCode: 403}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeMissingPermissions}}
	msg := p.missingPermissionErrIn(denied, permPinMessages, "c1").Error()
	if !strings.Contains(msg, "guild_id=g-other") || strings.Contains(msg, "g-config") {
		t.Fatalf("hint names the wrong server: %s", msg)
	}
	if !strings.Contains(msg, "标注消息") {
		t.Fatalf("hint lacks the client's label: %s", msg)
	}
}
