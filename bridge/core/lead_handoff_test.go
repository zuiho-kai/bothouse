package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func handoffTestEngine(t *testing.T, dir, name, display string, agent Agent) *Engine {
	t.Helper()
	e := NewEngine(name, agent, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangChinese)
	e.SetDataDir(dir)
	e.SetTeam("", display, false)
	return e
}

func writeHandoffLead(t *testing.T, dir, lead, name, at string) {
	t.Helper()
	b, err := json.Marshal(leadSelection{Lead: lead, Name: name, At: at})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// handoffTestTask creates one durable card with a member and a pending user
// question, then closes the lead run so only the task journal remains.
func handoffTestTask(t *testing.T, dir string) (*PublicProgress, string) {
	t.Helper()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "lead-a", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "discord:room", LangChinese, nil)
	id, err := p.Report(PublicProgressRequest{
		Project: "lead-a", SessionKey: "discord:room", Run: run, Seq: 1, Kind: "start",
		Title: "实现 274", Summary: "已开始核对旧主记录",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.AssignMember(TaskMemberAssignment{
		Ref: "无（新建）", Project: "lead-a", SessionKey: "discord:room", Run: run,
		TaskID: id, MemberID: "worker-1", Name: "Worker", Title: "实现交接记录",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(PublicProgressRequest{
		Project: "lead-a", SessionKey: "discord:room", Run: run, TaskID: id, Seq: 2,
		Kind: "waiting", Summary: "需要用户确认是否继续重试",
	}); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "等待用户确认")
	return p, id
}

func writeHandoffWorkspace(t *testing.T, dir string) {
	t.Helper()
	at := time.Now().UTC().Add(-5 * time.Minute)
	st := teamWorkspaceState{
		Version: teamWorkspaceStateVersion,
		Parents: map[string][]TeamWorkspace{
			"discord:room": {{ID: "ws-1", Name: "工作区一"}},
		},
		Handoffs: map[string][]TeamHandoff{
			"discord:ws-1": {{
				Chat: "discord:room", At: at, Title: "在途任务", Owner: "Worker",
				Due: at.Add(10 * time.Minute),
			}},
		},
	}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, teamWorkspaceFile), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeHandoffAsk(t *testing.T, dir string) {
	t.Helper()
	at := time.Now().UTC().Add(-2 * time.Minute)
	list := []*teamAsk{{
		ID: "ask-1", Platform: "discord", Workspace: "ws-1", Parent: "discord:room",
		SessionKey: "discord:room", Bot: "worker", At: at,
		Forwarded: []string{"📬 来自工作区 <#ws-1> 的「Worker」的提问：\n需要用户确认是否继续"},
	}}
	b, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "team-asks"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "team-asks", "lead-a.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func newHandoffTestAPI(dir string, engines map[string]*Engine) *APIServer {
	s := &APIServer{dataDir: dir, engines: engines, mux: http.NewServeMux()}
	s.mux.HandleFunc("/handoff/status", s.handleHandoffStatus)
	s.mux.HandleFunc("/handoff/show", s.handleHandoffShow)
	s.mux.HandleFunc("/handoff/switch", s.handleHandoffSwitch)
	s.mux.HandleFunc("/task/assign", s.handleTaskAssign)
	return s
}

func TestLeadHandoffInjectsDurableRecordAndDelta(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-a", "Lead A", "")
	a := handoffTestEngine(t, dir, "lead-a", "Lead A", &namedTestAgent{name: "claudecode"})
	if h := a.observeLeadSelection(); h != nil {
		t.Fatalf("initial selection must not create a handoff: %+v", h)
	}
	_, taskID := handoffTestTask(t, dir)
	writeHandoffWorkspace(t, dir)
	writeHandoffAsk(t, dir)

	writeHandoffLead(t, dir, "lead-d", "Lead D", time.Now().UTC().Format(time.RFC3339))
	d := handoffTestEngine(t, dir, "lead-d", "Lead D", &namedTestAgent{name: "codex"})
	session := d.sessions.GetOrCreateActive("discord:room")
	content := d.withTurnBlocks(session, "discord:room", "", "用户消息", true)
	for _, want := range []string{
		"主角色交接", "Lead A", "Lead D", taskID, "实现 274", "Worker",
		"工作区一", "在途任务", "需要用户确认是否继续", "不要重新派", "工具审批",
		"旧主的 CLI 内部 session", "public-progress/",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("handoff block missing %q:\n%s", want, content)
		}
	}
	if !strings.HasSuffix(content, "用户消息") {
		t.Fatal("the original user message must remain after the handoff block")
	}

	st, err := ReadLeadHandoffState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Pending == nil || st.Pending.Status != LeadHandoffActive || st.Pending.AckedAt.IsZero() {
		t.Fatalf("handoff not acknowledged: %+v", st.Pending)
	}
	if st.Pending.From != "lead-a" || st.Pending.To != "lead-d" {
		t.Fatalf("wrong switch endpoints: %+v", st.Pending)
	}

	// Same context, nothing new: no repeated block.
	if got := d.withTurnBlocks(session, "discord:room", "", "再次", true); got != "再次" {
		t.Fatalf("unchanged turn got extra context: %q", got)
	}

	// A member result after the switch must reach the new lead and keep the task id.
	// Append a key fact directly to the durable journal, as a member result would do,
	// and verify the next turn carries the delta.
	path := filepath.Join(dir, "public-progress")
	matches, _ := filepath.Glob(filepath.Join(path, "*", taskID+".json"))
	if len(matches) != 1 {
		t.Fatalf("task journal not found: %v", matches)
	}
	b, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatal(err)
	}
	var rec progressRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		t.Fatal(err)
	}
	rec.Task.Events = append(rec.Task.Events, TaskEvent{
		ID: "evt-result", TaskID: taskID, Kind: TaskEventResultReady,
		Summary: "成员结果：交接实现完成", Timestamp: time.Now().UTC(),
	})
	rec.Task.LatestProgress = "成员结果：交接实现完成"
	rec.Task.UpdatedAt = time.Now().UTC()
	b, _ = json.Marshal(rec)
	if err := os.WriteFile(matches[0], b, 0o600); err != nil {
		t.Fatal(err)
	}
	delta := d.withTurnBlocks(session, "discord:room", "", "下一步", true)
	if !strings.Contains(delta, "交接后更新") || !strings.Contains(delta, "成员结果：交接实现完成") || !strings.Contains(delta, taskID) {
		t.Fatalf("post-switch delta missing result:\n%s", delta)
	}

	// Restart: a fresh engine/agent context gets the stored record again.
	d2 := handoffTestEngine(t, dir, "lead-d", "Lead D", &namedTestAgent{name: "codex"})
	session2 := d2.sessions.GetOrCreateActive("discord:room")
	replayed := d2.withTurnBlocks(session2, "discord:room", "", "重启后", true)
	if !strings.Contains(replayed, "实现 274") || !strings.Contains(replayed, "主角色交接") {
		t.Fatalf("handoff did not survive restart:\n%s", replayed)
	}
}

func TestHandoffAPIRepeatedFailureAndLateLead(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-a", "Lead A", "")
	a := handoffTestEngine(t, dir, "lead-a", "Lead A", &namedTestAgent{name: "claudecode"})
	if err := a.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	a.observeLeadSelection()
	d := handoffTestEngine(t, dir, "lead-d", "Lead D", &namedTestAgent{name: "codex"})
	e := handoffTestEngine(t, dir, "lead-e", "Lead E", &namedTestAgent{name: "claudecode"})
	s := newHandoffTestAPI(dir, map[string]*Engine{"lead-a": a, "lead-d": d, "lead-e": e})

	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		rec := httptest.NewRecorder()
		s.mux.ServeHTTP(rec, req)
		return rec
	}

	rec := call(http.MethodPost, "/handoff/switch", `{"project":"lead-a","to":"lead-d"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("switch failed: %d %s", rec.Code, rec.Body)
	}
	var switched struct {
		OK      bool         `json:"ok"`
		Changed bool         `json:"changed"`
		Handoff *LeadHandoff `json:"handoff"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &switched); err != nil || !switched.OK || !switched.Changed || switched.Handoff == nil {
		t.Fatalf("bad switch response: %s %v", rec.Body, err)
	}
	sel, ok := readLeadSelectionFull(dir)
	if !ok || sel.Lead != "lead-d" {
		t.Fatalf("lead.json not updated: %+v", sel)
	}
	st, _ := ReadLeadHandoffState(dir)
	if st.Pending == nil || st.Pending.To != "lead-d" || st.Pending.Status != LeadHandoffPending {
		t.Fatalf("pending switch not persisted: %+v", st.Pending)
	}
	// The new lead's next turn gets the record even though the switch came
	// through the API rather than a hand-written lead.json.
	content := d.withTurnBlocks(d.sessions.GetOrCreateActive("discord:room"), "discord:room", "", "接手", true)
	if !strings.Contains(content, "主角色交接") || !strings.Contains(content, "Lead A") || !strings.Contains(content, "lead-a") {
		t.Fatalf("API switch did not reach the new lead:\n%s", content)
	}
	st, _ = ReadLeadHandoffState(dir)
	if st.Pending.Status != LeadHandoffActive {
		t.Fatalf("API switch was not acknowledged: %+v", st.Pending)
	}

	// Old lead may still report results, but must not dispatch new work.
	rec = call(http.MethodPost, "/task/assign", `{"project":"lead-a"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "not the current lead") {
		t.Fatalf("old lead was allowed to assign: %d %s", rec.Code, rec.Body)
	}

	// A switch to a bot that is not connected fails without clearing state.
	rec = call(http.MethodPost, "/handoff/switch", `{"project":"lead-d","to":"ghost"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("missing target should fail: %d %s", rec.Code, rec.Body)
	}
	sel, _ = readLeadSelectionFull(dir)
	if sel.Lead != "lead-d" {
		t.Fatalf("failed switch changed the lead: %+v", sel)
	}
	st, _ = ReadLeadHandoffState(dir)
	if st.Pending == nil || st.Pending.To != "lead-d" {
		t.Fatalf("failed switch cleared the pending record: %+v", st.Pending)
	}
	if len(st.History) == 0 || st.History[len(st.History)-1].Status != LeadHandoffFailed {
		t.Fatalf("failed switch not recorded: %+v", st.History)
	}

	// Repeated switch: the old pending record is superseded, never resurrected.
	rec = call(http.MethodPost, "/handoff/switch", `{"project":"lead-d","to":"lead-e"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("second switch failed: %d %s", rec.Code, rec.Body)
	}
	st, _ = ReadLeadHandoffState(dir)
	if st.Pending == nil || st.Pending.To != "lead-e" {
		t.Fatalf("second switch not authoritative: %+v", st.Pending)
	}
	var old *LeadHandoff
	for i := range st.History {
		if st.History[i].To == "lead-d" {
			old = &st.History[i]
		}
	}
	if old == nil || old.Status != LeadHandoffSuperseded {
		t.Fatalf("old switch not superseded: %+v", old)
	}

	// The durable state survives a process restart (new reader, same file).
	st2, err := ReadLeadHandoffState(dir)
	if err != nil || st2.Pending == nil || st2.Pending.To != "lead-e" {
		t.Fatalf("state did not survive restart: %+v %v", st2, err)
	}
}

func TestHandoffSwitchOldLeadGone(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-a", "Lead A", "2026-10-26T00:00:00Z")
	st := LeadHandoffState{Version: 1, Lead: "lead-a", LeadName: "Lead A", LeadSince: time.Now().UTC()}
	b, _ := json.Marshal(st)
	if err := os.WriteFile(filepath.Join(dir, "lead-handoff.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	d := handoffTestEngine(t, dir, "lead-d", "Lead D", &namedTestAgent{name: "codex"})
	s := newHandoffTestAPI(dir, map[string]*Engine{"lead-d": d})
	req := httptest.NewRequest(http.MethodPost, "/handoff/switch", strings.NewReader(`{"project":"lead-a","to":"lead-d"}`))
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("switch with the old engine gone failed: %d %s", rec.Code, rec.Body)
	}
	sel, _ := readLeadSelectionFull(dir)
	if sel.Lead != "lead-d" {
		t.Fatalf("lead.json not updated: %+v", sel)
	}
	got, _ := ReadLeadHandoffState(dir)
	if got.Pending == nil || got.Pending.From != "lead-a" || got.Pending.To != "lead-d" {
		t.Fatalf("handoff did not keep the old lead identity: %+v", got.Pending)
	}
}

func TestHandoffTargetStoppedKeepsLead(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-a", "Lead A", "")
	a := handoffTestEngine(t, dir, "lead-a", "Lead A", &namedTestAgent{name: "claudecode"})
	dead := handoffTestEngine(t, dir, "lead-dead", "Dead", &namedTestAgent{name: "codex"})
	dead.Stop()
	s := newHandoffTestAPI(dir, map[string]*Engine{"lead-a": a, "lead-dead": dead})
	req := httptest.NewRequest(http.MethodPost, "/handoff/switch", strings.NewReader(`{"project":"lead-a","to":"lead-dead"}`))
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("stopped target should fail: %d %s", rec.Code, rec.Body)
	}
	sel, _ := readLeadSelectionFull(dir)
	if sel.Lead != "lead-a" {
		t.Fatalf("stopped target changed the lead: %+v", sel)
	}
	st, _ := ReadLeadHandoffState(dir)
	if len(st.History) == 0 || st.History[len(st.History)-1].Status != LeadHandoffFailed {
		t.Fatalf("stopped target failure not recorded: %+v", st.History)
	}
}

func TestHandoffDoesNotInjectInWorkspace(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-a", "Lead A", "")
	a := handoffTestEngine(t, dir, "lead-a", "Lead A", &namedTestAgent{name: "claudecode"})
	a.observeLeadSelection()
	writeHandoffLead(t, dir, "lead-d", "Lead D", time.Now().UTC().Format(time.RFC3339))
	d := handoffTestEngine(t, dir, "lead-d", "Lead D", &namedTestAgent{name: "codex"})
	session := d.sessions.GetOrCreateActive("discord:ws-1")
	// Record the workspace parent so the chat is recognized as one.
	d.teamExit.resolver = d
	writeHandoffWorkspace(t, dir)
	if got := d.withTurnBlocks(session, "discord:ws-1", "", "工作区消息", true); strings.Contains(got, "主角色交接") {
		t.Fatalf("handoff leaked into a workspace: %s", got)
	}
}

func TestLeadHandoffShowUsesRequestedProjectOnly(t *testing.T) {
	dir := t.TempDir()
	writeHandoffLead(t, dir, "lead-d", "Lead D", "")
	st := LeadHandoffState{
		Version: 1, Lead: "lead-d", LeadName: "Lead D",
		Pending: &LeadHandoff{
			ID: "handoff-1", From: "lead-a", FromName: "Lead A",
			To: "lead-d", ToName: "Lead D", At: time.Now().UTC(), Status: LeadHandoffActive,
		},
	}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "lead-handoff.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	text, err := BuildLeadHandoffText(dir, "lead-x")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "handoff-1") || strings.Contains(text, "Lead A") {
		t.Fatalf("show for another project leaked the pending record:\n%s", text)
	}
	if !strings.Contains(text, "没有交接记录") {
		t.Fatalf("show for another project should report no record:\n%s", text)
	}
}

func TestLeadHandoffDeltaIncludesRoutineUpdateAfterSwitch(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	old := now.Add(-time.Hour)
	since := old.Add(30 * time.Minute)
	rec := progressRecord{
		Task: &Task{
			ID: "task-1", Title: "实现 274", Agent: "lead-a",
			State: TaskStateInProgress, FactStage: FactStageCodeModified,
			LatestProgress: "普通进展：已补测试", UpdatedAt: now,
			Events: []TaskEvent{{
				ID: "evt-old", TaskID: "task-1", Kind: TaskEventBlocked,
				Summary: "旧阻塞", Timestamp: old,
			}},
		},
		Platform: "discord", Lang: LangChinese, Closed: false, LastSeq: 1,
	}
	b, err := json.Marshal(rec)
	if err != nil {
		t.Fatal(err)
	}
	taskDir := filepath.Join(dir, "public-progress", "abc123")
	if err := os.MkdirAll(taskDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "task-1.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	delta := buildLeadHandoffDelta(dir, "lead-d", "lead-a", since, nil, nil)
	if !strings.Contains(delta, "状态更新为") || !strings.Contains(delta, "普通进展：已补测试") {
		t.Fatalf("routine update after the switch was dropped:\n%s", delta)
	}
}

func TestLeadHandoffCompletedResultIsNotLabeledPending(t *testing.T) {
	text := renderLeadHandoffBlock(&LeadHandoff{
		ID: "handoff-1", From: "lead-a", FromName: "Lead A",
		To: "lead-d", ToName: "Lead D", At: time.Now().UTC(), Status: LeadHandoffActive,
	}, &LeadHandoffSnapshot{
		GeneratedAt: time.Now().UTC(), TaskTotal: 1,
		Tasks: []LeadHandoffTask{{
			TaskID: "task-1", Title: "实现 274", Agent: "lead-a",
			State: TaskStateCompleted, FactStage: FactStageVerified,
			ResultSummary: "已验收",
		}},
	})
	if strings.Contains(text, "已有结果（待验收") {
		t.Fatalf("completed task was labeled as awaiting acceptance:\n%s", text)
	}
	if !strings.Contains(text, "结果：已验收") {
		t.Fatalf("completed result missing:\n%s", text)
	}
}

// TestLeadHandoffDeltaKeepsTaskOutsideTop12 is the regression test for the
// delta path: the injected snapshot is capped at the same 12-item board as the
// public task card, but a result on the 13th (older) card must still reach the
// new lead with its original task ID.
func TestLeadHandoffDeltaKeepsTaskOutsideTop12(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	taskDir := filepath.Join(dir, "public-progress", "abc123")
	if err := os.MkdirAll(taskDir, 0o700); err != nil {
		t.Fatal(err)
	}
	writeRecord := func(task *Task) {
		t.Helper()
		b, err := json.Marshal(progressRecord{Task: task, Platform: "discord", Lang: LangChinese})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(taskDir, task.ID+".json"), b, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Twelve newer in-progress cards fill the injected top 12.
	for i := 0; i < leadHandoffMaxTasks; i++ {
		writeRecord(&Task{
			ID: fmt.Sprintf("task-new-%02d", i), Title: "新任务",
			Agent: "lead-a", State: TaskStateInProgress, FactStage: FactStageCodeModified,
			LatestProgress: "进行中", UpdatedAt: now.Add(-time.Duration(i+1) * time.Minute),
		})
	}
	// The older completed card ranks 13th, so it is outside the capped picture;
	// its result event still arrives after the switch and must be in the delta.
	writeRecord(&Task{
		ID: "task-old-result", Title: "旧任务结果",
		Agent: "lead-a", State: TaskStateCompleted, FactStage: FactStageVerified,
		ResultSummary: "已验收", UpdatedAt: now.Add(-2 * time.Hour),
		Events: []TaskEvent{{
			ID: "evt-old", TaskID: "task-old-result", Kind: TaskEventResultReady,
			Summary: "成员结果：旧任务完成", Timestamp: now.Add(-5 * time.Minute),
		}},
	})

	snap := buildLeadHandoffSnapshot(dir, "lead-d", "lead-a", nil, nil)
	if snap.TaskTotal != leadHandoffMaxTasks+1 || len(snap.Tasks) != leadHandoffMaxTasks {
		t.Fatalf("snapshot cap: total=%d shown=%d", snap.TaskTotal, len(snap.Tasks))
	}
	for _, task := range snap.Tasks {
		if task.TaskID == "task-old-result" {
			t.Fatal("the 13th task should not be in the capped snapshot")
		}
	}
	delta := buildLeadHandoffDelta(dir, "lead-d", "lead-a", now.Add(-10*time.Minute), nil, nil)
	if !strings.Contains(delta, "task-old-result") || !strings.Contains(delta, "成员结果：旧任务完成") {
		t.Fatalf("delta dropped the 13th task's result:\n%s", delta)
	}
}
