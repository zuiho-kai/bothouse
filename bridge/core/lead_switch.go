package core

// One-sentence lead switch (user 2026-10-21 「每个角色他都能当主角色，或者说兜底角色，比如说你今天额度不够了，我可以用
// <另一个角色>当兜底角色」「这个我预期可以一句话去换」). cc-connect itself recognises the sentence (rules, no model, so it
// works when the lead's quota is gone) and stores the lead in <data_dir>/gate-lead.json; the gate is optional:
//   - gate running: the request carries "lead" (contrib/gate/gate.py routes by it);
//   - gate not running: the fallback follows the current lead (lead "reply", the others "context") instead of the
//     wizard's static gate_fallback;
//   - the lead and the others get an identity note once per switch per session.
// Names come from the wizard's team file (gate-team.json: name, aliases, project, id); no built-in aliases.
// Handoff returns still go to the wizard's team_lead_bot (not switched here).

import (
	"encoding/json"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

const gateLeadFile = "gate-lead.json"

type leadMember struct {
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
	Project string   `json:"project"`
	ID      string   `json:"id"`
}

type leadTeam struct {
	Lead leadMember            `json:"lead"`
	Subs map[string]leadMember `json:"subs"`
}

// members: project → member (the lead's project from lead.project; subs are keyed by project).
func (t leadTeam) members() map[string]leadMember {
	out := map[string]leadMember{}
	if t.Lead.Project != "" {
		out[t.Lead.Project] = t.Lead
	}
	for k, m := range t.Subs {
		m.Project = k
		out[k] = m
	}
	return out
}

func loadLeadTeam(dataDir string) (leadTeam, bool) {
	var t leadTeam
	if dataDir == "" || !readJSONFile(filepath.Join(dataDir, gateTeamFile), &t) || t.Lead.Project == "" || len(t.Subs) == 0 {
		return t, false
	}
	return t, true
}

// LeadState is gate-lead.json. At == "" = never switched (the wizard's lead).
type LeadState struct {
	Lead string `json:"lead"`
	Name string `json:"name"`
	At   string `json:"at"`
}

var leadMu sync.Mutex

// CurrentLead: the switched lead when gate-lead.json names a team member, else the wizard's lead.
func CurrentLead(dataDir string) (LeadState, bool) {
	t, ok := loadLeadTeam(dataDir)
	if !ok {
		return LeadState{}, false
	}
	var s LeadState
	if readJSONFile(filepath.Join(dataDir, gateLeadFile), &s) {
		if m, ok := t.members()[s.Lead]; ok {
			s.Name = m.Name
			return s, true
		}
	}
	return LeadState{Lead: t.Lead.Project, Name: t.Lead.Name}, true
}

// SetLead stores project as the lead; already the lead = unchanged (every bot sees the same message).
func SetLead(dataDir, project string) (bool, error) {
	leadMu.Lock()
	defer leadMu.Unlock()
	cur, _ := CurrentLead(dataDir)
	if cur.Lead == project && cur.At != "" {
		return false, nil
	}
	t, _ := loadLeadTeam(dataDir)
	s := LeadState{Lead: project, Name: t.members()[project].Name, At: time.Now().Format("01-02 15:04:05")}
	b, _ := json.Marshal(s)
	return true, AtomicWriteFile(filepath.Join(dataDir, gateLeadFile), b, 0o644)
}

var (
	leadRole   = `(?:主角色|主角|兜底角色|兜底|负责人|带头的|主(?:$|[吧了啊呀哈呢，,。.!！~～\s]))`
	leadSwitch = `(?:换|切|改|转)`
	leadSep    = `[\s，,、:：]*`
	// 问句、假设句不算切换（来源：作者的 gate/lead.py NOT_COMMAND；「我可以用 X 当兜底……可以支持吗」是在问）
	leadNotCommand = regexp.MustCompile(`[?？]|吗|如果|假如|要是|的话|能不能|可不可以|会不会|怎么|是不是|为什么|什么时候|支持`)
)

func leadPatterns(who string) []*regexp.Regexp {
	ps := []string{
		leadSwitch + `回(?:给|成|到)?\s*` + who, // 换回 X
		`(?:主角色|主角|兜底角色|兜底|负责人)\s*(?:先|就|今天)?\s*` + leadSwitch + `?(?:成|到|为|给|用|是)\s*` + who, // 主角色换成 X
		`(?:让|换|切|改|用|由|请)\s*(?:成|到|为)?\s*` + who + `\s*(?:来|先|今天)?\s*(?:当|作为|顶|接)?\s*` + leadRole, // 让 X 当主
		`^\s*` + who + leadSep + `你?\s*(?:来|先|今天)?\s*(?:当|作为|接|顶)\s*` + leadRole, // X，你当主
		`^\s*` + who + leadSep + `你?\s*(?:来|先|今天)?\s*兜底`, // X 兜底
	}
	out := make([]*regexp.Regexp, len(ps))
	for i, p := range ps {
		out[i] = regexp.MustCompile(`(?i)` + p)
	}
	return out
}

// ParseLeadSwitch: the project the user hands the lead to with this message, or "".
// self is the project of the bot that got it ("你" while @-ing it); fromBot messages never count.
func ParseLeadSwitch(t leadTeam, text string, mentioned, fromBot bool, self string) string {
	text = strings.TrimSpace(text)
	if fromBot || text == "" || leadNotCommand.MatchString(text) {
		return ""
	}
	type alias struct{ a, p string }
	var as []alias
	for p, m := range t.members() {
		for _, a := range append([]string{m.Name}, m.Aliases...) {
			if a = strings.TrimSpace(a); a != "" {
				as = append(as, alias{a, p})
			}
		}
	}
	sort.Slice(as, func(i, j int) bool { return len(as[i].a) > len(as[j].a) })
	alts := []string{}
	for _, a := range as {
		q := regexp.QuoteMeta(a.a)
		if isASCII(a.a) {
			q = `\b` + q + `\b`
		}
		alts = append(alts, q)
	}
	who := `(?P<who>` + strings.Join(append(alts, `<@!?\d+>`, `你`), "|") + `)`
	for _, re := range leadPatterns(who) {
		m := re.FindStringSubmatch(text)
		if m == nil {
			continue
		}
		w := m[re.SubexpIndex("who")]
		ids := regexp.MustCompile(`<@!?(\d+)>`).FindAllStringSubmatch(w, -1)
		if w == "你" {
			ids = regexp.MustCompile(`<@!?(\d+)>`).FindAllStringSubmatch(text, -1)
			if len(ids) == 0 {
				if mentioned {
					return self
				}
				return ""
			}
		}
		if len(ids) == 1 {
			for p, mem := range t.members() {
				if mem.ID != "" && mem.ID == ids[0][1] {
					return p
				}
			}
			return ""
		}
		for _, a := range as {
			if strings.EqualFold(a.a, w) {
				return a.p
			}
		}
	}
	return ""
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}

// leadSwitchFor handles a user message that switches the lead: true when it was one. reply = this bot is the new
// lead and should confirm it.
func (e *Engine) leadSwitchFor(msg *Message) (handled, reply bool) {
	t, ok := loadLeadTeam(e.dataDir)
	if !ok {
		return false, false
	}
	target := ParseLeadSwitch(t, userTextOf(msg), msg.Mentioned, msg.FromBot, e.name)
	if target == "" {
		return false, false
	}
	if _, err := SetLead(e.dataDir, target); err != nil {
		return false, false
	}
	return true, target == e.name
}

// leadFallback: with a switched lead and no gate answer, the lead replies and the others listen.
func (e *Engine) leadFallback(mentioned bool, def string) string {
	s, ok := CurrentLead(e.dataDir)
	if !ok || s.At == "" || mentioned {
		return def
	}
	if s.Lead == e.name {
		return "reply"
	}
	return "context"
}

// leadIdentity is the note this bot gets once per switch per session ("" when never switched).
func (e *Engine) leadIdentity(session *Session) string {
	s, ok := CurrentLead(e.dataDir)
	if !ok || s.At == "" || session == nil {
		return ""
	}
	key := "lead:" + s.Lead + "@" + s.At
	send := false
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		if !slices.Contains(t.Wiki, key) {
			t.Wiki, send = append(t.Wiki, key), true
		}
	})
	if !send {
		return ""
	}
	if s.Lead == e.name {
		return "（主角色：用户 " + s.At + " 把主角色换成了你。人设里「只在被 @ 时开口」暂时不适用：没点名的消息由你接，" +
			"要拍板、派活的由你处理。如果用户这句是在切换，用一句话确认现在主角色是你。）"
	}
	return "（主角色：用户 " + s.At + " 把主角色换成了 " + s.Name + "。人设里写你是主的地方暂时不适用：没被 @ 或点名不开口。）"
}
