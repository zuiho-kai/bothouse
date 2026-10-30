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
	return strings.ReplaceAll(text, "{id}", id)
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
