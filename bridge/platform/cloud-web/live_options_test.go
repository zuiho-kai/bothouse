package cloudweb

import (
	"reflect"
	"testing"
)

// Adding a role names the lead on a cloud_web role already running: it applies without a restart;
// any other changed option is reported.
func TestReloadOptionsAppliesTeamLeadLive(t *testing.T) {
	start := map[string]any{"transport": "websocket", "ws_url": "ws://hub/ws?bot=a&mention_id=1", "token": "t",
		"share_session_in_channel": true, "group_reply_all": true, "cc_project": "a", "cc_data_dir": "/d"}
	pl, err := New(start)
	if err != nil {
		t.Fatal(err)
	}
	p := pl.(*Platform)
	if p.HasConfiguredTeamLead() {
		t.Fatal("lead set before reload")
	}
	reloaded := copyOpts(start)
	delete(reloaded, "cc_project") // config.toml holds no cc_* keys
	delete(reloaded, "cc_data_dir")
	reloaded["team_lead_bot"] = "2"
	if r := p.ReloadOptions(reloaded); len(r) != 0 {
		t.Fatalf("restart keys = %v, want none", r)
	}
	if p.lead() != "2" {
		t.Fatalf("team_lead_bot = %q, want 2", p.lead())
	}
	reloaded["ws_url"] = "ws://other/ws?bot=a"
	delete(reloaded, "group_reply_all")
	if r := p.ReloadOptions(reloaded); !reflect.DeepEqual(r, []string{"group_reply_all", "ws_url"}) {
		t.Fatalf("restart keys = %v, want [group_reply_all ws_url]", r)
	}
}
