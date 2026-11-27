package core

import (
	"fmt"
	"regexp"
	"strings"
)

// A verdict that says the acceptance did not cover the work, the user's goal was not met, or the
// decision is left to someone else cannot close the task (user 11-26 「为什么没事件触发，你这个
// 不连贯，没有验收」). Before this, #2026 passed with 「只核了数字表，未读 summary 全文」 and #2030
// passed with 「结论没过关、最近差 1 个点…放行」; both closed as done, and the decision they left
// open went nowhere.
//
// The gate refuses the pass at the tool boundary, so the lead's own turn gets the error and must
// finish the check, send the question (bothouse send --ask-user) or send the work back. The task is
// not closed and the report stays held, so nothing ends silently.
//
// 来源：#2032 交接里橘的记录（任务板事件 #2026 10:28:06 交回、10:28:20 收口；#2030 11:11 交回、
// 11:12 收口；两条 verdict 分别自认没读完和没过关）。
var (
	// deferred: the verdict hands the decision to someone else instead of deciding or asking.
	verdictDeferRe = regexp.MustCompile(`等\s*(?:用户|主角色|派活人|你|他|她|谁)(?:\s*和\s*用户)?\s*(?:来)?\s*(?:定|拍板|决定|答复|定夺)|待定|让用户定|交给用户定|看用户(?:怎么)?定`)
	// unmet: the verdict itself says the user's goal was not reached.
	verdictUnmetRe = regexp.MustCompile(`没过关|未过关|没达标|未达标|没达到|未达到|不合格|未通过|没做到|未做到|还差|差\s*[0-9一二两几]+\s*(?:个)?(?:点|百分点)|不如现在|没比现在|没压过`)
	// incomplete: the verdict admits the check did not cover the work.
	verdictIncompleteRe = regexp.MustCompile(`未(?:读|看|核|查|验|对)(?:完|过|全文)?|没(?:读|看|核|查|验|对)(?:完|过|全文)?|只(?:核|看|查|对|验)了`)
	// absolved: the sentence says there was nothing left unread/unmet, not that it was skipped.
	verdictAbsolveRe = regexp.MustCompile(`(?:没有|无|不存在|不用|不必|不需要|不是)[^，。；\n]{0,6}(?:未读|没看|未核|没核|未验|没验|没过关|没做到|等用户|待定)|(?:未|没)(?:读|看|核|查|验)(?:的)?(?:部分|地方|东西)?[：:]\s*(?:无|没有|0)`)
)

// verdictGateProblem: why this pass verdict cannot close the task, "" when it can. A progress
// report (Waiting) and a batch delivery are not final: their verifier may legitimately report a
// partial check or a question, so the gate only applies to a final report.
func verdictGateProblem(rec *pendingReport, verdict string) string {
	if rec == nil || rec.Waiting || rec.Batch {
		return ""
	}
	board := rec.Board
	for _, sentence := range verdictSentences(verdict) {
		sentence = strings.TrimSpace(sentence)
		if sentence == "" {
			continue
		}
		sentence = verdictAbsolveRe.ReplaceAllString(sentence, "")
		if m := verdictDeferRe.FindString(sentence); m != "" {
			return fmt.Sprintf("验收结论把决定留给了别人（「%s」），这件活不能这样收口，任务没有关。"+
				"二选一：你能定的，直接把结论写进 --verdict 再放行；要用户定的，先在本频道用 "+
				"bothouse send --ask-user -m \"<大白话问题>\" 把问题发出去（任务留在板上等答复），再决定放行或打回；"+
				"没做到就 ws-forward --id %d 打回。", m, board)
		}
		if m := verdictUnmetRe.FindString(sentence); m != "" {
			return fmt.Sprintf("验收结论说用户原话要的目标没达到（「%s」），不能按做完收，任务没有关。"+
				"没做到就 ws-forward --id %d \"打回：哪条没做到、要补什么\"，或者接着派下一轮；做到了再放行。", m, board)
		}
		if m := verdictIncompleteRe.FindString(sentence); m != "" {
			return fmt.Sprintf("验收结论自己说没看完/没核（「%s」），这不算验收，任务没有关。"+
				"把交接里用户原话要的结果逐条核完，再写 --verdict 放行；核不了就 ws-forward --id %d 打回让工作区补证据。", m, board)
		}
	}
	return ""
}

// verdictSentences splits a verdict at sentence ends so an absolved clause (「没看的部分：无」)
// does not hide a real admission in the next clause.
func verdictSentences(verdict string) []string {
	return strings.FieldsFunc(verdict, func(r rune) bool {
		return r == '\n' || r == '。' || r == '；' || r == ';'
	})
}
