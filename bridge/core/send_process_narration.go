package core

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// #181 second failure: a turn that already pushed a non-text message (sticker,
// image, file) to the channel sometimes ends with a sentence that narrates the
// send step instead of talking to the reader:
//
//	不好意思，我先把这条回复发出去，再把相关表情包发出去。
//
// Measured, not guessed. Source: BotHouse qq-bridge.log lines 11072-11075
// (2026-11-08 20:06, session qq:g:1109769308, in_message_id=398397176).
// At 20:06:52.874 the turn's sticker went out
// (out_message_id=1750422960, content "[image image/jpeg 34840 bytes]"); at
// 20:06:56.780 the final reply was posted (out_message_id=281387825,
// content_len=27) with exactly that sentence, and NapCat logged the same text
// in the group at 20:06:56. The stored session (s118, history[426]) keeps it
// glued to the line the script had already sent:
//
//	手滑了 别笑不好意思，我先把这条回复发出去，再把相关表情包发出去。
//
// The existing whole-text prefix peeling in repeated_reply.go cannot catch it:
// images never enter `sent`, so there is no already-sent prefix to peel. This
// guard is clause-shaped and only fires once the caller knows a non-text message
// already went out this turn (see unsentFinalReplyTextAfterNonText).

// sendProcessActionRe is the verb a self-narrating clause must carry.
var sendProcessActionRe = regexp.MustCompile(`发出去|发出来|发出|发送|发给你|上传`)

// sendProcessSelfRe marks the agent talking about its own step.
var sendProcessSelfRe = regexp.MustCompile(`我|咱`)

// sendProcessChainRe marks a clause continuing a previous send step
// ("再把…发出去"); such a clause may omit the subject.
var sendProcessChainRe = regexp.MustCompile(`^(再|然后|接着|随后)`)

// sendProcessSequenceRe marks a step that is still ahead of the speaker. "已经"
// is deliberately absent: that reports something finished, which is an answer.
var sendProcessSequenceRe = regexp.MustCompile(`先|再|然后|接着|随后|这就|马上|接下来|稍后|待会|等会`)

// sendProcessDoneRe marks a report of a finished send, never a pending step.
var sendProcessDoneRe = regexp.MustCompile(`已经|发过了`)

// sendProcessObjectRe marks a clause that names the thing being sent, in the
// message-shaped vocabulary the measured turn used ("这条回复", "相关表情包").
// It is required together with a sequencing marker, so a generic "我先看看文件，
// 再发给你" (a promise, not a send step) never matches.
var sendProcessObjectRe = regexp.MustCompile(`这条回复|这条消息|这段回复|这段话|表情包|图片|贴纸`)

// sendProcessFillers are the softeners the measured sentence put in front of
// the step ("不好意思，…"). They are dropped only when the same reply carries a
// send step, so a plain apology answer is never lost.
var sendProcessFillers = []string{"不好意思", "抱歉", "对不起", "见谅"}

// narrationClause is one punctuation-delimited piece of a reply. sep is the run
// of separators that followed it, kept so surviving clauses rejoin as written.
type narrationClause struct {
	text string
	sep  string
}

// isSendProcessClause reports whether one clause only narrates the agent's own
// send step: a send verb, plus a first-person or continuation subject, plus a
// sequencing marker. "文件我已经发出去了" fails the sequencing test and stays.
func isSendProcessClause(clause string) bool {
	clause = strings.TrimSpace(clause)
	if clause == "" || replyContainsCode(clause) {
		return false
	}
	if !sendProcessActionRe.MatchString(clause) {
		return false
	}
	if sendProcessDoneRe.MatchString(clause) || strings.HasSuffix(clause, "了") {
		return false
	}
	if !sendProcessSelfRe.MatchString(clause) && !sendProcessChainRe.MatchString(clause) {
		return false
	}
	return sendProcessSequenceRe.MatchString(clause) && sendProcessObjectRe.MatchString(clause)
}

// isSendProcessFiller reports whether a clause is only a softener, with at most
// one trailing modal particle ("不好意思啊").
func isSendProcessFiller(clause string) bool {
	clause = strings.TrimSpace(clause)
	for _, filler := range sendProcessFillers {
		if clause == filler {
			return true
		}
		if strings.HasPrefix(clause, filler) && utf8.RuneCountInString(clause) == utf8.RuneCountInString(filler)+1 {
			if r, _ := utf8.DecodeRuneInString(clause[len(filler):]); strings.ContainsRune("啊呀哈哦嗯吧呢", r) {
				return true
			}
		}
	}
	return false
}

// sendProcessCut finds where a step sentence starts inside an otherwise kept
// clause. The model glued its narration onto the line it had already sent
// ("手滑了 别笑不好意思，…"), so the clause boundary alone is not enough: when
// the tail after a softener is a step, the softener and everything after it
// belong to that step, not to the reader's text.
func sendProcessCut(clause string) (int, bool) {
	offset := 0
	for offset < len(clause) {
		if offset > 0 && isSendProcessClause(clause[offset:]) {
			return offset, true
		}
		advanced := false
		for _, filler := range sendProcessFillers {
			if strings.HasPrefix(clause[offset:], filler) {
				offset += len(filler)
				advanced = true
				break
			}
		}
		if !advanced {
			return 0, false
		}
	}
	return 0, false
}

// splitNarrationClauses cuts a reply at clause punctuation, keeping each
// clause's trailing separators.
func splitNarrationClauses(text string) []narrationClause {
	var out []narrationClause
	start, i := 0, 0
	for i < len(text) {
		r, size := utf8.DecodeRuneInString(text[i:])
		if !isNarrationSeparator(r) {
			i += size
			continue
		}
		sepStart := i
		for i < len(text) {
			r, size = utf8.DecodeRuneInString(text[i:])
			if !isNarrationSeparator(r) {
				break
			}
			i += size
		}
		out = append(out, narrationClause{text: text[start:sepStart], sep: text[sepStart:i]})
		start = i
	}
	if start < len(text) {
		out = append(out, narrationClause{text: text[start:]})
	}
	return out
}

// isNarrationSeparator reports whether r ends a clause. A colon or dash may
// introduce quoted content, so they stay inside the clause.
func isNarrationSeparator(r rune) bool {
	switch r {
	case '，', ',', '。', '.', '；', ';', '！', '!', '？', '?', '、', '…', '\n', '\r':
		return true
	}
	return false
}

// stripSendProcessNarration removes clauses that only narrate the agent's own
// send step, plus the softeners glued to them, and returns what is left for the
// reader. ok is false when the reply carries no send step at all, in which case
// the caller keeps the text exactly as written.
func stripSendProcessNarration(text string) (string, bool) {
	clauses := splitNarrationClauses(text)
	hasStep := false
	for _, c := range clauses {
		if isSendProcessClause(c.text) {
			hasStep = true
			break
		}
	}
	if !hasStep {
		return text, false
	}
	kept := make([]narrationClause, 0, len(clauses))
	for _, c := range clauses {
		if isSendProcessClause(c.text) || isSendProcessFiller(c.text) {
			continue
		}
		if cut, ok := sendProcessCut(c.text); ok {
			c.text = c.text[:cut]
			if strings.TrimSpace(c.text) == "" {
				continue
			}
		}
		if strings.TrimSpace(c.text) == "" {
			continue
		}
		kept = append(kept, c)
	}
	// The softener that introduced the dropped step was glued to the end of the
	// line before it; with the step gone it has nothing left to soften.
	if len(kept) > 0 {
		last := &kept[len(kept)-1]
		for _, filler := range sendProcessFillers {
			if strings.HasSuffix(last.text, filler) {
				last.text = strings.TrimRight(last.text[:len(last.text)-len(filler)], " \t")
				break
			}
		}
		if strings.TrimSpace(last.text) == "" && len(kept) > 1 {
			kept = kept[:len(kept)-1]
		}
	}
	if len(kept) == 0 {
		return "", true
	}
	var b strings.Builder
	for i, c := range kept {
		b.WriteString(c.text)
		if i < len(kept)-1 {
			b.WriteString(c.sep)
		}
	}
	return strings.TrimSpace(b.String()), true
}
