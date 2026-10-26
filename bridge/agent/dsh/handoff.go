package dsh

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/agent/acp"
	"github.com/chenhg5/cc-connect/core"
)

// ---- maomao fork: cold_cache_fresh / image_fresh for DSH roles ----
//
// core.Engine.freshOnColdCache only starts an idle session fresh when the agent
// can read the session's log (core.SessionHandoffReader). agent/acp is the
// generic ACP adapter and knows no log format, so a DSH role resumed every idle
// session: jingyu moved from codex to `type = "acp"` + a DSH launcher on
// 2026-10-21 and stopped getting fresh sessions from then on
// (~/.claude/reviews/idle-fresh-plan-1026.md section 1). The DSH log format is
// read here, in the DSH package, for both ways a DSH role is configured.

var (
	_ core.SessionHandoffReader = (*Agent)(nil)
	_ core.SessionHandoffReader = (*ACPAgent)(nil)
)

// ACPAgent is a `type = "acp"` agent whose command is DSH (a launcher that sets
// DSH_HOME, as jingyu's does). It is the plain ACP agent, Name() "acp"
// included, plus the DSH log reader.
type ACPAgent struct {
	*acp.Agent
	home string
}

func init() {
	// Wraps the "acp" factory that agent/acp registered (its init runs first:
	// this package imports it). Other ACP agents come back unchanged.
	core.RegisterAgent("acp", newACP)
}

func newACP(opts map[string]any) (core.Agent, error) {
	a, err := acp.New(opts)
	if err != nil {
		return nil, err
	}
	base, ok := a.(*acp.Agent)
	if !ok {
		return a, nil
	}
	if home := acpDSHHome(opts); home != "" {
		return &ACPAgent{Agent: base, home: home}, nil
	}
	return a, nil
}

// acpDSHHome returns the DSH_HOME of an ACP agent that runs DSH: the one its
// env or launcher script sets, else DSH's default when cmd is dsh itself; ""
// for any other ACP agent.
func acpDSHHome(opts map[string]any) string {
	if h := core.DSHHomeFromOptions(opts); h != "" {
		return expandHome(h)
	}
	cmd, _ := opts["cmd"].(string)
	if cmd == "" {
		cmd, _ = opts["command"].(string)
	}
	if filepath.Base(strings.TrimSpace(cmd)) == "dsh" {
		return defaultDSHHome(opts)
	}
	return ""
}

// defaultDSHHome is where a DSH started with these options keeps its sessions:
// DSH_HOME from options, else from this process, else ~/.dsh (DSH's default).
func defaultDSHHome(opts map[string]any) string {
	if h := core.DSHHomeFromOptions(opts); h != "" {
		return expandHome(h)
	}
	if h := os.Getenv("DSH_HOME"); h != "" {
		return h
	}
	if h, err := os.UserHomeDir(); err == nil {
		return filepath.Join(h, ".dsh")
	}
	return ""
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			return filepath.Join(h, p[1:])
		}
	}
	return p
}

// ReadSessionHandoff implements core.SessionHandoffReader.
func (a *Agent) ReadSessionHandoff(sessionID string) (*core.SessionHandoff, error) {
	return readHandoff(a.home, sessionID)
}

// ReadSessionHandoff implements core.SessionHandoffReader.
func (a *ACPAgent) ReadSessionHandoff(sessionID string) (*core.SessionHandoff, error) {
	return readHandoff(a.home, sessionID)
}

func readHandoff(home, sessionID string) (*core.SessionHandoff, error) {
	path := core.FindDSHSessionLog(home, sessionID)
	if path == "" {
		return nil, fmt.Errorf("dsh: session log not found for %s under %s", sessionID, home)
	}
	text, err := core.ReadDSHLog(path)
	if err != nil {
		return nil, fmt.Errorf("dsh: read session log: %w", err)
	}
	h, err := parseHandoff(bytes.NewReader(text))
	if err != nil {
		return nil, fmt.Errorf("dsh: read session log: %w", err)
	}
	h.Path = path
	return h, nil
}

// logLine is one DSH session log line: {"type","seq","time"(ms),"data"}.
// Fields read, from real jingyu logs (DSH 2026-10, session.v4):
//   - assistant/message: data.message.content blocks (text / reasoning /
//     tool-call) and data.usage {inputTokens, cacheReadTokens, ...}, one per
//     model response; inputTokens excludes cacheReadTokens.
//   - user/message: data.content text blocks, data.source.kind "user" for what
//     cc-connect sent ("time-context", "runtime-context", "agent-instructions",
//     "compact-checkpoint", ... are DSH's own).
//   - compaction/summary: data.summary text blocks replacing what came before.
//   - turn/start: a new turn.
type logLine struct {
	Type string `json:"type"`
	Time int64  `json:"time"`
	Data struct {
		Content []block `json:"content"` // user/message
		Source  *struct {
			Kind string `json:"kind"`
		} `json:"source"`
		Message *struct {
			Content []block `json:"content"`
		} `json:"message"` // assistant/message
		Usage *struct {
			InputTokens     int `json:"inputTokens"`
			CacheReadTokens int `json:"cacheReadTokens"`
		} `json:"usage"`
		Summary []block `json:"summary"` // compaction/summary
	} `json:"data"`
}

type block struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// handoffParser walks a log once, keeping what the model's context holds after
// its newest compaction.
type handoffParser struct {
	h       core.SessionHandoff
	inReply bool // the last Tail entry is an assistant reply of the running turn
}

func parseHandoff(r io.Reader) (*core.SessionHandoff, error) {
	var p handoffParser
	br := bufio.NewReader(r)
	for {
		raw, err := br.ReadBytes('\n') // tool results can be megabytes on one line
		if len(raw) > 0 {
			var l logLine
			if json.Unmarshal(raw, &l) == nil {
				p.add(&l)
			}
		}
		if err == io.EOF {
			return &p.h, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

func (p *handoffParser) add(l *logLine) {
	h := &p.h
	ts := time.UnixMilli(l.Time)
	switch l.Type {
	case "turn/start":
		p.inReply = false
	case "compaction/summary":
		h.CompactSummary = blockText(l.Data.Summary)
		h.CompactedAt = ts
		h.Tail, p.inReply = nil, false
		// DSH writes no post-compaction size; the next reply's usage sets it.
		h.ContextTokens = 0
	case "user/message":
		if l.Data.Source == nil || l.Data.Source.Kind != "user" {
			return
		}
		text := blockText(l.Data.Content)
		if text == "" {
			return
		}
		p.inReply = false // also a message steered into a running turn
		h.Tail = append(h.Tail, core.HistoryEntry{Role: "user", Content: text, Timestamp: ts})
	case "assistant/message":
		if u := l.Data.Usage; u != nil && u.InputTokens+u.CacheReadTokens > 0 {
			h.LastActivity = ts
			h.ContextTokens = u.InputTokens + u.CacheReadTokens
		}
		if l.Data.Message == nil {
			return
		}
		text := blockText(l.Data.Message.Content)
		if text == "" || text == "NO_REPLY" {
			return
		}
		e := core.HistoryEntry{Role: "assistant", Content: text, Timestamp: ts}
		// Text before a tool call is progress chatter; the turn's last text
		// is the reply the channel saw.
		if n := len(h.Tail); p.inReply && n > 0 {
			h.Tail[n-1] = e
			return
		}
		h.Tail = append(h.Tail, e)
		p.inReply = true
	}
}

// blockText joins the text blocks (not reasoning or tool calls).
func blockText(blocks []block) string {
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
			parts = append(parts, strings.TrimSpace(b.Text))
		}
	}
	return strings.Join(parts, "\n")
}
