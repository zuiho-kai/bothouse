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
