package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// Who said each line of a post's 原话 (user 11-16 16:0x「原话来源 要加上角色 就是谁说的原话」, 16:09「写到帖子硬规则」):
// every quote line shows 「名字：原话」. The name comes from the handoff line itself
// (「- [11-16 16:0x] zzzx0757：「…」」) or, when the line only says 用户 or nothing,
// from the source channel's history (the message that holds the quote, its author).
// A name found in <team dir>/speaker_names.json is shown as the name people use (zuiho_kai → 瑞凤).
// A line whose speaker cannot be found stays as written.

// speakerNamesFile: Discord name → the name the group calls that person.
const speakerNamesFile = "speaker_names.json"

var (
	// 「[11-16 16:0x] zzzx0757：…」: optional time, then a name before the first colon, before any quote mark.
	forumQuoteHead = regexp.MustCompile(`^(\[[^\]\n]*\]\s*)?([^：:「」『』（）()\[\]\n]{1,24}?)\s*((?:[（(][^）)\n]*[）)])?)\s*[：:]\s*`)
	forumQuoteTime = regexp.MustCompile(`^\[[^\]\n]*\]\s*`)
	// 「（2026-11-16 15:08，zuiho_kai）」: a by-line (a clock time, then the name last) naming who said the lines under it.
	forumQuoteByline = regexp.MustCompile(`^[（(][^）)\n]*\d{1,2}:\d{2}[^）)\n]*[，,、\s]([^，,、\s（）()]{1,24})\s*[）)]$`)
	forumQuoteNoise  = regexp.MustCompile(`[\s「」『』"“”'‘’]+`)
)

// forumGenericSpeaker: labels that say a user spoke without saying which one.
var forumGenericSpeaker = map[string]bool{"用户": true, "用户原话": true, "原话": true, "user": true}

// taskForumQuotes renders the 用户原话 section, one 「名字：原话」 per quote. who looks a quote
// up in the channel history (nil = no lookup); names maps platform names to the group's names.
func taskForumQuotes(words string, names map[string]string, who func(text string) string) string {
	alias := func(n string) string {
		if v := strings.TrimSpace(names[n]); v != "" {
			return v
		}
		return n
	}
	var out []string
	carry, open := "", 0
	for _, raw := range strings.Split(strings.TrimSpace(words), "\n") {
		l := strings.TrimSpace(raw)
		bullet := ""
		if strings.HasPrefix(l, "- ") || strings.HasPrefix(l, "* ") {
			bullet, l = l[:2], strings.TrimSpace(l[2:])
		}
		if l == "" {
			continue
		}
		if open > 0 { // the rest of a quote that spans lines
			out = append(out, bullet+l)
			open += quoteDepth(l)
			continue
		}
		if m := forumQuoteByline.FindStringSubmatch(l); m != nil {
			carry = alias(m[1])
			out = append(out, bullet+l)
			continue
		}
		if strings.HasPrefix(l, "（") || strings.HasPrefix(l, "(") { // context, not a quote
			out = append(out, bullet+l)
			continue
		}
		stamp, speaker, note, text := "", "", "", l
		if m := forumQuoteHead.FindStringSubmatch(l); m != nil {
			stamp, speaker, text = m[1], strings.TrimSpace(m[2]), l[len(m[0]):]
			note = m[3]
		} else if m := forumQuoteTime.FindString(l); m != "" {
			stamp, text = m, l[len(m):]
		}
		open = quoteDepth(text)
		switch {
		case speaker != "" && !forumGenericSpeaker[strings.ToLower(speaker)]:
			speaker = alias(speaker)
		case carry != "":
			speaker = carry
		case who != nil:
			if found := who(text); found != "" {
				speaker = alias(found)
			} else {
				speaker = ""
			}
		default:
			speaker = ""
		}
		if speaker == "" {
			out = append(out, bullet+l)
			continue
		}
		out = append(out, bullet+stamp+speaker+note+"："+text)
	}
	return strings.Join(out, "\n")
}

func quoteDepth(s string) int {
	return strings.Count(s, "「") - strings.Count(s, "」")
}

// taskForumSpeakerNames reads <team dir>/speaker_names.json ({"zuiho_kai": "瑞凤"}); missing = none.
func (e *Engine) taskForumSpeakerNames() map[string]string {
	if e.team == nil || e.team.dir == "" {
		return nil
	}
	b, err := os.ReadFile(filepath.Join(e.team.dir, speakerNamesFile))
	if err != nil {
		return nil
	}
	var m map[string]string
	_ = json.Unmarshal(b, &m)
	return m
}

// taskForumQuoteCache: chat + quote start → author ("" = looked, not found), kept for the process
// so a sync does not read the channel again for the same line.
var taskForumQuoteCache sync.Map

// taskForumQuoteHistoryPages: how far back a quote is looked for (50 messages a page).
const taskForumQuoteHistoryPages = 4

// taskForumQuoteWho finds who posted text in chat ("discord:<channel>"): the oldest message (last 200)
// whose words contain the quote's start. "" when the platform cannot read history or no message matches.
func (e *Engine) taskForumQuoteWho(chat string) func(string) string {
	plat, channel, ok := strings.Cut(chat, ":")
	if !ok || channel == "" {
		return nil
	}
	reader, ok := e.platformForName(plat).(ChannelHistoryReader)
	if !ok {
		return nil
	}
	return taskForumQuoteWhoFrom(reader, chat)
}

func taskForumQuoteWhoFrom(reader ChannelHistoryReader, chat string) func(string) string {
	_, channel, _ := strings.Cut(chat, ":")
	return func(text string) string {
		key := []rune(forumQuoteNoise.ReplaceAllString(text, ""))
		if len(key) < 4 {
			return ""
		}
		if len(key) > 16 {
			key = key[:16]
		}
		needle := string(key)
		ck := chat + "\x00" + needle
		if v, ok := taskForumQuoteCache.Load(ck); ok {
			return v.(string)
		}
		// The oldest match: later posts that quote it (a handoff note, a reply) come after the words themselves.
		found, before := "", ""
		for page := 0; page < taskForumQuoteHistoryPages; page++ {
			msgs, err := reader.ChannelHistory(channel, before, backfillFetchLimit)
			if err != nil {
				// Not remembered: the first sync after a restart runs before Discord is connected,
				// and a remembered miss would hide the name until the next restart.
				return found
			}
			if len(msgs) == 0 {
				break
			}
			for _, m := range msgs { // oldest first
				if strings.Contains(forumQuoteNoise.ReplaceAllString(m.Content, ""), needle) {
					found = m.Author
					break
				}
			}
			before = msgs[0].ID
		}
		taskForumQuoteCache.Store(ck, found)
		return found
	}
}
