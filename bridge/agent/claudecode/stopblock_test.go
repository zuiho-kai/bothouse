package claudecode

import "testing"

func TestMergeStopBlockedReply(t *testing.T) {
	long := "完整的分工说明：龙娘写代码，鲸鱼娘润色，彩虹猫查资料。"
	cases := []struct{ pre, res, want string }{
		{"", "好的。", "好的。"},
		{long, "能分工。", long + "\n\n能分工。"},
		{long, long + "\n补一句。", long + "\n补一句。"},
		{long, "", long},
		{"短", "重写后的更长的完整回复", "重写后的更长的完整回复"},
	}
	for _, c := range cases {
		if got := mergeStopBlockedReply(c.pre, c.res); got != c.want {
			t.Errorf("merge(%q,%q)=%q want %q", c.pre, c.res, got, c.want)
		}
	}
}

func TestStopBlockedReplyFlow(t *testing.T) {
	cs := &claudeSession{}
	cs.noteReplyText("前面写的一大段完整回复，包含所有细节和结论。")
	cs.noteStopBlocked()
	cs.noteReplyText("补一句。")
	if got := cs.takeStopBlockedReply("补一句。"); got != "前面写的一大段完整回复，包含所有细节和结论。\n\n补一句。" {
		t.Fatalf("got %q", got)
	}
	if got := cs.takeStopBlockedReply("下一轮"); got != "下一轮" {
		t.Fatalf("state leaked: %q", got)
	}
}
