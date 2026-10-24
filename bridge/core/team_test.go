package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestChatOf(t *testing.T) {
	if chatOf("discord:123:456") != chatOf("discord:123") {
		t.Fatal("per-user and shared keys of one channel should match")
	}
	if chatOf("discord:123") == chatOf("discord:999") {
		t.Fatal("different channels must differ")
	}
}

func writeTeamFile(t *testing.T, dir string, f teamFile) {
	t.Helper()
	b, _ := json.Marshal(f)
	if err := os.WriteFile(filepath.Join(dir, f.Project+".json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestTeamSummary(t *testing.T) {
	dir := t.TempDir()
	e := newTestEngine()
	e.name = "maomao"
	e.team = &teamState{dir: dir, name: "橘", inject: true, seen: map[string]*teamSession{}}
	now := time.Now()
	writeTeamFile(t, dir, teamFile{Project: "longniang", Name: "龙娘", Updated: now, Sessions: []teamEntry{
		{Key: "discord:111", Chat: "general", Task: "修 bug", Busy: true, Since: now.Add(-3 * time.Minute)},
		{Key: "discord:222", Chat: "dev", Task: "写测试", DoneAt: now.Add(-2 * time.Minute)},
	}})
	writeTeamFile(t, dir, teamFile{Project: "jingyu", Name: "鲸鱼娘", Updated: now.Add(-2 * time.Hour), Sessions: []teamEntry{
		{Key: "discord:111", Busy: true, Since: now},
	}})
	writeTeamFile(t, dir, teamFile{Project: "maomao", Name: "橘", Updated: now, Sessions: []teamEntry{
		{Key: "discord:111:9", Busy: true, Since: now},
	}})

	got, _ := e.teamSummary("discord:111:727")
	for _, want := range []string{"龙娘：在本频道忙了 3 分钟 「修 bug」", "龙娘：2 分钟前在#dev做完 「写测试」"} {
		if !strings.Contains(got, want) {
			t.Errorf("summary missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "鲸鱼娘") {
		t.Errorf("stale file should be ignored:\n%s", got)
	}
	if strings.Count(got, "\n") != 2 {
		t.Errorf("own file should be skipped:\n%s", got)
	}

	e.team.inject = false
	if got, _ := e.teamSummary("discord:111"); got != "" {
		t.Error("inject off should give no summary")
	}
}

func TestDynamicTeamLeadFollowsChannelSelection(t *testing.T) {
	e := newTestEngine()
	e.team = &teamState{dir: t.TempDir(), name: "橘", inject: true, seen: map[string]*teamSession{}}
	if !e.isTeamLead() {
		t.Fatal("configured lead should remain lead before a channel update")
	}
	e.setDynamicTeamLead(false)
	if e.isTeamLead() {
		t.Fatal("a channel selecting another role must disable lead behavior")
	}
	e.setDynamicTeamLead(true)
	if !e.isTeamLead() {
		t.Fatal("selecting this role again must restore lead behavior")
	}
}

func TestSharedLeadSelectionUsesProductDataFile(t *testing.T) {
	dir := t.TempDir()
	e := newTestEngine()
	e.name = "whale"
	e.dataDir = dir
	e.team = &teamState{dir: t.TempDir(), name: "鲸鱼娘", inject: true, seen: map[string]*teamSession{}}
	if !e.isTeamLead() {
		t.Fatal("configured fallback should remain active before an explicit selection")
	}
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"ju"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if e.isTeamLead() {
		t.Fatal("a selection for another role must disable this role")
	}
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"whale","name":"鲸鱼娘"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !e.isTeamLead() {
		t.Fatal("a DSH-written shared selection must make bridge role lead")
	}
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":""}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !e.isTeamLead() {
		t.Fatal("an empty selection must fall back to configured lead")
	}
}

type configuredTeamLeadTestPlatform struct{ stubPlatformEngine }

func (*configuredTeamLeadTestPlatform) HasConfiguredTeamLead() bool { return true }

func TestNoGateSuppressesUnaddressedSubAfterLeadSelection(t *testing.T) {
	dir := t.TempDir()
	e := newTestEngine()
	e.name = "sub"
	e.dataDir = dir
	e.team = &teamState{dir: t.TempDir(), name: "sub", inject: false, seen: map[string]*teamSession{}}
	p := configuredTeamLeadTestPlatform{stubPlatformEngine{n: "cloud_web"}}
	msg := &Message{Content: "群里消息", ChannelID: "room", SessionKey: "cloud_web:room"}
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"lead"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	e.name, e.team.name = "lead", "lead"
	if e.suppressUnaddressedGroup(&p, msg) {
		t.Fatal("the selected lead must receive an unmentioned message")
	}
	e.name, e.team.name = "sub", "sub"
	if !e.suppressUnaddressedGroup(&p, msg) {
		t.Fatal("selected non-lead should be suppressed without a gate")
	}
	if err := os.Remove(filepath.Join(dir, "lead.json")); err != nil {
		t.Fatal(err)
	}
	if !e.suppressUnaddressedGroup(&p, msg) {
		t.Fatal("configured team sub should be suppressed without a gate")
	}
}

func TestNoGateRoutingHonorsExplicitNameAndSoloProject(t *testing.T) {
	dir := t.TempDir()
	e := newTestEngine()
	e.name = "sub"
	e.dataDir = dir
	e.team = &teamState{dir: t.TempDir(), name: "sub", inject: false, seen: map[string]*teamSession{}}
	p := configuredTeamLeadTestPlatform{stubPlatformEngine{n: "cloud_web"}}
	msg := &Message{Content: "群里消息", ChannelID: "room", SessionKey: "cloud_web:room"}
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"lead"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !e.suppressUnaddressedGroup(&p, msg) {
		t.Fatal("non-selected sub should be suppressed")
	}
	msg.Mentioned = true
	if e.suppressUnaddressedGroup(&p, msg) {
		t.Fatal("an explicitly addressed member must not be suppressed")
	}
	e.team = nil
	msg.Mentioned = false
	if e.suppressUnaddressedGroup(&p, msg) {
		t.Fatal("a single-project engine must not be suppressed by shared lead state")
	}
}

func TestDynamicTeamLeadRefreshesWorkspaceOwnership(t *testing.T) {
	dir := t.TempDir()
	newEngine := func(name string, configured bool) *Engine {
		e := newTestEngine()
		e.name, e.dataDir = name, dir
		e.team = &teamState{dir: t.TempDir(), name: name, inject: configured, seen: map[string]*teamSession{}}
		e.SetTeamWorkspaces(true)
		return e
	}
	old := newEngine("old", true)
	newLead := newEngine("new", false)
	defer old.cancel()
	defer newLead.cancel()
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"new"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	old.handleMessage(old.platforms[0], &Message{SessionKey: "test:room", Platform: "test"})
	newLead.handleMessage(newLead.platforms[0], &Message{SessionKey: "test:room", Platform: "test"})
	if old.teamWS != nil {
		t.Fatal("old lead must release team workspaces after selection changes")
	}
	if newLead.teamWS == nil {
		t.Fatal("new lead must enable team workspaces after selection changes")
	}
}

func TestTeamBlockOnlyWhenBoardChanges(t *testing.T) {
	dir := t.TempDir()
	e := newTestEngine()
	e.name = "maomao"
	e.team = &teamState{dir: dir, name: "橘", inject: true, seen: map[string]*teamSession{}}
	now := time.Now()
	write := func(task string, since time.Time) {
		writeTeamFile(t, dir, teamFile{Project: "longniang", Name: "龙娘", Updated: time.Now(), Sessions: []teamEntry{
			{Key: "discord:111", Chat: "general", Task: task, Busy: true, Since: since},
		}})
	}
	s := &Session{AgentSessionID: "a1"}
	write("修 bug", now.Add(-3*time.Minute))
	if e.teamBlock(s, "discord:111") == "" {
		t.Fatal("first turn should get the board")
	}
	write("修 bug", now.Add(-10*time.Minute)) // only the elapsed time differs
	if got := e.teamBlock(s, "discord:111"); got != "" {
		t.Fatalf("unchanged board resent:\n%s", got)
	}
	write("写测试", now)
	if e.teamBlock(s, "discord:111") == "" {
		t.Fatal("changed board should be sent")
	}
	s.ResetTurnCtx()
	if e.teamBlock(s, "discord:111") == "" {
		t.Fatal("board should be resent after compaction")
	}
	os.Remove(filepath.Join(dir, "longniang.json"))
	if got := e.teamBlock(s, "discord:111"); !strings.Contains(got, "都没有在忙") {
		t.Fatalf("emptied board should be reported once, got:\n%s", got)
	}
	if got := e.teamBlock(s, "discord:111"); got != "" {
		t.Fatalf("empty board resent:\n%s", got)
	}
}

func TestTurnCtxSurvivesSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.json")
	sm := NewSessionManager(path)
	s := sm.GetOrCreateActive("discord:1")
	s.SetLastSeenMsgID("123")
	s.UpdateTurnCtx(func(c *TurnCtxSent) { c.Wiki = []string{"a.md"} })
	sm.Save()
	s2 := NewSessionManager(path).GetOrCreateActive("discord:1")
	if s2.GetLastSeenMsgID() != "123" {
		t.Fatalf("last seen = %q", s2.GetLastSeenMsgID())
	}
	got := false
	s2.UpdateTurnCtx(func(c *TurnCtxSent) { got = len(c.Wiki) == 1 })
	if !got {
		t.Fatal("turn ctx record lost on reload")
	}
}

func TestApplyGateBotContextNeverStartsTurn(t *testing.T) {
	e := newTestEngine()
	e.gate = &gateState{url: "http://127.0.0.1:1/never", timeout: time.Millisecond, fallback: "reply",
		buf: map[string][]string{}, held: map[string]*heldMsg{}, released: map[*Message]bool{}}
	s := &Session{}
	msg := &Message{SessionKey: "discord:1", UserName: "龙娘", Content: "【龙娘】做完了", FromBot: true}
	if !e.applyGate(nil, msg, s, "k") {
		t.Fatal("bot context must be consumed")
	}
	if got := e.gate.buf["k"]; len(got) != 1 || !strings.HasPrefix(got[0], "[Quoted teammate message]\n") {
		t.Fatalf("buffer = %v", got)
	}
	var quoted struct{ Author, Content string }
	if err := json.Unmarshal([]byte(strings.TrimPrefix(e.gate.buf["k"][0], "[Quoted teammate message]\n")), &quoted); err != nil || quoted.Author != msg.UserName || quoted.Content != msg.Content {
		t.Fatalf("quoted teammate = %+v, error = %v", quoted, err)
	}
	e.gate = nil
	if !e.applyGate(nil, &Message{Content: "x", FromBot: true}, s, "k") {
		t.Fatal("without a gate, bot context must still never start a turn")
	}
}

func TestTeamSummary_TruncatesTaskAndKeysVisibleTask(t *testing.T) {
	e := newTestEngine()
	e.name = "maomao"
	e.team = &teamState{dir: t.TempDir(), name: "橘", inject: true}
	prefix := strings.Repeat("测", 40)
	write := func(task string, busy bool) {
		writeTeamFile(t, e.team.dir, teamFile{Project: "longniang", Name: "龙娘", Updated: time.Now(), Sessions: []teamEntry{{Key: "discord:1", Task: task, Busy: busy, Since: time.Now(), DoneAt: time.Now()}}})
	}
	write(prefix+"旧尾巴", true)
	text, key := e.teamSummary("discord:1")
	if !strings.Contains(text, "「"+prefix+"」") || strings.Contains(text, "旧尾巴") || strings.Contains(key, "旧尾巴") {
		t.Fatalf("task not shortened: %s / %s", text, key)
	}
	write(prefix+"新尾巴", true)
	_, same := e.teamSummary("discord:1")
	if same != key {
		t.Fatal("invisible suffix must not resend board")
	}
	write("新任务", true)
	_, changed := e.teamSummary("discord:1")
	if changed == key {
		t.Fatal("busy task change lost from key")
	}
	write("新任务", false)
	_, done := e.teamSummary("discord:1")
	if done == changed {
		t.Fatal("busy state lost from key")
	}
}

type selfLeadTestPlatform struct {
	stubPlatformEngine
	lead bool
}

func (*selfLeadTestPlatform) HasConfiguredTeamLead() bool  { return true }
func (p *selfLeadTestPlatform) IsConfiguredTeamLead() bool { return p.lead }

// A wizard team (team_lead_bot on every bot, no gate, no team status board): an unaddressed
// message reaches only the lead; a message that @-s or names a sub reaches only that sub.
func TestNoGateWizardTeamRoutesByConfiguredLead(t *testing.T) {
	e := newTestEngine()
	e.team = nil
	lead := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, true}
	sub := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, false}
	msg := &Message{Content: "大家好", ChannelID: "c", SessionKey: "discord:c"}
	if e.suppressUnaddressedGroup(lead, msg) {
		t.Fatal("lead must answer an unaddressed message")
	}
	if !e.suppressUnaddressedGroup(sub, msg) {
		t.Fatal("sub must stay quiet on an unaddressed message")
	}
	toSub := &Message{Content: "<@S> 你是什么模型", ChannelID: "c", SessionKey: "discord:c", AddressedOther: true}
	if !e.suppressUnaddressedGroup(lead, toSub) {
		t.Fatal("lead must stay quiet when a sub is addressed")
	}
	toSub = &Message{Content: "<@S> 你是什么模型", ChannelID: "c", SessionKey: "discord:c", Mentioned: true}
	if e.suppressUnaddressedGroup(sub, toSub) {
		t.Fatal("the addressed sub must answer")
	}
	if e.suppressUnaddressedGroup(&stubPlatformEngine{n: "discord"}, msg) {
		t.Fatal("a solo bot without team_lead_bot must not be suppressed")
	}
}
