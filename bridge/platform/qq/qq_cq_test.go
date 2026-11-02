package qq

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCQStringMediaReachesHandler(t *testing.T) {
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("name") != "a,b[c]&d" {
			t.Errorf("media URL was not decoded correctly: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("test-media"))
	}))
	defer media.Close()
	url := media.URL + "/?name=a&#44;b&#91;c&#93;%26d&amp;source=qq"

	for _, kind := range []string{"image", "file", "record"} {
		t.Run(kind, func(t *testing.T) {
			f := newFakeOneBot(t)
			_, msgs := startTestPlatform(t, f)
			event := privateMessage(2001, 101)
			event["message"] = fmt.Sprintf("[CQ:%s,file=sample.mp3,name=a&#44;b&#91;c&#93;&amp;d,url=%s]", kind, url)
			f.push(event)
			m := awaitMessage(t, msgs)
			if !m.Direct || m.Content != "" {
				t.Fatalf("unexpected message: Direct=%v Content=%q", m.Direct, m.Content)
			}
			switch kind {
			case "image":
				if len(m.Images) != 1 || string(m.Images[0].Data) != "test-media" {
					t.Fatalf("image attachment = %#v", m.Images)
				}
			case "file":
				if len(m.Files) != 1 || string(m.Files[0].Data) != "test-media" || m.Files[0].FileName != "a,b[c]&d" {
					t.Fatalf("file attachment = %#v", m.Files)
				}
			case "record":
				if m.Audio == nil || string(m.Audio.Data) != "test-media" || m.Audio.Format != "mp3" {
					t.Fatalf("audio attachment = %#v", m.Audio)
				}
			}
		})
	}
}

func TestQuotedBotReplyReachesHandler(t *testing.T) {
	for _, format := range []string{"array", "string", "raw_message"} {
		for _, text := range []string{"继续", ""} {
			t.Run(format+"/"+text, func(t *testing.T) {
				f := newFakeOneBot(t)
				f.on("send_group_msg", func(map[string]any) map[string]any {
					return map[string]any{"message_id": 4242}
				})
				p, msgs := startTestPlatform(t, f)
				if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 111}, "上一次答复"); err != nil {
					t.Fatal(err)
				}
				event := groupMessage(111, 2001, 102, replySegment("4242"), textSegment(text))
				if format == "string" {
					event["message"] = "[CQ:reply,id=4242]" + text
				} else if format == "raw_message" {
					delete(event, "message")
					event["raw_message"] = "[CQ:reply,id=4242]" + text
				}
				f.push(event)
				m := awaitMessage(t, msgs)
				if !m.Mentioned || m.ExtraContent != "[引用消息]\n你：上一次答复" {
					t.Errorf("Mentioned=%v ExtraContent=%q", m.Mentioned, m.ExtraContent)
				}
				want := text
				if want == "" {
					want = bareMentionPlaceholder
				}
				if m.Content != want {
					t.Errorf("Content=%q, want %q", m.Content, want)
				}
			})
		}
	}
}

func TestCQStringReplyToOtherDoesNotMentionBot(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)
	f.push(groupMessage(111, 2001, 103, textSegment("成员的话")))
	_ = awaitMessage(t, msgs)
	event := groupMessage(111, 2002, 104)
	event["message"] = "[CQ:reply,id=103] 看一下"
	f.push(event)
	m := awaitMessage(t, msgs)
	if m.Mentioned || m.Content != "看一下" || m.ExtraContent != "[引用消息]\n成员：成员的话" {
		t.Errorf("Mentioned=%v Content=%q ExtraContent=%q", m.Mentioned, m.Content, m.ExtraContent)
	}
}

func TestCQStringTextPreservation(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want string
	}{
		{"literal CQ", "&#91;CQ:at,qq=10000&#93; &amp; &#44;", "[CQ:at,qq=10000] & &#44;"},
		{"decode once", "&amp;#91;CQ:at,qq=10000&amp;#93;", "&#91;CQ:at,qq=10000&#93;"},
		{"unterminated CQ", "保留 [CQ:image,file=unfinished", "保留 [CQ:image,file=unfinished"},
		{"parameter escapes", "[CQ:at,qq=2002,name=a&#44;b&#91;c&#93;&amp;d] 后文", "@a,b[c]&d 后文"},
		{"parameter decode once", "[CQ:at,qq=2002,name=&amp;#44;]", "@&#44;"},
		{"unknown segment", "前[CQ:face,id=178]后", "前后"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &Platform{selfID: botUserID}
			got := p.parseMessage(map[string]any{"message": tc.raw}, "group", 111)
			if got.text != tc.want || got.mentioned {
				t.Errorf("text=%q mentioned=%v, want %q, false", got.text, got.mentioned, tc.want)
			}
		})
	}
}

func TestArrayTextIsNotCQDecoded(t *testing.T) {
	p := &Platform{selfID: botUserID}
	want := "[CQ:at,qq=10000] &#91; &amp; &#44;"
	got := p.parseMessage(map[string]any{"message": []any{textSegment(want)}}, "group", 111)
	if got.text != want || got.mentioned {
		t.Errorf("text=%q mentioned=%v, want %q, false", got.text, got.mentioned, want)
	}
}
