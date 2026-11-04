package core

import (
	"fmt"
	"strings"
)

// Pre-send check of a workspace [ask]/[report] (`bothouse report check`, reflection 11-04: reports
// went back from six sessions for a missing first-line [report] or unmentioned scope items). It runs
// the same checks forwardWorkspaceExitContext runs on the reply, minus the board lookup (the id is
// taken as known) and the bounce count (a draft is never let through as legacy), plus one rule of
// its own: a skeleton blank (ReportSkeleton) still in the draft.

// ReportBlank marks a part of ReportSkeleton still to fill in.
const ReportBlank = "（待填"

// ReportPreflight lists why the bridge would send the draft back to the workspace; nil: it would go
// to the chat channel. notes is the handoff text ("" when there is none: art and scope not checked).
func ReportPreflight(draft, notes string) []string {
	draft = stripFillerLines(draft)
	kind, body, ok := parseExitKind(draft)
	if !ok {
		return []string{exitRules.Headline.MissingMarker}
	}
	problems := judgeExit(kind, body, false, func(int) bool { return true }, 0).Problems
	if kind == exitKindReport {
		problems = append(problems, artReportProblems(notes, body, localFileExists)...)
		problems = append(problems, scopeReportProblems(notes, body)...)
		problems = append(problems, genericReportProblems(body)...)
	}
	var blanks []string
	for _, ln := range strings.Split(draft, "\n") {
		if strings.Contains(ln, ReportBlank) {
			l := []rune(strings.TrimSpace(ln))
			if len(l) > 24 {
				l = append(l[:24], '…')
			}
			blanks = append(blanks, string(l))
		}
	}
	if blanks != nil {
		problems = append(problems, "骨架还有没填的："+strings.Join(blanks, " / "))
	}
	return problems
}

// ReportSkeleton is the [report] to fill in for board item id: the four parts posted to the chat
// channel, then one line per 「改」 item of the handoff's scope (notes), each with a blank for its
// result or why it was not done.
func ReportSkeleton(id int, notes string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[report] #%d 背景：%s：这件事是什么、用户当时怎么说的、当初有哪几项）\n", id, ReportBlank)
	fmt.Fprintf(&b, "%s：做了哪几项、各改成什么、上线没有）\n", ReportBlank)
	fmt.Fprintf(&b, "要你做的：%s：要用户拍板或只有用户能做的事；没有就写「没有」）\n", ReportBlank)
	fmt.Fprintf(&b, "我加的：%s：用户原话里没有、自己加的设定；没有就写「无」）\n", ReportBlank)
	b.WriteString("细节：\n")
	if items := scopeChangeItems(notes); len(items) > 0 {
		b.WriteString("交接范围逐项：\n")
		for _, it := range items {
			fmt.Fprintf(&b, "- 改：%s —— %s：结果和证据，没做写原因）\n", it.Text, ReportBlank)
		}
	}
	return b.String()
}
