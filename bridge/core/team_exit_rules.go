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
	Summary struct {
		BackgroundRe      string `json:"background_re"`
		TodoRe            string `json:"todo_re"`
		DetailRe          string `json:"detail_re"`
		MissingBackground string `json:"missing_background"`
		MissingDone       string `json:"missing_done"`
		MissingTodo       string `json:"missing_todo"`
		AddedRe           string `json:"added_re"`
		MissingAdded      string `json:"missing_added"`
	} `json:"summary"`
	Art struct {
		NotesRe        string `json:"notes_re"`
		CompareRe      string `json:"compare_re"`
		ImageRe        string `json:"image_re"`
		MissingCompare string `json:"missing_compare"`
		MissingFile    string `json:"missing_file"`
	} `json:"art"`
	Scope struct {
		SectionRe string `json:"section_re"`
		ItemRe    string `json:"item_re"`
		KeyStopRe string `json:"key_stop_re"`
		KeyTrim   string `json:"key_trim"`
		KeyRunes  int    `json:"key_runes"`
		Sep       string `json:"sep"`
		Missing   string `json:"missing"`
	} `json:"scope"`
	Generic struct {
		CCOnlyRe string `json:"cc_only_re"`
		SourceRe string `json:"source_re"`
		Msg      string `json:"msg"`
	} `json:"generic"`
	Jargon struct {
		LineRe  string `json:"line_re"`
		URLRe   string `json:"url_re"`
		TableRe string `json:"table_re"`
		Line    string `json:"line"`
		Table   string `json:"table"`
	} `json:"jargon"`
}

type teamExitRules struct {
	teamExitRulesDoc
	headline, selfCheck, category, exempt, noCheck, jargonLine, jargonTable, jargonURL *regexp.Regexp
	background, todo, detail, added                                                    *regexp.Regexp
	artNotes, artCompare, artImage                                                     *regexp.Regexp
	scopeSection, scopeItem, scopeKeyStop                                              *regexp.Regexp
	ccOnly, ccSource                                                                   *regexp.Regexp
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
		{&r.jargonURL, r.Jargon.URLRe}, {&r.jargonLine, r.Jargon.LineRe}, {&r.jargonTable, r.Jargon.TableRe},
		{&r.background, r.Summary.BackgroundRe}, {&r.todo, r.Summary.TodoRe}, {&r.detail, r.Summary.DetailRe},
		{&r.added, r.Summary.AddedRe},
		{&r.artNotes, r.Art.NotesRe}, {&r.artCompare, r.Art.CompareRe}, {&r.artImage, r.Art.ImageRe},
		{&r.scopeSection, r.Scope.SectionRe}, {&r.scopeItem, r.Scope.ItemRe}, {&r.scopeKeyStop, r.Scope.KeyStopRe},
		{&r.ccOnly, r.Generic.CCOnlyRe}, {&r.ccSource, r.Generic.SourceRe},
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

// exitHeadline reads body's first line board id and the part for the user after it (exitSplit).
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
	line, _ = exitSplit(body)
	if line == "" {
		problems = append(problems, exitRules.Headline.MissingLine)
	}
	return id, line, problems
}

// exitSplit splits a marked body, after its first line's #id, into the part posted for the user
// (background, what was done, what the user is to do, what the agent added on its own: up to and
// including the 「我加的：」 line, else the 「要你做的：」 line) and the details after it, which go under that post (user 10-30 「太多事我都忘记了。背景，例如复盘
// 问题12345有什么xxx，我做了125 xxx，已经上线了」; 10-30 「别忘了你自己加的东西，那个很重要」). Without either line the part for the user is the
// first paragraph. A 「细节：」 line opening the details only separates them and is dropped.
func exitSplit(body string) (summary, detail string) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	if m := exitRules.headline.FindStringSubmatch(strings.TrimSpace(lines[0])); m != nil {
		lines[0] = m[2]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	end := -1
	for i, l := range lines {
		if exitRules.todo.MatchString(l) {
			end = i
			break
		}
	}
	for i := end + 1; end >= 0 && i < len(lines); i++ {
		if exitRules.added.MatchString(lines[i]) {
			end = i
			break
		}
	}
	if end < 0 {
		end = len(lines) - 1
		for i, l := range lines {
			if strings.TrimSpace(l) == "" {
				end = i - 1
				break
			}
		}
	}
	summary = strings.TrimSpace(strings.Join(lines[:end+1], "\n"))
	rest := lines[end+1:]
	for len(rest) > 0 && strings.TrimSpace(rest[0]) == "" {
		rest = rest[1:]
	}
	if len(rest) > 0 && exitRules.detail.MatchString(strings.TrimSpace(rest[0])) {
		rest = rest[1:]
	}
	return summary, strings.TrimSpace(strings.Join(rest, "\n"))
}

// summaryProblems: the part for the user lacks its background, what was done, what the user is
// to do, or what the agent added that the user never asked for.
func summaryProblems(summary string) []string {
	lines := strings.Split(summary, "\n")
	var problems []string
	if !exitRules.background.MatchString(strings.TrimSpace(lines[0])) {
		problems = append(problems, exitRules.Summary.MissingBackground)
	}
	todo := -1
	for i, l := range lines {
		if exitRules.todo.MatchString(l) {
			todo = i
			break
		}
	}
	done := false
	for i := 1; i < len(lines) && !done; i++ {
		l := lines[i]
		if i == todo {
			l = l[:exitRules.todo.FindStringIndex(l)[0]]
		} else if todo >= 0 && i > todo {
			break
		}
		done = strings.TrimSpace(l) != ""
	}
	if !done {
		problems = append(problems, exitRules.Summary.MissingDone)
	}
	if todo < 0 {
		problems = append(problems, exitRules.Summary.MissingTodo)
	}
	added := false
	for _, l := range lines {
		added = added || exitRules.added.MatchString(l)
	}
	if !added {
		problems = append(problems, exitRules.Summary.MissingAdded)
	}
	return problems
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

// artReportProblems lists what a [report] on image work lacks: image work is a task whose handoff
// notes list reference images (handoff-rules.json art_ref makes image handoffs list them); its
// report must name a side-by-side image of the references and the result, and a local one must
// exist. notes is the handoff text ("" when there is none: nothing to check).
func artReportProblems(notes, body string, exists func(string) bool) []string {
	if notes == "" || !exitRules.artNotes.MatchString(notes) {
		return nil
	}
	for _, m := range exitRules.artCompare.FindAllStringSubmatch(body, -1) {
		path := strings.Trim(m[1], "`'\"「」<>()（）")
		if !exitRules.artImage.MatchString(path) {
			continue
		}
		if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") || exists(path) {
			return nil
		}
		return []string{strings.ReplaceAll(exitRules.Art.MissingFile, "{path}", path)}
	}
	return []string{exitRules.Art.MissingCompare}
}

// scopeReportProblems: a [report] that mentions none of the handoff's 「## 范围」「改」 items
// anywhere (summary and details) goes back naming them (user 11-01 「我们要提取优秀基因，但是也要
// 对我们的错误进行一个深刻的检讨和规避」: a handoff item was not done and nobody noticed on return).
// Each item's key is its text up to the first punctuation, at most key_runes runes; it and the
// body are compared without whitespace, case-folded. notes "" or no 改 items: nothing to check.
func scopeReportProblems(notes, body string) []string {
	if notes == "" {
		return nil
	}
	norm := func(s string) string {
		return strings.ToLower(strings.Join(strings.Fields(s), ""))
	}
	have := norm(body)
	var missing []string
	in := false
	for _, ln := range strings.Split(strings.ReplaceAll(notes, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(strings.TrimSpace(ln), "#") {
			in = exitRules.scopeSection.MatchString(strings.TrimSpace(ln))
			continue
		}
		m := exitRules.scopeItem.FindStringSubmatch(ln)
		if !in || m == nil {
			continue
		}
		key := m[2]
		if loc := exitRules.scopeKeyStop.FindStringIndex(key); loc != nil {
			key = key[:loc[0]]
		}
		key = strings.TrimSpace(strings.Trim(strings.TrimSpace(key), exitRules.Scope.KeyTrim))
		if r := []rune(key); exitRules.Scope.KeyRunes > 0 && len(r) > exitRules.Scope.KeyRunes {
			key = string(r[:exitRules.Scope.KeyRunes])
		}
		if k := norm(key); k != "" && !strings.Contains(have, k) {
			missing = append(missing, key)
		}
	}
	if missing == nil {
		return nil
	}
	return []string{strings.ReplaceAll(exitRules.Scope.Missing, "{items}", strings.Join(missing, exitRules.Scope.Sep))}
}

// genericReportProblems: a [report] whose 「我加的：」 line says a product capability was made for
// Claude Code only (只给/只装/只做/仅 Claude Code or cc) goes back unless the same line gives a
// 「来源：」 for why another CLI cannot have it (task #875: bothouse capabilities must work on every CLI).
func genericReportProblems(body string) []string {
	for _, ln := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		loc := exitRules.added.FindStringIndex(ln)
		if loc == nil {
			continue
		}
		rest := ln[loc[1]:]
		if hit := exitRules.ccOnly.FindString(rest); hit != "" && !exitRules.ccSource.MatchString(rest) {
			return []string{strings.ReplaceAll(exitRules.Generic.Msg, "{hit}", strings.TrimSpace(hit))}
		}
	}
	return nil
}

// jargonProblems: the part for the user names board/PR numbers, workspaces, branches, paths or
// code identifiers, or holds a table (user 10-30 复盘「汇报堆编号、表格、工作区代号，要追问才知道进度」).
func jargonProblems(line string) []string {
	var problems []string
	var hits []string
	for _, m := range exitRules.jargonLine.FindAllString(exitRules.jargonURL.ReplaceAllString(line, " "), -1) {
		hits = append(hits, strings.TrimLeftFunc(m, jargonLead))
	}
	if len(hits) > 0 {
		problems = append(problems, strings.ReplaceAll(exitRules.Jargon.Line, "{hits}", strings.Join(hits, "、")))
	}
	if exitRules.jargonTable.MatchString(line) {
		problems = append(problems, exitRules.Jargon.Table)
	}
	return problems
}

// jargonLead: a character a jargon match took only as its left boundary.
func jargonLead(r rune) bool {
	return !(r < 0x80 && (r == '~' || r == '/' || r == '`' || r == '#' || r == '!' || r == '_' || r == '-' ||
		r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z')) && r != '＃' && r != '！' && r != '工'
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
	Line     string   // the part for the user after the id (exitSplit)
	Problems []string // why it goes back to the workspace; nil: it goes to the chat channel
	Legacy   bool     // the format is still wrong but bounces stopped waking the bot: the chat lead rewrites it
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
	} else if hp == nil {
		hp = append(summaryProblems(v.Line), jargonProblems(v.Line)...)
	}
	// Format goes back only while bounces still wake the bot; after that the chat lead rewrites it
	// (user 10-30: not posted as written any more). A missing [ask] self-check always goes back.
	if hp != nil && v.Problems == nil && bounces >= exitRules.Bounce.WakeLimit {
		v.Legacy = true
	} else {
		v.Problems = append(v.Problems, hp...)
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
