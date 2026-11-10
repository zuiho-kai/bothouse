package core

// Team experience: personal agents (a teammate's own bothouse on their own computer, their own CLI and
// quota, their own bot in the team server) work with the team's lead. The lead hands work to them with
// the team's related experience attached (bothouse send --experience); they hand back reusable lessons as
// lines starting with 【经验】, which the lead's bridge files into the team memory, one page per lesson,
// where every role's wiki search finds them. Only those lines leave the personal computer: its chats,
// own memory and keys stay there.
//
// Config (lead project): team_experience_dir = the folder inside the team wiki; personal_agents = the
// bot user IDs of the personal agents (they must also be allowed bots on the platform, allow_bots).

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

const experienceMarker = "【经验】"

// experienceSearchTop: lessons attached to one dispatch.
const experienceSearchTop = 10 // 沿用已有配置：wiki search.py 的 TOP = 10（contrib/wiki/llmwiki/search.py）

const experienceReadme = `# 团队经验

个人 agent 交活时带回的经验条，一条一页，由主角色的桥自动收进来。每页写着来源（哪个 agent、哪个频道、哪条消息）。
撤回一条：删掉那一页。
`

// SetTeamExperience turns the experience loop on for this project (lead side). dir "" turns it off.
func (e *Engine) SetTeamExperience(dir string, personalAgents []string) {
	dir = strings.TrimSpace(dir)
	if strings.HasPrefix(dir, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			dir = filepath.Join(home, dir[2:])
		}
	}
	var ids []string
	for _, id := range personalAgents {
		if id = strings.Trim(strings.TrimSpace(id), "<@!>"); id != "" {
			ids = append(ids, id)
		}
	}
	e.experienceDir, e.personalAgents = dir, ids
}

func (e *Engine) isPersonalAgent(id string) bool {
	for _, a := range e.personalAgents {
		if a == id {
			return true
		}
	}
	return false
}

// experienceLines returns the lessons in a message: lines that start with 【经验】 (list marks allowed).
func experienceLines(text string) []string {
	var out []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "-*•> "))
		if !strings.HasPrefix(line, experienceMarker) {
			continue
		}
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(line, experienceMarker), "：: "))
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

// collectExperience files the 【经验】 lines of a personal agent's message into the team memory.
// It runs for every message that reaches the engine, addressed to this bot or not.
func (e *Engine) collectExperience(msg *Message) {
	if e.experienceDir == "" || msg == nil || !msg.FromBot || !e.isPersonalAgent(msg.UserID) {
		return
	}
	lines := experienceLines(msg.Content)
	if len(lines) == 0 {
		return
	}
	n, err := writeExperience(e.experienceDir, msg.UserName, msg.UserID, msg.SessionKey, msg.MessageID, lines, time.Now())
	if err != nil {
		slog.Warn("team experience: not filed", "agent", msg.UserID, "error", err)
		return
	}
	slog.Info("team experience: filed", "agent", msg.UserID, "lessons", n, "dir", e.experienceDir)
}

var experienceUnsafe = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

func writeExperience(dir, agentName, agentID, sessionKey, messageID string, lines []string, now time.Time) (int, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	readme := filepath.Join(dir, "README.md")
	if _, err := os.Stat(readme); os.IsNotExist(err) {
		if err := os.WriteFile(readme, []byte(experienceReadme), 0o644); err != nil {
			return 0, err
		}
	}
	msgPart := experienceUnsafe.ReplaceAllString(messageID, "")
	if msgPart == "" {
		msgPart = fmt.Sprint(now.UnixNano())
	}
	written := 0
	for i, line := range lines {
		name := fmt.Sprintf("%s-%s-%d.md", now.Format("20060102"), msgPart, i+1)
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			continue // the same message again (replay after restart)
		}
		desc := strings.ReplaceAll(line, "\"", "'")
		body := fmt.Sprintf("---\nname: %s\ndescription: \"%s\"\nsource_agent: \"%s\"\nsource_agent_id: \"%s\"\nsource_session: \"%s\"\nsource_message: \"%s\"\ncreated: %s\n---\n\n# 经验\n\n%s\n\n来源：%s（%s）在 %s 交活时带回。\n",
			strings.TrimSuffix(name, ".md"), desc, agentName, agentID, sessionKey, messageID, now.Format(time.RFC3339), line, agentName, agentID, sessionKey)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

type experienceHit struct {
	Text, Agent string
	score       int
}

// experienceTokens: lower-case ASCII words, and each pair of neighbouring Han characters (Chinese has no
// spaces; the wiki's own search tokenizes Han text into bigrams for the same reason).
func experienceTokens(s string) map[string]bool {
	out := map[string]bool{}
	var word []rune
	var prev rune
	flush := func() {
		if len(word) > 1 {
			out[strings.ToLower(string(word))] = true
		}
		word = word[:0]
	}
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			flush()
			if prev != 0 {
				out[string([]rune{prev, r})] = true
			}
			prev = r
			continue
		}
		prev = 0
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			word = append(word, r)
		} else {
			flush()
		}
	}
	flush()
	return out
}

var discordMention = regexp.MustCompile(`<@[!&]?\d+>`)

// searchExperience ranks the filed lessons by how many query tokens they share.
func searchExperience(dir, query string) []experienceHit {
	q := experienceTokens(discordMention.ReplaceAllString(query, " "))
	if dir == "" || len(q) == 0 {
		return nil
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.md"))
	var hits []experienceHit
	for _, f := range files {
		if filepath.Base(f) == "README.md" {
			continue
		}
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		text, agent := experiencePage(string(data))
		if text == "" {
			continue
		}
		score := 0
		for t := range experienceTokens(text) {
			if q[t] {
				score++
			}
		}
		if score > 0 {
			hits = append(hits, experienceHit{Text: text, Agent: agent, score: score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	if len(hits) > experienceSearchTop {
		hits = hits[:experienceSearchTop]
	}
	return hits
}

// experiencePage reads the lesson and its source agent back from a page writeExperience made.
func experiencePage(s string) (text, agent string) {
	for _, line := range strings.Split(s, "\n") {
		if v, ok := strings.CutPrefix(line, "description: "); ok && text == "" {
			text = strings.Trim(v, "\"")
		}
		if v, ok := strings.CutPrefix(line, "source_agent: "); ok && agent == "" {
			agent = strings.Trim(v, "\"")
		}
	}
	return text, agent
}

// WithExperience appends the related team lessons and the hand-back rule to a dispatch message.
func (e *Engine) WithExperience(message string) (string, error) {
	if e.experienceDir == "" {
		return "", fmt.Errorf("--experience: this project has no team_experience_dir")
	}
	var b strings.Builder
	b.WriteString(message)
	b.WriteString("\n\n")
	if hits := searchExperience(e.experienceDir, message); len(hits) > 0 {
		b.WriteString("团队经验（团队记忆里和这件活相关的）：\n")
		for _, h := range hits {
			fmt.Fprintf(&b, "- %s（来自 %s）\n", h.Text, h.Agent)
		}
	} else {
		b.WriteString("团队经验：团队记忆里还没有和这件活相关的。\n")
	}
	b.WriteString("交活时：结果之后另起行，每条以后还用得上的做法或踩过的坑写一行，以「【经验】」开头；只写做法，不写聊天原话、私事、密钥。")
	return b.String(), nil
}

// experienceHint tells the lead which bots are personal agents and how to hand work to them.
func (e *Engine) experienceHint() string {
	if e.experienceDir == "" || len(e.personalAgents) == 0 {
		return ""
	}
	var at []string
	for _, id := range e.personalAgents {
		at = append(at, "<@"+id+">")
	}
	return fmt.Sprintf("Personal agents (teammates' own agents on their own computers, using their own quota) in this team: %s. "+
		"To hand one a task, run `bothouse send --experience -m \"<@id> <task>\"`: the bridge attaches the related team lessons and asks for lessons back. "+
		"Lines they send starting with 【经验】 are filed automatically into the team memory at %q (one page each; delete a page to withdraw it).",
		strings.Join(at, " "), e.experienceDir)
}
