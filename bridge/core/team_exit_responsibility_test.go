package core

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core/team"
)

// A [report] that says the result fell short answers the three questions, or it goes back naming
// every missing answer at once (user 11-17, Fable method 2; #1755).
func TestResponsibilityReportProblems(t *testing.T) {
	full := `[report] #1 背景：测了召回，没提升。
原因：召回按字面相近搜，教训要用在某个时刻，任务那句话里没有这些字
下一步：把教训改成交回前必答的问题，放进交回检查
以前修过：修过两次；上次只改了推送那一刻，开工那轮到交付之间还是没送到
入口依据：验的是用户实际用的工作区开工入口，依据是 ws-handoff 打出来的提示原文
细节：
入口自验：在工作区入口跑了一遍
` + "```\nOK：桥会转发这条\n```\n"

	for _, c := range []struct {
		name    string
		body    string
		want    int
		missing []string
	}{
		{"all answers", full, 0, nil},
		{"no trigger", "[report] #1 背景：测了召回。\n原因：没有\n", 0, nil},
		{"nothing answered", "[report] #1 背景：测了召回，没提升，也没找到原因。\n", 1, []string{"「原因：」", "「下一步：」", "「以前修过：」", "「入口依据：」"}},
		{"some answered", "[report] #1 背景：测了召回，不行。\n原因：搜法不对\n- 下一步：改按时刻给\n", 1, []string{"「以前修过：」", "「入口依据：」"}},
		{"empty answer", "[report] #1 背景：没用。\n原因：\n下一步：做了\n以前修过：没有\n入口依据：入口真\n", 1, []string{"「原因：」"}},
		{"adjective", "[report] #1 背景：删了两个确定没用的重排模型，硬盘空出来。\n", 0, nil},
		{"question", "[report] #1 背景：问用户这样行不行、不行的话再换。\n", 0, nil},
		{"quoted", "[report] #1 背景：把「没提升」「不行」改成交回前必答的问题。\n", 0, nil},
		{"details only", "[report] #1 背景：测了召回。\n细节：这次测完没提升，但结论在细节里。\n", 0, nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := team.ResponsibilityReportProblems(c.body)
			if len(got) != c.want {
				t.Fatalf("got %v, want %d problem(s)", got, c.want)
			}
			for _, m := range c.missing {
				if !strings.Contains(got[0], m) {
					t.Errorf("bounce message %q does not name %s", got[0], m)
				}
			}
		})
	}
}
