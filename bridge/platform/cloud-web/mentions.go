package cloudweb

// @-mention parsing for a channel host that sends its member list with each message (the DSH collab
// gateway). Moved here from dsh/collab/mentions.mjs (#1662): the plugin forwards the raw text and the
// room's members, and the bridge decides who a message calls and how each bot reads it — the rule
// lives once, in the bridge. The rule is the one the channel page colours with
// (dsh/packages/client-ui-discord/src/client/mention-highlight.tsx buildMentionMatcher): an @ inside
// an email or followed by a longer ascii word is not a call, ``` fences, inline code spans and hidden
// footnote definitions call nobody.
//
// Offsets are byte offsets into the UTF-8 text; every range is cut at ASCII characters, so a range
// never splits a multi-byte character.

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// hubMember is one channel member as the gateway sends it ("members" on a message frame).
// MentionID is the numeric <@id> form, when the member has one.
type hubMember struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MentionID string `json:"mention_id,omitempty"`
}

const mdFence = "```"

func isWordByte(b byte) bool {
	return b == '_' || (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

type mentionAlias struct{ alias, id string }

// mentionAliases: (alias, member id) pairs, longest first so "鲸鱼娘" wins over "鲸鱼".
func mentionAliases(members []hubMember) []mentionAlias {
	var out []mentionAlias
	for _, m := range members {
		out = append(out, mentionAlias{"@" + m.Name, m.ID}, mentionAlias{"@" + m.ID, m.ID})
		if m.ID != "" {
			out = append(out, mentionAlias{"<@" + m.ID + ">", m.ID}, mentionAlias{"<@!" + m.ID + ">", m.ID})
		}
		if m.MentionID != "" {
			out = append(out, mentionAlias{"<@" + m.MentionID + ">", m.ID}, mentionAlias{"<@!" + m.MentionID + ">", m.ID})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return utf16Len(out[i].alias) > utf16Len(out[j].alias) })
	return out
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

type span struct{ start, end int }

// fenceRanges: [start, end) of every ``` fence body; an unterminated fence runs to the end.
func fenceRanges(text string) []span {
	var ranges []span
	open := -1
	at := strings.Index(text, mdFence)
	for at >= 0 {
		if open < 0 {
			open = at + len(mdFence)
		} else {
			ranges = append(ranges, span{open, at})
			open = -1
		}
		next := strings.Index(text[at+len(mdFence):], mdFence)
		if next < 0 {
			break
		}
		at = at + len(mdFence) + next
	}
	if open >= 0 {
		ranges = append(ranges, span{open, len(text)})
	}
	return ranges
}

var blankLineRe = regexp.MustCompile(`\n[ \t]*\n`)
var crlfRe = regexp.MustCompile(`\r\n?`)

// hasBlankLine: two line endings with only spaces or tabs between (#245); CRLF is one ending (#246).
func hasBlankLine(text string) bool {
	return blankLineRe.MatchString(crlfRe.ReplaceAllString(text, "\n"))
}

const htmlBlockTags = `address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|` +
	`dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|` +
	`header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|` +
	`param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul`

var (
	htmlBlockTagRe = regexp.MustCompile(`(?i)^ {0,3}</?(?:` + htmlBlockTags + `)(?:[ \t]|/?>|$)`)
	htmlAnyTagRe   = regexp.MustCompile(`^ {0,3}</?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?[ \t]*/?>[ \t]*$`)
	// listMarkerRe is followed by a blank or the end of the line (checked in listMarker).
	listMarkerRe = regexp.MustCompile(`^ {0,3}(?:[-*+]|\d{1,9}[.)])`)
	fenceLineRe  = regexp.MustCompile("^ {0,3}(?:`{3,}|~{3,})")
	leadBlankRe  = regexp.MustCompile(`^[ \t]*`)

	atxHeadingRe   = regexp.MustCompile(`^ {0,3}#{1,6}(?:[ \t]|$)`)
	setextRe       = regexp.MustCompile(`^ {0,3}(?:=+|-+)[ \t]*$`)
	thematicRe     = regexp.MustCompile(`^ {0,3}(?:[*\-_][ \t]*){3,}$`)
	backtickFence  = regexp.MustCompile("^ {0,3}`{3,}[^`]*$")
	quoteMarkRe    = regexp.MustCompile(`^ {0,3}>`)
	bulletItemRe   = regexp.MustCompile(`^ {0,3}[-*+][ \t]+\S`)
	orderedItemRe  = regexp.MustCompile(`^ {0,3}1[.)][ \t]+\S`)
	html1to5Re     = regexp.MustCompile(`(?i)^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)`)
	htmlCommentRe  = regexp.MustCompile(`^ {0,3}<!--`)
	htmlPIRe       = regexp.MustCompile(`^ {0,3}<\?`)
	htmlDeclRe     = regexp.MustCompile(`^ {0,3}<![A-Za-z]`)
	htmlCDATARe    = regexp.MustCompile(`^ {0,3}<!\[CDATA\[`)
	containerItem  = regexp.MustCompile(`^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)`)
	footnoteDefRe  = regexp.MustCompile(`^ {0,3}\[\^([^\]\s]+)\]:`)
	footnoteRefRe  = regexp.MustCompile(`\[\^([^\]\s]+)\]`)
	htmlCommentAll = regexp.MustCompile(`(?s)<!--.*?-->`)
	htmlOpenRe     = regexp.MustCompile(`(?i)^ {0,3}(?:<(?:script|pre|style|textarea)(?:[ \t>]|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[|` +
		`</?(?:` + htmlBlockTags + `)(?:[ \t>]|/?>|$))`)

	defThematicRe = regexp.MustCompile(`^(?:[*\-_][ \t]*){3,}$`)
	defListRe     = regexp.MustCompile(`^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)`)
	defSetextRe   = regexp.MustCompile(`^(?:=+|-+)[ \t]*$`)
	defATXRe      = regexp.MustCompile(`^#{1,6}(?:[ \t]|$)`)
	tildeOpenRe   = regexp.MustCompile(`^ {0,3}~{3,}`)
	mathOpenRe    = regexp.MustCompile(`^ {0,3}\$\$`)
)

// listMarker: the list item marker at the start of s (JS /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/).
func listMarker(s string) (string, bool) {
	m := listMarkerRe.FindString(s)
	if m == "" {
		return "", false
	}
	if len(m) < len(s) && s[len(m)] != ' ' && s[len(m)] != '\t' {
		return "", false
	}
	return m, true
}

// indentWidth: columns the leading indent of text covers, starting from column base.
func indentWidth(text string, base int) int {
	col := base
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case ' ':
			col++
		case '\t':
			col += 4 - (col % 4)
		default:
			return col - base
		}
	}
	return col - base
}

// quotePrefixAt: the blockquote prefix at line[i] read from column col; ok=false when none.
func quotePrefixAt(line string, i, col int) (next, at int, ok bool) {
	at = col
	spaces := 0
	for spaces < 4 && i < len(line) && line[i] == ' ' {
		i++
		at++
		spaces++
	}
	if spaces > 3 || i >= len(line) || line[i] != '>' {
		return 0, 0, false
	}
	i++
	at++
	if i < len(line) && (line[i] == ' ' || line[i] == '\t') {
		if line[i] == '\t' {
			at += 4 - (at % 4)
		} else {
			at++
		}
		i++
	}
	return i, at, true
}

// stripQuotes strips every blockquote marker of a line.
func stripQuotes(line string) (rest string, depth, col int) {
	i := 0
	for {
		next, at, ok := quotePrefixAt(line, i, col)
		if !ok {
			return line[i:], depth, col
		}
		i, col = next, at
		depth++
	}
}

// itemContentIndent: column where a list item's content begins; -1 when the line is not one.
func itemContentIndent(line string) int {
	rest, _, col := stripQuotes(line)
	lead := indentWidth(rest, col)
	if lead >= 4 {
		return -1
	}
	body := rest[len(leadBlankRe.FindString(rest)):]
	marker, ok := listMarker(body)
	if !ok {
		return -1
	}
	if strings.TrimSpace(body[len(marker):]) == "" {
		return -1
	}
	gap := leadBlankRe.FindString(body[len(marker):])
	padding := 1
	if gap != "" {
		padding = min(indentWidth(gap, col+lead+len(marker)), 4)
	}
	return lead + len(marker) + padding
}

// startsBlock: a line whose content starts with content opens a block that ends the paragraph (#259).
func startsBlock(content string, setext, container bool) bool {
	if indentWidth(content, 0) >= 4 {
		return false
	}
	if container && containerItem.MatchString(content) {
		return true
	}
	if container && htmlAnyTagRe.MatchString(content) {
		return true
	}
	return atxHeadingRe.MatchString(content) ||
		(setext && setextRe.MatchString(content)) ||
		thematicRe.MatchString(content) ||
		backtickFence.MatchString(content) ||
		quoteMarkRe.MatchString(content) ||
		bulletItemRe.MatchString(content) ||
		orderedItemRe.MatchString(content) ||
		html1to5Re.MatchString(content) ||
		htmlCommentRe.MatchString(content) ||
		htmlPIRe.MatchString(content) ||
		htmlDeclRe.MatchString(content) ||
		htmlCDATARe.MatchString(content) ||
		htmlBlockTagRe.MatchString(content)
}

// splitLines: [start, end) of every physical line; CRLF, CR and LF all end one.
func splitLines(text string) []span {
	var lines []span
	for start := 0; start <= len(text); {
		end := start
		for end < len(text) && text[end] != '\n' && text[end] != '\r' {
			end++
		}
		lines = append(lines, span{start, end})
		if end >= len(text) {
			break
		}
		if text[end] == '\r' && end+1 < len(text) && text[end+1] == '\n' {
			start = end + 2
		} else {
			start = end + 1
		}
	}
	return lines
}

// lineAt: the last line that starts at or before offset.
func lineAt(lines []span, offset int) int {
	lo, hi := 0, len(lines)-1
	for lo < hi {
		mid := (lo + hi + 1) >> 1
		if lines[mid].start <= offset {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo
}

type lineFact struct {
	blank, fence bool
	itemIndent   int
	rest         string
	depth, col   int
	atDepth      bool
}

type lineIdx struct {
	lines     []span
	facts     []lineFact
	contained []struct{ baseIndent, depth int }
}

func buildLineIndex(text string) *lineIdx {
	lines := splitLines(text)
	idx := &lineIdx{lines: lines, facts: make([]lineFact, len(lines)), contained: make([]struct{ baseIndent, depth int }, len(lines))}
	for i, l := range lines {
		line := text[l.start:l.end]
		rest, depth, col := stripQuotes(line)
		idx.facts[i] = lineFact{
			blank: strings.TrimSpace(line) == "", fence: fenceLineRe.MatchString(line), itemIndent: itemContentIndent(line),
			rest: rest, depth: depth, col: col, atDepth: startsBlock(rest, false, true),
		}
	}
	for i := range lines {
		f := idx.facts[i]
		if f.blank || f.fence {
			continue
		}
		run := i > 0 && !idx.facts[i-1].blank && !idx.facts[i-1].fence
		base, depth := 0, f.depth
		if f.itemIndent >= 0 {
			base = f.itemIndent
		} else if run {
			base = idx.contained[i-1].baseIndent
		}
		if run && idx.contained[i-1].depth > depth {
			depth = idx.contained[i-1].depth
		}
		idx.contained[i].baseIndent, idx.contained[i].depth = base, depth
	}
	return idx
}

// endsParagraph: the text between an opening and a closing backtick run ends the paragraph (#259).
func endsParagraph(text string, from, to int, idx *lineIdx) bool {
	if hasBlankLine(text[from:to]) {
		return true
	}
	openLine := lineAt(idx.lines, from)
	baseIndent, openDepth := idx.contained[openLine].baseIndent, idx.contained[openLine].depth
	for i := openLine + 1; i < len(idx.lines) && idx.lines[i].start < to; i++ {
		f := idx.facts[i]
		if strings.TrimSpace(f.rest) == "" {
			return true
		}
		if f.depth > openDepth {
			return true
		}
		if f.depth < openDepth {
			if f.atDepth {
				return true
			}
			continue
		}
		indent := indentWidth(f.rest, f.col) - baseIndent
		if startsBlock(strings.Repeat(" ", max(0, indent))+strings.TrimLeftFunc(f.rest, unicode.IsSpace), indent >= 0, indent < 0) {
			return true
		}
	}
	return false
}

// codeSpanRanges: [start, end) of every inline code span, closed by a run of the same length inside
// the same paragraph (#237, #245, #259); runs of three or more are fences.
func codeSpanRanges(text string) []span {
	type run struct{ start, n int }
	var runs []run
	for i := 0; i < len(text); {
		if text[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(text) && text[j] == '`' {
			j++
		}
		runs = append(runs, run{i, j - i})
		i = j
	}
	var ranges []span
	var idx *lineIdx
	for k := 0; k < len(runs); k++ {
		start, n := runs[k].start, runs[k].n
		if n >= 3 {
			continue
		}
		for c := k + 1; c < len(runs); c++ {
			if runs[c].n != n {
				continue
			}
			if idx == nil {
				idx = buildLineIndex(text)
			}
			if endsParagraph(text, start+n, runs[c].start, idx) {
				break
			}
			ranges = append(ranges, span{start + n, runs[c].start})
			k = c
			break
		}
	}
	return ranges
}

func excluded(ranges []span, index, n int) bool {
	for _, r := range ranges {
		if index < r.end && index+n > r.start {
			return true
		}
	}
	return false
}

// endsDefinitionBody: a line at 0-3 columns that opens a block ends a footnote body (#271).
func endsDefinitionBody(rest string) bool {
	if indentWidth(rest, 0) >= 4 {
		return false
	}
	c := rest[len(leadBlankRe.FindString(rest)):]
	if defThematicRe.MatchString(c) || defListRe.MatchString(c) {
		return true
	}
	if defSetextRe.MatchString(c) {
		return false
	}
	return defATXRe.MatchString(c) || strings.HasPrefix(c, "$$") || backtickFence.MatchString(c) || strings.HasPrefix(c, ">") ||
		html1to5Re.MatchString(c) || htmlCommentRe.MatchString(c) || htmlPIRe.MatchString(c) || htmlDeclRe.MatchString(c) ||
		htmlCDATARe.MatchString(c) || htmlBlockTagRe.MatchString(c) || htmlAnyTagRe.MatchString(c)
}

// footnoteOpaqueRanges: backtick fences, ~~~ fences and $$ math blocks.
func footnoteOpaqueRanges(text string) []span {
	ranges := fenceRanges(text)
	for _, open := range []*regexp.Regexp{tildeOpenRe, mathOpenRe} {
		start, at := -1, 0
		for _, line := range strings.Split(text, "\n") {
			if open.MatchString(line) {
				if start < 0 {
					start = at
				} else {
					ranges = append(ranges, span{start, at + len(line)})
					start = -1
				}
			}
			at += len(line) + 1
		}
		if start >= 0 {
			ranges = append(ranges, span{start, len(text)})
		}
	}
	return ranges
}

// htmlBlockRegions: from an HTML block's opening line to the line before the next blank one.
func htmlBlockRegions(text string, lines []span) []span {
	var regions []span
	for i := 0; i < len(lines); i++ {
		if !htmlOpenRe.MatchString(text[lines[i].start:lines[i].end]) {
			continue
		}
		end := i
		for end+1 < len(lines) && strings.TrimSpace(text[lines[end+1].start:lines[end+1].end]) != "" {
			end++
		}
		regions = append(regions, span{lines[i].start, lines[end].end})
		i = end
	}
	return regions
}

type footnoteDef struct {
	line        int
	label       string
	depth, base int
	marker      int
}

func footnoteDefs(text string, lines []span) []footnoteDef {
	var defs []footnoteDef
	opaque := append(footnoteOpaqueRanges(text), htmlBlockRegions(text, lines)...)
	inside := func(off int) bool {
		for _, r := range opaque {
			if off >= r.start && off < r.end {
				return true
			}
		}
		return false
	}
	for i, l := range lines {
		if inside(l.start) {
			continue
		}
		rest, depth, col := stripQuotes(text[l.start:l.end])
		if m := footnoteDefRe.FindStringSubmatch(rest); m != nil {
			defs = append(defs, footnoteDef{line: i, label: m[1], depth: depth, marker: l.end - len(rest) + len(m[0])})
			continue
		}
		marker, ok := listMarker(rest)
		if !ok {
			continue
		}
		after := rest[len(marker):]
		gap := leadBlankRe.FindString(after)
		if gap == "" {
			continue
		}
		indent := indentWidth(gap, col+len(marker))
		content := after[len(gap):]
		pad := 0
		if utf16Len(content) < 4 {
			pad = min(indent, 3)
		}
		if m := footnoteDefRe.FindStringSubmatch(strings.Repeat(" ", pad) + content); m != nil && indent < 4 {
			defs = append(defs, footnoteDef{line: i, label: m[1], depth: depth, base: indent, marker: l.end - len(content) + len(m[0]) - pad})
		}
	}
	return defs
}

func definitionBodyEnd(text string, lines []span, def footnoteDef, next int) int {
	last := def.line
	open := strings.TrimSpace(text[def.marker:lines[def.line].end]) != ""
	for j := def.line + 1; j < len(lines); j++ {
		if j == next {
			break
		}
		rest, depth, col := stripQuotes(text[lines[j].start:lines[j].end])
		if strings.TrimSpace(rest) == "" {
			k := j
			for k < len(lines) {
				if r, _, _ := stripQuotes(text[lines[k].start:lines[k].end]); strings.TrimSpace(r) != "" {
					break
				}
				k++
			}
			if k < len(lines) {
				r, rd, rc := stripQuotes(text[lines[k].start:lines[k].end])
				if rd >= def.depth && indentWidth(r, rc)-def.base >= 4 {
					j = k - 1
					last = k - 1
					open = true
					continue
				}
			}
			break
		}
		if depth > def.depth {
			break
		}
		if depth < def.depth {
			if !open || endsDefinitionBody(rest) {
				break
			}
			last = j
			continue
		}
		if indentWidth(rest, col)-def.base >= 4 {
			last = j
			open = true
			continue
		}
		if endsDefinitionBody(rest) {
			break
		}
		if !open {
			break
		}
		last = j
	}
	return last
}

func mergeRanges(ranges []span) []span {
	sorted := append([]span(nil), ranges...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].start != sorted[j].start {
			return sorted[i].start < sorted[j].start
		}
		return sorted[i].end < sorted[j].end
	})
	var out []span
	for _, r := range sorted {
		if n := len(out); n > 0 && r.start <= out[n-1].end {
			out[n-1].end = max(out[n-1].end, r.end)
		} else {
			out = append(out, r)
		}
	}
	return out
}

func maskText(text string, ranges []span) string {
	b := []byte(text)
	for _, r := range mergeRanges(ranges) {
		for i := r.start; i < r.end && i < len(b); i++ {
			if b[i] != '\n' && b[i] != '\r' {
				b[i] = ' '
			}
		}
	}
	return string(b)
}

// footnoteRanges: every hidden footnote definition — one whose label nothing readable refers to (#271).
func footnoteRanges(text string, codeSpans []span) []span {
	if !strings.Contains(text, "[^") {
		return nil
	}
	lines := splitLines(text)
	defs := footnoteDefs(text, lines)
	if len(defs) == 0 {
		return nil
	}
	ends := make([]int, len(defs))
	bodies := make([]span, len(defs))
	for k, def := range defs {
		next := -1
		if k+1 < len(defs) {
			next = defs[k+1].line
		}
		ends[k] = definitionBodyEnd(text, lines, def, next)
		bodies[k] = span{lines[def.line].start, lines[ends[k]].end}
	}
	blind := append([]span(nil), codeSpans...)
	blind = append(blind, footnoteOpaqueRanges(text)...)
	blind = append(blind, htmlBlockRegions(text, lines)...)
	for _, def := range defs {
		blind = append(blind, span{lines[def.line].start, def.marker})
	}
	for _, m := range htmlCommentAll.FindAllStringIndex(text, -1) {
		blind = append(blind, span{m[0], m[1]})
	}
	searchable := maskText(text, blind)
	first := map[string]int{}
	for i, def := range defs {
		key := strings.ToLower(def.label)
		if _, ok := first[key]; !ok {
			first[key] = i
		}
	}
	calledOutside := map[string]bool{}
	insideBody := make([]map[string]bool, len(defs))
	for i := range insideBody {
		insideBody[i] = map[string]bool{}
	}
	body := 0
	for _, m := range footnoteRefRe.FindAllStringSubmatchIndex(searchable, -1) {
		slashes := 0
		for i := m[0] - 1; i >= 0 && searchable[i] == '\\'; i-- {
			slashes++
		}
		if slashes%2 != 0 {
			continue
		}
		for body < len(bodies) && bodies[body].end <= m[0] {
			body++
		}
		label := strings.ToLower(searchable[m[2]:m[3]])
		if body < len(bodies) && m[0] >= bodies[body].start {
			insideBody[body][label] = true
		} else {
			calledOutside[label] = true
		}
	}
	shown := map[int]bool{}
	var pending []int
	openLabels := func(labels map[string]bool) {
		for label := range labels {
			i, ok := first[label]
			if !ok || shown[i] {
				continue
			}
			shown[i] = true
			pending = append(pending, i)
		}
	}
	openLabels(calledOutside)
	for len(pending) > 0 {
		i := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		openLabels(insideBody[i])
	}
	var hidden []span
	for i, def := range defs {
		if !shown[i] {
			hidden = append(hidden, span{lines[def.line].start, lines[ends[i]].end})
		}
	}
	return mergeRanges(hidden)
}

// mentionPart is one segment of a split text; ID is the member it calls, "" for plain text.
type mentionPart struct{ text, id string }

// splitMentions splits text into plain segments and calls; the parts always join back to the input.
// Mentions inside ``` fences, inline code spans and hidden footnote definitions do not count.
func splitMentions(text string, members []hubMember) []mentionPart {
	list := mentionAliases(members)
	if len(list) == 0 {
		return []mentionPart{{text, ""}}
	}
	codeSpans := codeSpanRanges(text)
	skip := append(fenceRanges(text), codeSpans...)
	skip = append(skip, footnoteRanges(text, codeSpans)...)
	var parts []mentionPart
	pos := 0
	for i := 0; i < len(text); {
		alias, id := matchAliasAt(text, i, list)
		if alias == "" {
			_, size := utf8.DecodeRuneInString(text[i:])
			i += size
			continue
		}
		if !excluded(skip, i, len(alias)) {
			parts = append(parts, mentionPart{text[pos:i], ""}, mentionPart{alias, id})
			pos = i + len(alias)
		}
		i += len(alias)
	}
	return append(parts, mentionPart{text[pos:], ""})
}

// matchAliasAt: the first alias (longest first) that calls at text[i:]: no word character before it,
// and none right after it when the alias itself ends in one (#237).
func matchAliasAt(text string, i int, list []mentionAlias) (string, string) {
	if i > 0 && isWordByte(text[i-1]) {
		return "", ""
	}
	for _, a := range list {
		if !strings.HasPrefix(text[i:], a.alias) {
			continue
		}
		end := i + len(a.alias)
		if isWordByte(a.alias[len(a.alias)-1]) && end < len(text) && isWordByte(text[end]) {
			continue
		}
		return a.alias, a.id
	}
	return "", ""
}

// mentionedIDs: member ids @-mentioned in text.
func mentionedIDs(text string, members []hubMember) map[string]bool {
	out := map[string]bool{}
	for _, p := range splitMentions(text, members) {
		if p.id != "" {
			out[p.id] = true
		}
	}
	return out
}

// mentionsForDisplay: the stored/displayed form, every mention as @name.
func mentionsForDisplay(text string, members []hubMember) string {
	byID := map[string]hubMember{}
	for _, m := range members {
		byID[m.ID] = m
	}
	var b strings.Builder
	for _, p := range splitMentions(text, members) {
		if p.id != "" {
			b.WriteString("@" + byID[p.id].Name)
		} else {
			b.WriteString(p.text)
		}
	}
	return b.String()
}

// mentionsForMember: text as one member reads it — its own mention removed (or "@name(你)" when others
// are also mentioned), other members as <@mentionId> when they have one, else @name.
func mentionsForMember(text string, to hubMember, members []hubMember) string {
	byID := map[string]hubMember{}
	for _, m := range members {
		byID[m.ID] = m
	}
	parts := splitMentions(text, members)
	others := false
	for _, p := range parts {
		if p.id != "" && p.id != to.ID {
			others = true
		}
	}
	var out strings.Builder
	eat := false
	for _, p := range parts {
		switch {
		case p.id == "":
			s := p.text
			if eat && s != "" && (s[0] == ' ' || s[0] == '\t') {
				s = s[1:]
			}
			out.WriteString(s)
			eat = false
		case p.id == to.ID:
			if others {
				out.WriteString("@" + to.Name + "(你)")
			}
			soFar := out.String()
			r, _ := utf8.DecodeLastRuneInString(soFar)
			eat = !others && (strings.TrimSpace(soFar) == "" || unicode.IsSpace(r))
		default:
			o := byID[p.id]
			if o.MentionID != "" {
				out.WriteString("<@" + o.MentionID + ">")
			} else {
				out.WriteString("@" + o.Name)
			}
		}
	}
	return strings.TrimSpace(out.String())
}
