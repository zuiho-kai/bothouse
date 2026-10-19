package acp

import "strings"

var privateTags = [...]string{"think", "thinking", "analysis", "compacted-summary"}

// privateOutput removes explicit internal blocks before any reply consumer sees
// them. Only a possible tag prefix is buffered; hidden text is never retained.
// A new logical message/turn gets a fresh filter, even after an unclosed block.
// This is deliberately not a classifier for unmarked prose.
type privateOutput struct {
	pending  string
	stack    []string
	sealed   bool // excessive nesting fails closed until the next message
	markdown codeLiteral
}

func (f *privateOutput) feed(text string) string {
	var out strings.Builder
	for i := 0; i < len(text); i++ {
		c := text[i]
		if f.sealed {
			continue
		}
		if f.pending == "" {
			if len(f.stack) == 0 && f.markdown.consume(c) {
				out.WriteByte(c)
				continue
			}
			if c != '<' {
				if len(f.stack) == 0 {
					out.WriteByte(c)
				}
				continue
			}
		}
		f.pending += text[i : i+1]
		candidate := strings.ToLower(f.pending)
		prefix, matched := false, false
		for _, tag := range privateTags {
			for _, close := range []bool{false, true} {
				marker := "<" + tag + ">"
				if close {
					marker = "</" + tag + ">"
				}
				if candidate == marker {
					if close {
						if n := len(f.stack); n > 0 && f.stack[n-1] == tag {
							f.stack = f.stack[:n-1]
						}
					} else if len(f.stack) == 32 {
						f.sealed = true
					} else {
						f.stack = append(f.stack, tag)
					}
					f.pending = ""
					matched = true
					break
				}
				prefix = prefix || strings.HasPrefix(marker, candidate)
			}
			if matched {
				break
			}
		}
		if matched || prefix {
			continue
		}
		// All but the last byte were a tag prefix (no Markdown delimiters).
		// Reprocess the last byte: it might begin another tag or a code span.
		literal := f.pending[:len(f.pending)-1]
		f.pending = ""
		if len(f.stack) == 0 {
			out.WriteString(literal)
		}
		i--
	}
	return out.String()
}

// codeLiteral recognizes Markdown backtick spans and backtick/tilde fences.
// Delimiter runs can straddle ACP chunks. Delimiters themselves stream without
// delay; the run changes state before the following byte is considered.
type codeLiteral struct {
	char     byte
	width    int
	fence    bool
	runChar  byte
	runWidth int
	runStart bool
	indent   int // -1 after a non-space byte on a line
	closing  bool
}

func (m *codeLiteral) consume(c byte) bool {
	if m.runWidth > 0 && c != m.runChar {
		m.endRun()
	}
	literal := m.width > 0
	if m.closing {
		if c == '\n' {
			m.char, m.width, m.fence, m.closing = 0, 0, false, false
		} else if c != ' ' && c != '\t' && c != '\r' {
			m.closing = false
		}
	}
	if c == 0x60 || c == '~' {
		if m.runWidth == 0 {
			m.runChar, m.runStart = c, m.indent >= 0 && m.indent <= 3
		}
		m.runWidth++
		literal = true
	}
	if c == '\n' {
		m.indent = 0
	} else if c == ' ' && m.indent >= 0 {
		m.indent++
	} else {
		m.indent = -1
	}
	return literal
}

func (m *codeLiteral) endRun() {
	switch {
	case m.width == 0:
		if m.runStart && m.runWidth >= 3 {
			m.char, m.width, m.fence = m.runChar, m.runWidth, true
		} else if m.runChar == 0x60 {
			m.char, m.width = 0x60, m.runWidth
		}
	case m.fence:
		if m.runStart && m.runChar == m.char && m.runWidth >= m.width {
			m.closing = true
		}
	case m.runChar == m.char && m.runWidth == m.width:
		m.char, m.width = 0, 0
	}
	m.runWidth = 0
}

func (s *acpSession) resetPrivateOutput() {
	s.outputMu.Lock()
	s.outputFilter, s.outputMessageID = privateOutput{}, ""
	s.outputMu.Unlock()
}
