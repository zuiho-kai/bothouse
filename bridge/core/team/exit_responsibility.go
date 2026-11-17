package team

import (
	"regexp"
	"strings"
)

// ResponsibilityReportProblems: a [report] that says the result is useless, no improvement or does
// not work must answer three questions about it before going out, instead of stopping there and
// leaving the next step to the user (user 11-17 「根因是他召回的效果不好，或者说他不能更加自主」;
// Fable's method 2: 这周 31 件被骂的活里 11 件是「结果摆出来就停，等你追问」).
//
// The three questions:
//  1. 原因是什么、下一步做了哪步（「原因：」「下一步：」）
//  2. 这毛病以前修过没有、上次为什么没管住（「以前修过：」）
//  3. 验的入口是不是用户实际用的那个、依据是什么（「入口依据：」）
//
// Missing answers come back all at once. A report with no such wording passes unchanged.
func ResponsibilityReportProblems(body string) []string {
	if !responsibilityHitReady(body) {
		return nil
	}
	var missing []string
	for _, a := range responsibilityAnswer {
		if !a.re.MatchString(body) {
			missing = append(missing, a.label)
		}
	}
	if missing == nil {
		return nil
	}
	return []string{"结果是没用、没提升或不行时，交回前要答三问，还缺：" + strings.Join(missing, "；")}
}

// responsibilityHitReady: does the summary say the result fell short? Only the summary (up to the
// 「细节：」 line) is read: that is where the verdict lives, and pasted command output or a quoted
// lesson name in the details must not trigger it. A quoted mention (「没提升」) is not a verdict.
func responsibilityHitReady(body string) bool {
	summary, _, _ := strings.Cut(body, "\n细节：")
	if strings.HasPrefix(body, "细节：") {
		summary = ""
	}
	for _, m := range responsibilityHit.FindAllStringIndex(summary, -1) {
		word := summary[m[0]:m[1]]
		before, after := summary[:m[0]], summary[m[1]:]
		if strings.HasSuffix(before, "「") || strings.HasSuffix(before, "“") || strings.HasSuffix(before, "\"") {
			continue // a quoted term, not a statement about this result
		}
		switch word {
		case "没用", "没有用":
			if strings.HasPrefix(after, "的") || strings.HasPrefix(after, "户") {
				continue // 没用的模型, 没有用户拍板
			}
		case "不行":
			if strings.HasSuffix(before, "行") || strings.HasPrefix(after, "的话") || strings.HasPrefix(after, "吗") {
				continue // 行不行, 不行的话
			}
		}
		return true
	}
	return false
}

// responsibilityHit: the report says the result fell short. The three phrases are the user's own
// (「没提升」「不行」「没用」, 11-17); the longer forms are the same statement.
var responsibilityHit = regexp.MustCompile(`没用|没提升|不行`)

var responsibilityAnswer = []struct {
	label string // what the bounce message names
	re    *regexp.Regexp
}{
	{"「原因：」为什么没达到用户的目的", regexp.MustCompile(`(?m)^[\t\f\r 　>*-]*原因[:：][\t\f\r 　]*[^\t\f\r 　\n]`)},
	{"「下一步：」在范围内试着做了哪一步", regexp.MustCompile(`(?m)^[\t\f\r 　>*-]*下一步[:：][\t\f\r 　]*[^\t\f\r 　\n]`)},
	{"「以前修过：」这毛病以前修过没有、上次为什么没管住", regexp.MustCompile(`(?m)^[\t\f\r 　>*-]*以前修过[:：][\t\f\r 　]*[^\t\f\r 　\n]`)},
	{"「入口依据：」验的是不是用户实际用的那个入口、依据是什么", regexp.MustCompile(`(?m)^[\t\f\r 　>*-]*入口依据[:：][\t\f\r 　]*[^\t\f\r 　\n]`)},
}
