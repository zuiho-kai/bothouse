package qq

import (
	"context"
	"testing"
)

func TestQQ137ReplyWithAtPreservesUnmentionedText(t *testing.T) {
	for _, sample := range []struct{ in, want string }{{"你好", "你好"}, {"   你好", "你好"}, {"    code()\n    next()", "    code()\n    next()"}, {"\tcode()", "\tcode()"}} {
		t.Run(sample.in, func(t *testing.T) {
			f := newFakeOneBot(t)
			p, _ := startTestPlatform(t, f)
			if err := p.ReplyWithAt(context.Background(), &replyContext{messageType: "group", groupID: 111}, sample.in, nil, false); err != nil {
				t.Fatal(err)
			}
			segments := f.paramsOf("send_group_msg", 0)["message"].([]any)
			got := segments[0].(map[string]any)["data"].(map[string]any)["text"]
			if got != sample.want {
				t.Fatalf("unmentioned text gained a prefix: got %q want %q", got, sample.want)
			}
		})
	}
}

func TestQQ137SplitBubblesKeepsCodeIndentation(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	p.splitReplyBubbles = true
	if err := p.Send(context.Background(), &replyContext{messageType: "private", userID: 222}, "  正文\n\n    code()\n    next()"); err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"正文", "    code()\n    next()"} {
		if got := f.paramsOf("send_private_msg", i)["message"]; got != want {
			t.Fatalf("bubble %d = %q want %q", i, got, want)
		}
	}
}

func TestQQ137SendRemovesProsePadding(t *testing.T) {
	for _, sample := range []struct{ in, want string }{
		{"   手滑了…  把心里想的打出来了", "手滑了…  把心里想的打出来了"},
		{" 你好", "你好"},
		{"　你好", "你好"},
		{"    code()\n    next()", "    code()\n    next()"},
		{"\tcode()", "\tcode()"},
	} {
		t.Run(sample.in, func(t *testing.T) {
			f := newFakeOneBot(t)
			p, _ := startTestPlatform(t, f)
			if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 111}, sample.in); err != nil {
				t.Fatal(err)
			}
			got := f.paramsOf("send_group_msg", 0)["message"]
			if got != sample.want {
				t.Fatalf("QQ text = %q want %q", got, sample.want)
			}
		})
	}
}
