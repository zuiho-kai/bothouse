package core

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// teamExitRulesFile is the one copy of the workspace [ask]/[report] rules: first-line mark and #id
// format, the [ask] self-check, bounce texts. dsh/collab/team-exit-rules.json is mirrored into
// dsh_bundle/collab; DSH collab (team-exit.mjs) reads the same file, and both sides run the shared
// cases in dsh/collab/test/team-exit-cases.json (TestTeamExitSharedCases; team-exit.test.mjs). No
// formats or texts live here.
const teamExitRulesFile = "dsh_bundle/collab/team-exit-rules.json"

type teamExitRulesDoc struct {
	Kinds      []string `json:"kinds"`
	Mark       string   `json:"mark"`
	HeadlineRe string   `json:"headline_re"`
	Headline   struct {
		MissingID     string `json:"missing_id"`
		MissingLine   string `json:"missing_line"`
		MissingMarker string `json:"missing_marker"`
		UnknownID     string `json:"unknown_id"`
	} `json:"headline"`
	Ask struct {
		SelfCheckRe      string `json:"self_check_re"`
		CategoryRe       string `json:"category_re"`
		ExemptRe         string `json:"exempt_re"`
		NoCheckRe        string `json:"no_check_re"`
		MissingSelfCheck string `json:"missing_self_check"`
		MissingCategory  string `json:"missing_category"`
		NoCheckNotExempt string `json:"no_check_not_exempt"`
	} `json:"ask"`
	Bounce struct {
		Text      string            `json:"text"`
		Sep       string            `json:"sep"`
		Extra     map[string]string `json:"extra"`
		WakeLimit int               `json:"wake_limit"`
	} `json:"bounce"`
	Jargon struct {
		LineRe  string `json:"line_re"`
		TableRe string `json:"table_re"`
		Line    string `json:"line"`
		Table   string `json:"table"`
	} `json:"jargon"`
}

type teamExitRules struct {
	teamExitRulesDoc
	headline, selfCheck, category, exempt, noCheck, jargonLine, jargonTable *regexp.Regexp
}

// exitRules is read once from the embedded copy; a broken file fails every test that touches it.
var exitRules = func() *teamExitRules {
	b, err := embeddedDSH.ReadFile(teamExitRulesFile)
	if err != nil {
		panic("team exit rules: " + err.Error())
	}
	r, err := parseTeamExitRules(b)
	if err != nil {
		panic("team exit rules: " + err.Error())
	}
	return r
}()

func parseTeamExitRules(b []byte) (*teamExitRules, error) {
	r := &teamExitRules{}
	if err := json.Unmarshal(b, &r.teamExitRulesDoc); err != nil {
		return nil, err
	}
	for _, c := range []struct {
		dst **regexp.Regexp
		src string
	}{
		{&r.headline, r.HeadlineRe}, {&r.selfCheck, r.Ask.SelfCheckRe}, {&r.category, r.Ask.CategoryRe},
		{&r.exempt, r.Ask.ExemptRe}, {&r.noCheck, r.Ask.NoCheckRe},
		{&r.jargonLine, r.Jargon.LineRe}, {&r.jargonTable, r.Jargon.TableRe},
	} {
		re, err := regexp.Compile(c.src)
		if err != nil {
			return nil, err
		}
		*c.dst = re
	}
	return r, nil
}

// parseExitKind reads an [ask] / [report] marker on the reply's first line.
func parseExitKind(text string) (kind, body string, ok bool) {
	t := strings.TrimLeft(text, " \t\r\n")
	for _, k := range exitRules.Kinds {
		tag := strings.ReplaceAll(exitRules.Mark, "{kind}", k)
		if len(t) >= len(tag) && strings.EqualFold(t[:len(tag)], tag) {
			body = strings.TrimSpace(t[len(tag):])
			if body == "" {
				return "", "", false
			}
			return k, body, true
		}
	}
	return "", "", false
}

// exitHeadline splits body's first line into the board id and the sentence for the user.
func exitHeadline(body string) (id int, line string, problems []string) {
	first := strings.TrimSpace(strings.SplitN(body, "\n", 2)[0])
	m := exitRules.headline.FindStringSubmatch(first)
	if m == nil {
		problems = append(problems, exitRules.Headline.MissingID)
		if first == "" || strings.HasPrefix(first, "#") {
			problems = append(problems, exitRules.Headline.MissingLine)
		}
		return 0, "", problems
	}
	id, _ = strconv.Atoi(m[1])
	line = strings.TrimSpace(m[2])
	if line == "" {
		problems = append(problems, exitRules.Headline.MissingLine)
	}
	return id, line, problems
}

// askEvidenceProblems lists what an [ask] body lacks; nil means it may go to the user.
func askEvidenceProblems(body string) []string {
	var problems []string
	cat := ""
	if loc := exitRules.category.FindStringIndex(body); loc != nil {
		cat = strings.TrimSpace(strings.SplitN(body[loc[1]:], "\n", 2)[0])
	}
	check := ""
	if loc := exitRules.selfCheck.FindStringIndex(body); loc != nil {
		rest := body[loc[1]:]
		if next := exitRules.category.FindStringIndex(rest); next != nil {
			rest = rest[:next[0]]
		}
		check = strings.TrimSpace(rest)
	}
	if check == "" {
		problems = append(problems, exitRules.Ask.MissingSelfCheck)
	}
	if cat == "" {
		problems = append(problems, exitRules.Ask.MissingCategory)
	}
	if check != "" && cat != "" && exitRules.noCheck.MatchString(check) && !exitRules.exempt.MatchString(cat) {
		problems = append(problems, exitRules.Ask.NoCheckNotExempt)
	}
	return problems
}

// jargonProblems: the sentence for the user names board/PR numbers, workspaces or branches, or the
// body holds a table (user 10-30 复盘「汇报堆编号、表格、工作区代号，要追问才知道进度」).
func jargonProblems(line, body string) []string {
	var problems []string
	var hits []string
	for _, m := range exitRules.jargonLine.FindAllString(line, -1) {
		hits = append(hits, strings.TrimLeft(m, " \t（(，,：:、"))
	}
	if len(hits) > 0 {
		problems = append(problems, strings.ReplaceAll(exitRules.Jargon.Line, "{hits}", strings.Join(hits, "、")))
	}
	if exitRules.jargonTable.MatchString(body) {
		problems = append(problems, exitRules.Jargon.Table)
	}
	return problems
}

// exitBounceText: why a workspace [ask]/[report] stayed in the workspace and how to resend it.
func exitBounceText(kind string, problems []string) string {
	return strings.NewReplacer(
		"{kind}", kind,
		"{problems}", strings.Join(problems, exitRules.Bounce.Sep),
		"{extra}", exitRules.Bounce.Extra[kind],
	).Replace(exitRules.Bounce.Text)
}

// exitVerdict is how a marked workspace reply is judged.
type exitVerdict struct {
	ID       int      // the first line's board id (0 when it has none)
	Line     string   // the first line's sentence for the user
	Problems []string // why it goes back to the workspace; nil: it goes to the chat channel
	Legacy   bool     // the headline is wrong but bounces stopped waking the bot: forwarded without it
}

// judgeExit judges a marked reply's body. auto: the reply had no mark (an unmarked turn end
// answering a handoff). known reports whether a board id is on the board; bounces is how many
// replies in a row went back already.
func judgeExit(kind, body string, auto bool, known func(int) bool, bounces int) exitVerdict {
	var v exitVerdict
	if kind == exitKindAsk {
		v.Problems = askEvidenceProblems(body)
	}
	var hp []string
	if auto {
		hp = []string{exitRules.Headline.MissingMarker}
	} else if v.ID, v.Line, hp = exitHeadline(body); hp == nil && !known(v.ID) {
		hp = []string{strings.ReplaceAll(exitRules.Headline.UnknownID, "{id}", strconv.Itoa(v.ID))}
	}
	if hp != nil && v.Problems == nil && bounces >= exitRules.Bounce.WakeLimit {
		v.Legacy = true
	} else {
		v.Problems = append(v.Problems, hp...)
	}
	// Wording goes back only while bounces still wake the bot; after that it is posted as written.
	if hp == nil && bounces < exitRules.Bounce.WakeLimit {
		v.Problems = append(v.Problems, jargonProblems(v.Line, body)...)
	}
	return v
}

// exitTaskCand is a task a workspace reply may be about: here when it is bound to that workspace,
// bound when it was bound (compared as written).
type exitTaskCand struct {
	ID    int
	Here  bool
	Bound string
}

// exitTaskPick is the task a workspace reply is about: the one its first line names when that one
// is bound to this workspace, else the one bound here last; 0 when none is here.
func exitTaskPick(named int, items []exitTaskCand) int {
	pick, last := 0, ""
	for _, it := range items {
		if !it.Here {
			continue
		}
		if named > 0 && it.ID == named {
			return named
		}
		if pick == 0 || it.Bound > last {
			pick, last = it.ID, it.Bound
		}
	}
	return pick
}
