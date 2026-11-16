package core

import (
	"errors"
	"strings"
	"testing"
)

func TestTaskForumQuotesSpeaker(t *testing.T) {
	names := map[string]string{"zuiho_kai": "瑞凤"}
	who := func(text string) string {
		if strings.HasPrefix(text, "都做") {
			return "zuiho_kai"
		}
		return ""
	}
	in := "（上一条橘的回复：三条建议 ③派活按难度分档选模型）\n- [11-16 14:4x] zuiho_kai（回复上条）：「发吧」\n- [11-16 16:0x] zzzx0757：「还有那个原话来源」\n- [11-16 16:1x] zuiho_kai：「帖子里的」\n用户：都做，第三种我有点担心\n用户：查不到的话\n（2026-11-16 15:08，zuiho_kai）\n「查到了：工作区\n修一下」"
	got := taskForumQuotes(in, names, who)
	want := "（上一条橘的回复：三条建议 ③派活按难度分档选模型）\n- [11-16 14:4x] 瑞凤（回复上条）：「发吧」\n- [11-16 16:0x] zzzx0757：「还有那个原话来源」\n- [11-16 16:1x] 瑞凤：「帖子里的」\n瑞凤：都做，第三种我有点担心\n用户：查不到的话\n（2026-11-16 15:08，zuiho_kai）\n瑞凤：「查到了：工作区\n修一下」"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

type quoteHistoryStub struct {
	fail  bool
	calls int
}

func (q *quoteHistoryStub) ChannelHistory(channelID, beforeID string, limit int) ([]ChannelHistoryMessage, error) {
	q.calls++
	if q.fail {
		return nil, errors.New("not connected")
	}
	if beforeID != "" {
		return nil, nil
	}
	return []ChannelHistoryMessage{{ID: "2", Author: "zuiho_kai", Content: "[回复 Claude橘：笔记] 都做，第三种我有点担心"}}, nil
}

func TestTaskForumQuoteWhoRetriesAfterError(t *testing.T) {
	stub := &quoteHistoryStub{fail: true}
	who := taskForumQuoteWhoFrom(stub, "discord:retry-test")
	if got := who("都做，第三种我有点担心"); got != "" {
		t.Fatalf("got %q while not connected", got)
	}
	stub.fail = false
	if got := who("都做，第三种我有点担心"); got != "zuiho_kai" {
		t.Fatalf("got %q after connecting, want zuiho_kai", got)
	}
}
