package core

// A held [report] the intent check doubted is released only on the user's own words (board #1350, user
// 2026-11-10 「复盘一下，首先为什么没拦截的东西，我操，还得我去翻出来看啊，这个方法论有问题还是怎么样？」 about #1344:
// the doubt was flagged, the lead answered it with its own reasoning and passed it — the third time). The lead's
// reasoning does not clear a doubt: ws-pass --verdict must quote 「…」 something a human actually said, checked
// against the per-person record (people_said.go). Otherwise the two ways out are ws-forward, or asking the user.

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

const doubtPassRule = "这份有疑点：放行时 --verdict 里要用「」引一句消掉疑点的用户原话，系统到用户发言记录里核对；你自己的推理不算。给不出原话只有两条路：ws-forward 打回，或把疑点原样问用户。"

var verdictQuoteRe = regexp.MustCompile(`「([^」]+)」|“([^”]+)”`)

// quoteMinRunes: shorter quotes (「好」「可以」) match nearly anything the user ever typed.
const quoteMinRunes = 4

func doubtPassRefusal(doubt string) string {
	return "这份汇报对题检查有疑点（" + truncateStr(doubt, 300) + "），verdict 里没有能在用户发言记录里核到的原话，不放行。" +
		"两条路：ws-forward 打回；或把疑点原样问用户，用户答了再用 --verdict 引他那句原话放行。主角色自己的推理不算消掉疑点。"
}

func squeeze(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// verdictQuotes are the 「…」/“…” spans of verdict long enough to count.
func verdictQuotes(verdict string) []string {
	var out []string
	for _, m := range verdictQuoteRe.FindAllStringSubmatch(verdict, -1) {
		q := squeeze(m[1] + m[2])
		if len([]rune(q)) >= quoteMinRunes {
			out = append(out, q)
		}
	}
	return out
}

// verdictQuotesUser: some quote of verdict is part of a message a human sent (people/*.jsonl holds humans only).
func verdictQuotesUser(verdict string) bool {
	qs := verdictQuotes(verdict)
	dir := peopleDir()
	if len(qs) == 0 || dir == "" {
		return false
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	for _, f := range files {
		if fileHasQuote(f, qs) {
			return true
		}
	}
	return false
}

func fileHasQuote(path string, qs []string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 4<<20)
	for sc.Scan() {
		var rec struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(sc.Bytes(), &rec) != nil || rec.Text == "" {
			continue
		}
		text := squeeze(rec.Text)
		for _, q := range qs {
			if strings.Contains(text, q) {
				return true
			}
		}
	}
	return false
}
