package core

import (
	"strings"
	"unicode/utf8"
)

// Opt-in sentence streaming for private voice relay (request "stream": true).
//
// Only EventText (the same public text the final answer is built from) feeds
// the splitter; thinking, tool output and permission events never do. A
// sentence is published as soon as its end punctuation arrives.
// Anything that looks like markup, code or a relay tag (<待转达 …>, <转达 …>)
// freezes streaming for the rest of the turn: that text is left for the final
// answer's normal processing and is never offered sentence by sentence.
const (
	voiceStreamMaxSentences = 64
	voiceStreamMaxBytes     = 16384
)

const (
	voiceSentenceEnders  = "。！？!?…\n"
	voiceSentenceClosers = "。！？!?…\n”’\"'」』）)】》"
)

// Any of these freeze streaming. "<" alone already covers <待转达 / <转达 and
// private-looking tags; the explicit tags are listed so intent stays obvious.
var voiceStreamBlocked = []string{"<待转达", "<转达", "<", "`", "[["}

type voiceSentenceSplitter struct {
	text      string // accumulated public EventText of this turn
	done      int    // byte offset of the published (or skipped) prefix
	sentences []string
	bytes     int
	frozen    bool
}

func voiceStreamBlockedText(s string) bool {
	for _, token := range voiceStreamBlocked {
		if strings.Contains(s, token) {
			return true
		}
	}
	return false
}

// feed appends public text and returns newly completed sentences.
func (s *voiceSentenceSplitter) feed(delta string) []string {
	if len(s.text)+len(delta) > maxInputBodyBytes {
		s.frozen = true
		return nil
	}
	s.text += delta
	var added []string
	for !s.frozen {
		end := s.nextEnd()
		if end < 0 {
			break
		}
		added = s.publish(end, added)
	}
	return added
}

// boundary marks the end of one assistant message (a tool call follows): the
// pending tail is complete even without sentence punctuation.
func (s *voiceSentenceSplitter) boundary() []string {
	if s.frozen || s.done >= len(s.text) {
		return nil
	}
	return s.publish(len(s.text), nil)
}

// nextEnd returns the end offset of the next complete sentence, or -1.
func (s *voiceSentenceSplitter) nextEnd() int {
	rest := s.text[s.done:]
	i := strings.IndexAny(rest, voiceSentenceEnders)
	if i < 0 {
		return -1
	}
	j := i
	for j < len(rest) {
		r, size := utf8.DecodeRuneInString(rest[j:])
		if r == utf8.RuneError && size <= 1 && !utf8.FullRuneInString(rest[j:]) {
			return -1 // split multi-byte rune: wait for the rest
		}
		if !strings.ContainsRune(voiceSentenceClosers, r) {
			return s.done + j
		}
		j += size
	}
	return s.done + j // do not wait for another model token before first speech
}

func (s *voiceSentenceSplitter) publish(end int, added []string) []string {
	sentence := s.text[s.done:end]
	// Keep whitespace spans too: the receipt must remain an exact prefix of
	// the final text. The speech consumer skips spans without spoken content.
	if voiceStreamBlockedText(sentence) || len(s.sentences) >= voiceStreamMaxSentences || s.bytes+len(sentence) > voiceStreamMaxBytes {
		s.frozen = true
		return added
	}
	s.done = end
	s.bytes += len(sentence)
	s.sentences = append(s.sentences, sentence)
	return append(added, sentence)
}

// rest is the public text after the published sentences, for final handling.
func (s *voiceSentenceSplitter) rest() string { return s.text[s.done:] }
