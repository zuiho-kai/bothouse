package team

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	teamrules "github.com/chenhg5/cc-connect/core/team_rules"
)

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
		GiveRe            string `json:"give_re"`
		GiveNoneRe        string `json:"give_none_re"`
		GiveItemRe        string `json:"give_item_re"`
		MissingGive       string `json:"missing_give"`
		BadGive           string `json:"bad_give"`
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
	Entry struct {
		LabelRe     string `json:"label_re"`
		PathRe      string `json:"path_re"`
		FileRe      string `json:"file_re"`
		URLRe       string `json:"url_re"`
		Missing     string `json:"missing"`
		MissingFile string `json:"missing_file"`
	} `json:"entry"`
	Generic struct {
		CCOnlyRe string `json:"cc_only_re"`
		SourceRe string `json:"source_re"`
		Msg      string `json:"msg"`
	} `json:"generic"`
	SelfRoute struct {
		TodoRe     string `json:"todo_re"`
		EndRe      string `json:"end_re"`
		NoneRe     string `json:"none_re"`
		AskLineRe  string `json:"ask_line_re"`
		HandRe     string `json:"hand_re"`
		MineRe     string `json:"mine_re"`
		NegRe      string `json:"neg_re"`
		OnlyUserRe string `json:"only_user_re"`
		Msg        string `json:"msg"`
	} `json:"self_route"`
	Jargon struct {
		LineRe  string `json:"line_re"`
		URLRe   string `json:"url_re"`
		TableRe string `json:"table_re"`
		Line    string `json:"line"`
		Table   string `json:"table"`
	} `json:"jargon"`
	Length struct {
		MaxSentences int      `json:"max_sentences"`
		EndRe        string   `json:"end_re"`
		Parts        []string `json:"parts"`
		Msg          string   `json:"msg"`
	} `json:"length"`
}

type teamExitRules struct {
	teamExitRulesDoc
	headline, selfCheck, category, exempt, noCheck, jargonLine, jargonTable, jargonURL *regexp.Regexp
	background, todo, detail, added, give, giveNone, giveItem                          *regexp.Regexp
	artNotes, artCompare, artImage                                                     *regexp.Regexp
	scopeSection, scopeItem, scopeKeyStop                                              *regexp.Regexp
	ccOnly, ccSource                                                                   *regexp.Regexp
	entryLabel, entryPath, entryFile, entryURL                                         *regexp.Regexp
	srTodo, srEnd, srNone, srAskLine, srHand, srMine, srNeg, srOnlyUser                *regexp.Regexp
	sentenceEnd                                                                        *regexp.Regexp
}

// ExitRules is read once from the embedded file (core/team_rules/team-exit-rules.json); a broken file fails every test that touches it.
var ExitRules = func() *teamExitRules {
	r, err := parseTeamExitRules(teamrules.ExitRules)
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
		{&r.added, r.Summary.AddedRe}, {&r.give, r.Summary.GiveRe}, {&r.giveNone, r.Summary.GiveNoneRe},
		{&r.giveItem, r.Summary.GiveItemRe},
		{&r.artNotes, r.Art.NotesRe}, {&r.artCompare, r.Art.CompareRe}, {&r.artImage, r.Art.ImageRe},
		{&r.scopeSection, r.Scope.SectionRe}, {&r.scopeItem, r.Scope.ItemRe}, {&r.scopeKeyStop, r.Scope.KeyStopRe},
		{&r.ccOnly, r.Generic.CCOnlyRe}, {&r.ccSource, r.Generic.SourceRe},
		{&r.entryLabel, r.Entry.LabelRe}, {&r.entryPath, r.Entry.PathRe}, {&r.entryFile, r.Entry.FileRe},
		{&r.entryURL, r.Entry.URLRe},
		{&r.srTodo, r.SelfRoute.TodoRe}, {&r.srEnd, r.SelfRoute.EndRe}, {&r.srNone, r.SelfRoute.NoneRe},
		{&r.srAskLine, r.SelfRoute.AskLineRe},
		{&r.srHand, r.SelfRoute.HandRe}, {&r.srMine, r.SelfRoute.MineRe},
		{&r.srNeg, r.SelfRoute.NegRe}, {&r.srOnlyUser, r.SelfRoute.OnlyUserRe},
		{&r.sentenceEnd, r.Length.EndRe},
	} {
		re, err := regexp.Compile(c.src)
		if err != nil {
			return nil, err
		}
		*c.dst = re
	}
	return r, nil
}

// ParseExitKind reads an [ask] / [report] marker on the reply's first line.
func ParseExitKind(text string) (kind, body string, ok bool) {
	t := strings.TrimLeft(text, " \t\r\n")
	for _, k := range ExitRules.Kinds {
		tag := strings.ReplaceAll(ExitRules.Mark, "{kind}", k)
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

// ExitHeadline reads body's first line board id and the part for the user after it (ExitSplit).
func ExitHeadline(body string) (id int, line string, problems []string) {
	first := strings.TrimSpace(strings.SplitN(body, "\n", 2)[0])
	m := ExitRules.headline.FindStringSubmatch(first)
	if m == nil {
		problems = append(problems, ExitRules.Headline.MissingID)
		if first == "" || strings.HasPrefix(first, "#") {
			problems = append(problems, ExitRules.Headline.MissingLine)
		}
		return 0, "", problems
	}
	id, _ = strconv.Atoi(m[1])
	line, _ = ExitSplit(body)
	if line == "" {
		problems = append(problems, ExitRules.Headline.MissingLine)
	}
	return id, line, problems
}

// ExitSplit splits a marked body, after its first line's #id, into the part posted for the user
// (background, what was done, what the user is to do, what the agent added on its own: up to and
// including the 「我加的：」 line, else the 「要你做的：」 line) and the details after it, which go under that post (user 10-30 「太多事我都忘记了。背景，例如复盘
// 问题12345有什么xxx，我做了125 xxx，已经上线了」; 10-30 「别忘了你自己加的东西，那个很重要」). Without either line the part for the user is the
// first paragraph. A 「细节：」 line opening the details only separates them and is dropped.
func ExitSplit(body string) (summary, detail string) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	if m := ExitRules.headline.FindStringSubmatch(strings.TrimSpace(lines[0])); m != nil {
		lines[0] = m[2]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	end := -1
	for i, l := range lines {
		if ExitRules.todo.MatchString(l) {
			end = i
			break
		}
	}
	for i := end + 1; end >= 0 && i < len(lines); i++ {
		if ExitRules.added.MatchString(lines[i]) {
			end = i
			break
		}
	}
	// #1982: 「给你的：」 goes to the user with the four parts, also when written after 「我加的：」.
	for i := end + 1; end >= 0 && i < len(lines) && i <= end+2; i++ {
		if ExitRules.give.MatchString(lines[i]) {
			end = i
			break
		}
		if strings.TrimSpace(lines[i]) != "" {
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
	if len(rest) > 0 && ExitRules.detail.MatchString(strings.TrimSpace(rest[0])) {
		rest = rest[1:]
	}
	return summary, strings.TrimSpace(strings.Join(rest, "\n"))
}

// summaryProblems: the part for the user lacks its background, what was done, what the user is
// to do, or what the agent added that the user never asked for.
func summaryProblems(summary string) []string {
	lines := strings.Split(summary, "\n")
	var problems []string
	if !ExitRules.background.MatchString(strings.TrimSpace(lines[0])) {
		problems = append(problems, ExitRules.Summary.MissingBackground)
	}
	todo := -1
	for i, l := range lines {
		if ExitRules.todo.MatchString(l) {
			todo = i
			break
		}
	}
	done := false
	for i := 1; i < len(lines) && !done; i++ {
		l := lines[i]
		if i == todo {
			l = l[:ExitRules.todo.FindStringIndex(l)[0]]
		} else if todo >= 0 && i > todo {
			break
		}
		done = strings.TrimSpace(l) != ""
	}
	if !done {
		problems = append(problems, ExitRules.Summary.MissingDone)
	}
	if todo < 0 {
		problems = append(problems, ExitRules.Summary.MissingTodo)
	}
	added := false
	for _, l := range lines {
		added = added || ExitRules.added.MatchString(l)
	}
	if !added {
		problems = append(problems, ExitRules.Summary.MissingAdded)
	}
	return problems
}

// GiveLine: the value of the part for the user's 「给你的：」 line (#1982) and whether it has one.
func GiveLine(summary string) (string, bool) {
	for _, l := range strings.Split(summary, "\n") {
		if loc := ExitRules.give.FindStringIndex(l); loc != nil {
			return strings.TrimSpace(l[loc[1]:]), true
		}
	}
	return "", false
}

// withoutGive: the part for the user without its 「给你的：」 line, which may carry paths and links
// and is not one of the parts the sentence limit counts.
func withoutGive(summary string) string {
	var keep []string
	for _, l := range strings.Split(summary, "\n") {
		if !ExitRules.give.MatchString(l) {
			keep = append(keep, l)
		}
	}
	return strings.Join(keep, "\n")
}

// GiveProblems: a report's part for the user has no 「给你的：」 line, or one that names neither a
// link nor a file path nor 「无」 (#1982, user 11-25 「加一个栏目就是返回给用户的东西没有可以填无」).
func GiveProblems(summary string) []string {
	v, ok := GiveLine(summary)
	if !ok {
		return []string{ExitRules.Summary.MissingGive}
	}
	if ExitRules.giveNone.MatchString(v) || ExitRules.giveItem.MatchString(" "+v) {
		return nil
	}
	return []string{strings.ReplaceAll(ExitRules.Summary.BadGive, "{v}", v)}
}

// LengthProblems: a part for the user over the sentence limit (user 11-10「为什么回复那么长」「把这个太长也
// 处理一下」: a 6–7 sentence 背景/做了什么 reached the chat channel as written). It goes back to be
// rewritten, never cut. Parts: line 0 背景; then 做了什么 up to the 「要你做的：」 match; 要你做的 up to the
// 「我加的：」 line; 我加的 to the end.
func LengthProblems(summary string) []string {
	max := ExitRules.Length.MaxSentences
	if max <= 0 || len(ExitRules.Length.Parts) < 4 {
		return nil
	}
	texts := make([]string, 4)
	part := 0
	for i, l := range strings.Split(summary, "\n") {
		if i > 0 && part == 0 {
			part = 1
		}
		if part < 2 {
			if loc := ExitRules.todo.FindStringIndex(l); loc != nil {
				texts[part] += " " + l[:loc[0]]
				part, l = 2, l[loc[0]:]
			}
		}
		if part < 3 && ExitRules.added.MatchString(l) {
			part = 3
		}
		texts[part] += " " + l
	}
	var problems []string
	for i, t := range texts {
		if n := sentenceCount(t); n > max {
			problems = append(problems, strings.NewReplacer("{part}", ExitRules.Length.Parts[i],
				"{n}", strconv.Itoa(n), "{max}", strconv.Itoa(max)).Replace(ExitRules.Length.Msg))
		}
	}
	return problems
}

// sentenceCount: sentences in s, split at sentence ends; a tail with no end counts as one.
func sentenceCount(s string) int {
	n := 0
	for _, seg := range ExitRules.sentenceEnd.Split(s, -1) {
		if strings.TrimSpace(seg) != "" {
			n++
		}
	}
	return n
}

// AskEvidenceProblems lists what an [ask] body lacks; nil means it may go to the user.
func AskEvidenceProblems(body string) []string {
	var problems []string
	cat := ""
	if loc := ExitRules.category.FindStringIndex(body); loc != nil {
		cat = strings.TrimSpace(strings.SplitN(body[loc[1]:], "\n", 2)[0])
	}
	check := ""
	if loc := ExitRules.selfCheck.FindStringIndex(body); loc != nil {
		rest := body[loc[1]:]
		if next := ExitRules.category.FindStringIndex(rest); next != nil {
			rest = rest[:next[0]]
		}
		check = strings.TrimSpace(rest)
	}
	if check == "" {
		problems = append(problems, ExitRules.Ask.MissingSelfCheck)
	}
	if cat == "" {
		problems = append(problems, ExitRules.Ask.MissingCategory)
	}
	if check != "" && cat != "" && ExitRules.noCheck.MatchString(check) && !ExitRules.exempt.MatchString(cat) {
		problems = append(problems, ExitRules.Ask.NoCheckNotExempt)
	}
	return problems
}

// ArtReportProblems lists what a [report] on image work lacks: image work is a task whose handoff
// notes list reference images (handoff-rules.json art_ref makes image handoffs list them); its
// report must name a side-by-side image of the references and the result, and a local one must
// exist. notes is the handoff text ("" when there is none: nothing to check).
func ArtReportProblems(notes, body string, exists func(string) bool) []string {
	if notes == "" || !ExitRules.artNotes.MatchString(notes) {
		return nil
	}
	for _, m := range ExitRules.artCompare.FindAllStringSubmatch(body, -1) {
		path := strings.Trim(m[1], "`'\"「」<>()（）")
		if !ExitRules.artImage.MatchString(path) {
			continue
		}
		if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") || exists(path) {
			return nil
		}
		return []string{strings.ReplaceAll(ExitRules.Art.MissingFile, "{path}", path)}
	}
	return []string{ExitRules.Art.MissingCompare}
}

// ScopeReportProblems: a [report] that mentions none of the handoff's 「## 范围」「改」 items
// anywhere (summary and details) goes back naming them (user 11-01 「我们要提取优秀基因，但是也要
// 对我们的错误进行一个深刻的检讨和规避」: a handoff item was not done and nobody noticed on return).
// Each item's key is its text up to the first punctuation, at most key_runes runes; it and the
// body are compared without whitespace, case-folded. notes "" or no 改 items: nothing to check.
func ScopeReportProblems(notes, body string) []string {
	norm := func(s string) string {
		return strings.ToLower(strings.Join(strings.Fields(s), ""))
	}
	have := norm(body)
	var missing []string
	for _, it := range scopeChangeItems(notes) {
		if k := norm(it.Key); k != "" && !strings.Contains(have, k) {
			missing = append(missing, it.Key)
		}
	}
	if missing == nil {
		return nil
	}
	return []string{strings.ReplaceAll(ExitRules.Scope.Missing, "{items}", strings.Join(missing, ExitRules.Scope.Sep))}
}

// scopeItem is one 「改」 item of a handoff's 「## 范围」: Text as written after 「改：」, Key what a
// report must mention (Text up to the first punctuation, at most key_runes runes).
type scopeItem struct{ Text, Key string }

// scopeChangeItems lists the 「改」 items of the handoff's 「## 范围」 (notes "": none).
func scopeChangeItems(notes string) []scopeItem {
	var items []scopeItem
	in := false
	for _, ln := range strings.Split(strings.ReplaceAll(notes, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(strings.TrimSpace(ln), "#") {
			in = ExitRules.scopeSection.MatchString(strings.TrimSpace(ln))
			continue
		}
		m := ExitRules.scopeItem.FindStringSubmatch(ln)
		if !in || m == nil {
			continue
		}
		key := m[2]
		if loc := ExitRules.scopeKeyStop.FindStringIndex(key); loc != nil {
			key = key[:loc[0]]
		}
		key = strings.TrimSpace(strings.Trim(strings.TrimSpace(key), ExitRules.Scope.KeyTrim))
		if r := []rune(key); ExitRules.Scope.KeyRunes > 0 && len(r) > ExitRules.Scope.KeyRunes {
			key = string(r[:ExitRules.Scope.KeyRunes])
		}
		items = append(items, scopeItem{Text: strings.TrimSpace(m[2]), Key: key})
	}
	return items
}

// EntryReportProblems: a [report] must carry evidence that the work was walked through where the
// user actually uses it (user 11-10 「都做」 on 「交回前必须在你实际用的入口走一遍并带证据，没有就交不出去」).
// The evidence is on a 「入口自验：」 line or the lines right after it (up to a blank line, a fenced
// block that opens there runs to its close): a screenshot / recording / deliverable path (local
// ones must exist), a link, or command output in a ``` block. A bare 「已验」 is not evidence. A
// report waiting on something outside (「等外部：」) has not delivered yet and is not checked.
func EntryReportProblems(body string, exists func(string) bool) []string {
	if _, _, waiting := WaitExternalOf(body); waiting {
		return nil
	}
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	found := false
	var missing []string
	for i := 0; i < len(lines); i++ {
		loc := ExitRules.entryLabel.FindStringIndex(lines[i])
		if loc == nil {
			continue
		}
		block := []string{lines[i][loc[1]:]}
		fence := false
		for j := i + 1; j < len(lines); j++ {
			t := strings.TrimSpace(lines[j])
			if strings.HasPrefix(t, "```") {
				if fence {
					found = true // a closed fenced block: command output pasted as evidence
				}
				fence = !fence
				continue
			}
			if !fence && (t == "" || ExitRules.entryLabel.MatchString(lines[j])) {
				break
			}
			block = append(block, lines[j])
		}
		for _, ln := range block {
			if ExitRules.entryURL.MatchString(ln) {
				found = true
			}
			for _, p := range ExitRules.entryPath.FindAllString(ExitRules.entryURL.ReplaceAllString(ln, " "), -1) {
				p = strings.TrimRight(p, ".:：。")
				if !ExitRules.entryFile.MatchString(p) {
					continue
				}
				if exists(p) {
					found = true
				} else {
					missing = append(missing, p)
				}
			}
		}
	}
	if len(missing) > 0 {
		return []string{strings.ReplaceAll(ExitRules.Entry.MissingFile, "{path}", missing[0])}
	}
	if !found {
		return []string{ExitRules.Entry.Missing}
	}
	return nil
}

// GenericReportProblems: a [report] whose 「我加的：」 line says a product capability was made for
// Claude Code only (只给/只装/只做/仅 Claude Code or cc) goes back unless the same line gives a
// 「来源：」 for why another CLI cannot have it (task #875: bothouse capabilities must work on every CLI).
func GenericReportProblems(body string) []string {
	for _, ln := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		loc := ExitRules.added.FindStringIndex(ln)
		if loc == nil {
			continue
		}
		rest := ln[loc[1]:]
		if hit := ExitRules.ccOnly.FindString(rest); hit != "" && !ExitRules.ccSource.MatchString(rest) {
			return []string{strings.ReplaceAll(ExitRules.Generic.Msg, "{hit}", strings.TrimSpace(hit))}
		}
	}
	return nil
}

// SelfRouteProblems: the 「要你做的」 part of an [ask]/[report] (or a reply to the user) hands the user
// work the agent could do itself: put a file somewhere, run a command, change a setting (user 11-10
// 「你自己搞，你忘了我跟你说的事情了么」; the plan he approved: what can be undone, the agent does; only
// real money, publishing, deleting and a change of direction go to him). The reason names the hit
// and the other routes to try. Things only the user can do (scan a code, a verification code,
// paying, hands on hardware) pass. nil: nothing to send back.
func SelfRouteProblems(body string) []string {
	if hit := selfRouteHit(body); hit != "" {
		return []string{strings.ReplaceAll(ExitRules.SelfRoute.Msg, "{hit}", hit)}
	}
	return nil
}

// selfRouteHit: the first hand-off phrase in the 「要你做的」 part, "" when there is none. Text with
// no 「要你做的」 at all (a plain reply in a chat channel) is read line by line: a line that asks
// something of the reader (「请把……」「你先……」) is checked the same way.
func selfRouteHit(body string) string {
	parts, hasTodo := todoSections(body)
	if !hasTodo {
		lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
		inFence := false
		for _, ln := range lines {
			trim := strings.TrimSpace(ln)
			if strings.HasPrefix(trim, "```") {
				inFence = !inFence
				continue
			}
			if inFence || strings.HasPrefix(trim, ">") {
				continue
			}
			if isDetailStart(ln) {
				break
			}
			if ExitRules.srAskLine.MatchString(ln) {
				if hit := handHit(ln); hit != "" {
					return hit
				}
			}
		}
		return ""
	}
	for _, p := range parts {
		if hit := handHit(p); hit != "" {
			return hit
		}
	}
	return ""
}

// isDetailStart reports whether ln opens the 「细节」 section of a report (「细节」, 「细节：」, or
// 「细节：...」 at line start). Everything from that line onward is evidence, scope echoes, or
// quoted user words, never the report's 「要你做的」.
func isDetailStart(ln string) bool {
	trim := strings.TrimSpace(ln)
	if ExitRules.detail.MatchString(trim) {
		return true
	}
	if !strings.HasPrefix(trim, "细节") {
		return false
	}
	rest := strings.TrimLeft(trim[len("细节"):], "\t 　")
	return strings.HasPrefix(rest, "：") || strings.HasPrefix(rest, ":")
}

// inQuotesAt reports whether byte offset pos in ln lies inside a quoted span: paired quotes
// (「…」/『…』/“…”/‘…’, tracking nesting so nested 「…」 stays quoted) or a matched pair of
// symmetric quotes ("…" / `…`) on the same line.
func inQuotesAt(ln string, pos int) bool {
	var cjk1, cjk2, curly2, curly1 int
	inDouble, inTick := false, false
	for i, r := range ln {
		if i >= pos {
			break
		}
		switch r {
		case '「':
			cjk1++
		case '」':
			if cjk1 > 0 {
				cjk1--
			}
		case '『':
			cjk2++
		case '』':
			if cjk2 > 0 {
				cjk2--
			}
		case '“':
			curly2++
		case '”':
			if curly2 > 0 {
				curly2--
			}
		case '‘':
			curly1++
		case '’':
			if curly1 > 0 {
				curly1--
			}
		case '"':
			if inDouble {
				inDouble = false
			} else if strings.IndexByte(ln[i+1:], '"') >= 0 {
				inDouble = true
			}
		case '`':
			if inTick {
				inTick = false
			} else if strings.IndexByte(ln[i+1:], '`') >= 0 {
				inTick = true
			}
		}
	}
	return cjk1 > 0 || cjk2 > 0 || curly2 > 0 || curly1 > 0 || inDouble || inTick
}

// todoHeaderIndex returns the first unquoted 「要你做的」/「要你定的」 header match in ln.
func todoHeaderIndex(ln string) []int {
	for _, loc := range ExitRules.srTodo.FindAllStringIndex(ln, -1) {
		if !inQuotesAt(ln, loc[0]) {
			return loc
		}
	}
	return nil
}

// todoSections extracts every 「要你做的」/「要你定的」 section before 「细节」 (and stops once
// 「我加的：」 appears after a 「要你做的」 section). Fenced code blocks, blockquotes, and quoted
// mentions (such as 「...要你做的：...」 in quoted replies or background text) are skipped so they
// are never mistaken for the report's 「要你做的」 section. hasTodo is true when at least one
// section header was found, even if its body says 没有/无.
func todoSections(body string) (parts []string, hasTodo bool) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	inFence := false
	for i := 0; i < len(lines); i++ {
		ln := lines[i]
		trim := strings.TrimSpace(ln)
		if strings.HasPrefix(trim, "```") {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		if isDetailStart(ln) || (hasTodo && ExitRules.added.MatchString(ln)) {
			break
		}
		if strings.HasPrefix(trim, ">") {
			continue
		}
		loc := todoHeaderIndex(ln)
		if loc == nil {
			continue
		}
		hasTodo = true
		first := ln[loc[1]:]
		if ExitRules.srNone.MatchString(first) {
			continue
		}
		sec := []string{first}
		for i+1 < len(lines) {
			next := lines[i+1]
			if ExitRules.srEnd.MatchString(next) || isDetailStart(next) {
				break
			}
			i++
			sec = append(sec, next)
		}
		parts = append(parts, strings.Join(sec, "\n"))
	}
	return parts, hasTodo
}

// handHit: the hand-off phrase in s, "" when s has none or names something only the user can do. A
// phrase after 「我就/我再/我来……」 is the agent's own next step, not the user's (11-07 「回「发」我就合主干……
// 再实装一次」); one right after 「不用/无需/别」 is negated (10-31 「接上就生效，不用再重启」).
func handHit(s string) string {
	if ExitRules.srOnlyUser.MatchString(s) {
		return ""
	}
	for _, loc := range ExitRules.srHand.FindAllStringIndex(s, -1) {
		if pre := s[:loc[0]]; !ExitRules.srMine.MatchString(pre) && !ExitRules.srNeg.MatchString(pre) {
			return strings.TrimSpace(s[loc[0]:loc[1]])
		}
	}
	return ""
}

// JargonProblems: the part for the user names board/PR numbers, workspaces, branches, paths or
// code identifiers, or holds a table (user 10-30 复盘「汇报堆编号、表格、工作区代号，要追问才知道进度」).
func JargonProblems(line string) []string {
	var problems []string
	var hits []string
	for _, m := range ExitRules.jargonLine.FindAllString(ExitRules.jargonURL.ReplaceAllString(line, " "), -1) {
		hits = append(hits, strings.TrimLeftFunc(m, jargonLead))
	}
	if len(hits) > 0 {
		problems = append(problems, strings.ReplaceAll(ExitRules.Jargon.Line, "{hits}", strings.Join(hits, "、")))
	}
	if ExitRules.jargonTable.MatchString(line) {
		problems = append(problems, ExitRules.Jargon.Table)
	}
	return problems
}

// jargonLead: a character a jargon match took only as its left boundary.
func jargonLead(r rune) bool {
	return !(r < 0x80 && (r == '~' || r == '/' || r == '`' || r == '#' || r == '!' || r == '_' || r == '-' ||
		r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z')) && r != '＃' && r != '！' && r != '工'
}

// ExitBounceText: why a workspace [ask]/[report] stayed in the workspace and how to resend it.
func ExitBounceText(kind string, problems []string) string {
	return strings.NewReplacer(
		"{kind}", kind,
		"{problems}", strings.Join(problems, ExitRules.Bounce.Sep),
		"{extra}", ExitRules.Bounce.Extra[kind],
	).Replace(ExitRules.Bounce.Text)
}

// ExitVerdict is how a marked workspace reply is judged.
type ExitVerdict struct {
	ID       int      // the first line's board id (0 when it has none)
	Line     string   // the part for the user after the id (ExitSplit)
	Problems []string // why it goes back to the workspace; nil: it goes to the chat channel
	Legacy   bool     // the format is still wrong but bounces stopped waking the bot: the chat lead rewrites it
}

// JudgeExit judges a marked reply's body. auto: the reply had no mark (an unmarked turn end
// answering a handoff). known reports whether a board id is on the board; bounces is how many
// replies in a row went back already.
func JudgeExit(kind, body string, auto bool, known func(int) bool, bounces int) ExitVerdict {
	var v ExitVerdict
	if kind == ExitKindAsk {
		v.Problems = AskEvidenceProblems(body)
	} else if kind == ExitKindReport {
		v.Problems = WaitUserProblems(body) // always goes back, like a missing [ask] self-check
	}
	var hp []string
	if auto {
		hp = []string{ExitRules.Headline.MissingMarker}
	} else if v.ID, v.Line, hp = ExitHeadline(body); hp == nil && !known(v.ID) {
		hp = []string{strings.ReplaceAll(ExitRules.Headline.UnknownID, "{id}", strconv.Itoa(v.ID))}
	} else if hp == nil {
		plain := withoutGive(v.Line)
		hp = append(append(summaryProblems(plain), JargonProblems(plain)...), LengthProblems(plain)...)
		if kind == ExitKindReport {
			hp = append(hp, GiveProblems(v.Line)...)
		}
	}
	// Format goes back only while bounces still wake the bot; after that the chat lead rewrites it
	// (user 10-30: not posted as written any more). A missing [ask] self-check always goes back.
	if hp != nil && v.Problems == nil && bounces >= ExitRules.Bounce.WakeLimit {
		v.Legacy = true
	} else {
		v.Problems = append(v.Problems, hp...)
	}
	return v
}

// ExitTaskCand is a task a workspace reply may be about: here when it is bound to that workspace,
// bound when it was bound (compared as written).
type ExitTaskCand struct {
	ID    int
	Here  bool
	Bound string
}

// ExitTaskPick is the task a workspace reply is about: the one its first line names when that one
// is bound to this workspace, else the one bound here last; 0 when none is here.
func ExitTaskPick(named int, items []ExitTaskCand) int {
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

// ExitBounceNote is what goes with an answer forwarded although the check found problems (no
// repair turn could follow the bounce): the user sees the answer and what it lacks.
func ExitBounceNote(problems []string) string {
	return "（系统核对：" + strings.Join(problems, ExitRules.Bounce.Sep) + "）"
}

// UserTodo is the 「要你做的」 part of a report, "" when it has none or says 没有 (same bounds as
// selfRouteHit: before 「细节」, up to the next 【…】/给你的/我加的/自验/类别/细节 line or blank line).
func UserTodo(body string) string {
	parts, _ := todoSections(body)
	return strings.TrimSpace(strings.Join(parts, "\n"))
}
