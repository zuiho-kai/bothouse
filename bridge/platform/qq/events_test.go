package qq

import (
	"encoding/json"
	"testing"
)

func TestQQNoticeEvents(t *testing.T) {
	var got string
	for _, raw := range []string{
		`{"post_type":"notice","notice_type":"group_increase","group_id":123,"user_id":456}`,
		`{"post_type":"notice","notice_type":"group_decrease","group_id":123,"user_id":999}`,
		`{"post_type":"notice","notice_type":"group_increase","group_id":123,"user_id":999}`,
		`{"post_type":"notice","notice_type":"group_msg_emoji_like","group_id":123,"user_id":456,"message_id":77,"likes":[{"emoji_id":"76","count":1}]}`,
		`{"post_type":"notice","notice_type":"poke","group_id":123,"user_id":456}`,
	} {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatal(err)
		}
		for _, ev := range noticeEvents(m, "999") {
			got += string(ev.Name) + ":" + ev.UserID + "@" + ev.ChannelID + ev.Emoji + " "
		}
	}
	if want := "member.joined:456@123 reaction.added:456@12376 "; got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
