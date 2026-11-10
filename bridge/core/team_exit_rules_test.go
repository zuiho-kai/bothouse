package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// The workspace exit rules are one file (dsh/collab/team-exit-rules.json, mirrored into dsh_bundle);
// DSH collab runs the same cases in team-exit.test.mjs, so a rule judged differently on either side
// fails one of them.
type teamExitCases struct {
	Evidence []struct {
		Body string   `json:"body"`
		Want []string `json:"want"`
	} `json:"evidence"`
	Judge []struct {
		Name    string `json:"name"`
		Reply   string `json:"reply"`
		Known   []int  `json:"known"`
		Bounces int    `json:"bounces"`
		Want    struct {
			Kind     string   `json:"kind"`
			ID       int      `json:"id"`
			Line     string   `json:"line"`
			Problems []string `json:"problems"`
			Legacy   bool     `json:"legacy"`
		} `json:"want"`
	} `json:"judge"`
	Split []struct {
		Body string `json:"body"`
		Want struct {
			Summary string `json:"summary"`
			Detail  string `json:"detail"`
		} `json:"want"`
	} `json:"split"`
	Pick []struct {
		Name  string `json:"name"`
		Named int    `json:"named"`
		Items []struct {
			ID    int    `json:"id"`
			Here  bool   `json:"here"`
			Bound string `json:"bound"`
		} `json:"items"`
		Want int `json:"want"`
	} `json:"pick"`
	Bounce []struct {
		Kind     string   `json:"kind"`
		Problems []string `json:"problems"`
		Want     string   `json:"want"`
	} `json:"bounce"`
}

// exitRuleText resolves a case's rule key ("ask.missing_category", "headline.unknown_id:9").
func exitRuleText(t *testing.T, ref string) string {
	t.Helper()
	key, id, _ := strings.Cut(ref, ":")
	var doc map[string]map[string]any
	b, _ := embeddedDSH.ReadFile(teamExitRulesFile)
	_ = json.Unmarshal(b, &doc)
	group, name, _ := strings.Cut(key, ".")
	text, ok := doc[group][name].(string)
	if !ok {
		t.Fatalf("case names rule %q, not in %s", ref, teamExitRulesFile)
	}
	return strings.NewReplacer("{id}", id, "{hits}", id).Replace(text)
}

func TestTeamExitSharedCases(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "dsh", "collab", "test", "team-exit-cases.json"))
	if os.IsNotExist(err) {
		t.Skipf("source tree not present: %v", err)
	}
	if err != nil {
		t.Fatal(err)
	}
	var cases teamExitCases
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	texts := func(refs []string) []string {
		var out []string
		for _, r := range refs {
			out = append(out, exitRuleText(t, r))
		}
		return out
	}
	for _, c := range cases.Evidence {
		if got, want := askEvidenceProblems(c.Body), texts(c.Want); !reflect.DeepEqual(got, want) {
			t.Errorf("evidence %q = %q, want %q", c.Body, got, want)
		}
	}
	for _, c := range cases.Judge {
		kind, body, ok := parseExitKind(c.Reply)
		if !ok {
			if c.Want.Kind != "" {
				t.Errorf("judge %s: no mark read, want %q", c.Name, c.Want.Kind)
			}
			continue
		}
		if kind != c.Want.Kind {
			t.Errorf("judge %s: kind %q, want %q", c.Name, kind, c.Want.Kind)
			continue
		}
		known := func(id int) bool {
			for _, k := range c.Known {
				if k == id {
					return true
				}
			}
			return false
		}
		v := judgeExit(kind, body, false, known, c.Bounces)
		want := exitVerdict{ID: c.Want.ID, Line: c.Want.Line, Problems: texts(c.Want.Problems), Legacy: c.Want.Legacy}
		if !reflect.DeepEqual(v, want) {
			t.Errorf("judge %s: %+v, want %+v", c.Name, v, want)
		}
	}
	for _, c := range cases.Split {
		if s, d := exitSplit(c.Body); s != c.Want.Summary || d != c.Want.Detail {
			t.Errorf("split %q = %q / %q, want %q / %q", c.Body, s, d, c.Want.Summary, c.Want.Detail)
		}
	}
	for _, c := range cases.Pick {
		var items []exitTaskCand
		for _, it := range c.Items {
			items = append(items, exitTaskCand{ID: it.ID, Here: it.Here, Bound: it.Bound})
		}
		if got := exitTaskPick(c.Named, items); got != c.Want {
			t.Errorf("pick %s: %d, want %d", c.Name, got, c.Want)
		}
	}
	for _, c := range cases.Bounce {
		if got := exitBounceText(c.Kind, c.Problems); got != c.Want {
			t.Errorf("bounce %s:\n got %s\nwant %s", c.Kind, got, c.Want)
		}
	}
}

// The exit code holds no formats or texts of its own: they are read from the rules file.
func TestTeamExitRulesNotHardcoded(t *testing.T) {
	var doc struct {
		Headline map[string]string `json:"headline"`
		Ask      map[string]string `json:"ask"`
	}
	b, _ := embeddedDSH.ReadFile(teamExitRulesFile)
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	var texts []string
	for _, m := range []map[string]string{doc.Headline, doc.Ask} {
		for k, v := range m {
			if !strings.HasSuffix(k, "_re") {
				texts = append(texts, strings.SplitN(v, "（", 2)[0])
			}
		}
	}
	files := []string{"team_exit.go", "team_exit_headline.go", "team_ask_evidence.go", "team_exit_rules.go",
		filepath.Join("dsh_bundle", "collab", "team-exit.mjs")}
	for _, f := range files {
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range texts {
			if strings.Contains(string(src), s) {
				t.Errorf("%s: writes 「%s」 itself; read it from %s", f, s, teamExitRulesFile)
			}
		}
	}
}

func TestJargonProductNamesAndLinks(t *testing.T) {
	for _, text := range []string{"DeepSeek 与 OpenClaw 并排图已补", "邀请：https://discord.gg/fooBar，文档 https://example.com/a-b/file.md#123"} {
		if got := jargonProblems(text); len(got) != 0 {
			t.Errorf("%q: %v", text, got)
		}
	}
}

func TestJargonStillRejectsInternalIdentifiers(t *testing.T) {
	for _, text := range []string{"fooBar", "~/x/y", "#123", "https://discord.gg/ok 后面 fooBar"} {
		if got := jargonProblems(text); len(got) == 0 {
			t.Errorf("%q was allowed", text)
		}
	}
}

// TestSelfRouteProblems replays the two hand-offs of 11-10 (a workspace asking the user to run sudo,
// a test bridge asking him to place files) and asks that only-the-user and decision asks pass.
func TestSelfRouteProblems(t *testing.T) {
	back := []string{
		// 11-10 14:18 #1359 ws-up --ask, verbatim (user: 「你自己搞，你忘了我跟你说的事情了么」)
		"[ask] #1359 背景：成员隔离要做到系统拦截，代码已写完推上去，只差在本机真测一遍，这一步要你的管理员密码。\n做了什么：角色可以换一个单独的系统账号跑。\n要你做的：在本机终端跑一次 sudo zsh ~/.bothouse/roles/maomao/notes/runs/1359/setup-testuser.sh，输一次密码。跑完回我一句「好了」。\n我加的：新增三条命令。\n自验：本机单测过\n类别：权限确认",
		// 11-10 13:2x test bridge reply in the e2e channel (screenshot), a plain reply
		"请把更新后的规则文件和 gate 放进 /tmp/iso.O9CP9P/home/.bothouse/collaboration/。或者让我切到 iso.usWPPc 那份，我一收到确认就重交",
		"[report] #1 背景：x\n做了什么：y\n要你做的：把新包拷到 /Applications 里替换一下\n我加的：无",
		"【结论】改好了。\n【要你做的】在设置里打开辅助功能权限。",
	}
	for _, s := range back {
		if p := SelfRouteProblems(s); p == nil {
			t.Errorf("should go back: %q", s)
		} else if !strings.Contains(p[0], "换路") || !strings.Contains(p[0], "自己") {
			t.Errorf("reason must name another route: %q", p[0])
		}
	}
	pass := []string{
		"[report] #1 背景：x\n做了什么：已在本机跑过 sudo 以外的隔离测试\n要你做的：没有（命令我已跑完）\n我加的：无",
		"[ask] #2 背景：x\n做了什么：y\n要你做的：手机上扫码登录一下 B 站，我好投稿\n我加的：无",
		"[ask] #3 背景：x\n做了什么：y\n要你做的：确认付款 ¥320 下单打板\n我加的：无",
		"[ask] #4 背景：x\n做了什么：y\n要你做的：定方向：A 继续修旧版，B 换新框架；我推荐 B\n我加的：无",
		"[ask] #5 背景：x\n做了什么：y\n要你做的：同意发到 X 上吗\n我加的：无",
		"[ask] #6 背景：x\n做了什么：y\n要你做的：删掉旧的三个分支和 2 TB 缓存，删了恢复不了，同意吗\n我加的：无",
		"【结论】我已经在终端里跑过了，结果正常。\n【要你做的】没有。",
		"我把文件放进测试目录了，重启后生效。",
		// 11-07 real ask: the install after 「我就」 is the agent's own step
		"[ask] #7 背景：x\n做了什么：y\n要你做的：看一眼发版说明，回「发」我就合主干、打标签、等出包，再实装一次插件核体积和耗时。\n我加的：无",
		// 10-31 real ask: 「不用再重启」 is negated
		"[ask] #9 背景：x\n做了什么：y\n要你做的：在个人设置里生成令牌私信发我。我存进本机文件，接上就生效，不用再重启。\n我加的：无",
		// 11-10 13:53 real direction ask: 「装法上」 is a noun
		"[ask] #8 背景：x\n做了什么：y\n要你做的：二选一。A：照现在这样。B：做系统层面的拦截。我把成员命令也接到这种装法上。我推荐 B。\n我加的：无",
		// 11-10 #1364 real [report]: the scope line the skeleton makes it echo quotes 「要你做的」 — a quote, not the section
		"[report] #1364 背景：x\n做了什么：y\n要你做的：没有\n我加的：无\n细节：\n交接范围逐项：\n- 改：汇报和提问里「要你做的」出现让用户放文件、跑命令、改设置这类话，程序打回让它自己找路 —— 上一棒已做",
	}
	for _, s := range pass {
		if p := SelfRouteProblems(s); p != nil {
			t.Errorf("should pass: %q → %v", s, p)
		}
	}
	if p := ReportPreflight(back[0], ""); !strings.Contains(strings.Join(p, "；"), "换路") {
		t.Errorf("preflight misses the self-route check: %v", p)
	}
}
