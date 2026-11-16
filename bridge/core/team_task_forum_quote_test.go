package core

import (
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
