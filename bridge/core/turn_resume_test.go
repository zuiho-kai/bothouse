//go:build !windows

package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// ---- helpers ----

// shortenTurnResume makes resumes start without the 10 s stagger.
func shortenTurnResume(t *testing.T) {
	t.Helper()
	old := turnResumeStagger
	turnResumeStagger = 10 * time.Millisecond
	t.Cleanup(func() { turnResumeStagger = old })
}

// seedJournal writes entries the way an earlier process would, so the engine
// opening the same file sees them as inherited. fix runs on each after Begin
// (Begin stamps StartedAt).
func seedJournal(t *testing.T, dataDir string, entries []TurnJournalEntry, fix func(i int, en *TurnJournalEntry)) []string {
	t.Helper()
	j, err := OpenTurnJournal(TurnJournalPath(dataDir, "test"))
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for i, en := range entries {
		out, err := j.Begin(en)
		if err != nil {
			t.Fatal(err)
		}
		if fix != nil {
			if _, err := j.Update(out.TurnID, func(x *TurnJournalEntry) { fix(i, x) }); err != nil {
				t.Fatal(err)
			}
		}
		ids = append(ids, out.TurnID)
	}
	return ids
}

type resumeRecorder struct {
	mu        sync.Mutex
	delivered []*TimerJob
	entries   []TurnJournalEntry
	notices   []string
	onDeliver func(en TurnJournalEntry, job *TimerJob)
}

func (r *resumeRecorder) hooks() turnResumeHooks {
	return turnResumeHooks{
		deliver: func(en TurnJournalEntry, job *TimerJob) error {
			if r.onDeliver != nil {
				r.onDeliver(en, job)
			}
			r.mu.Lock()
			defer r.mu.Unlock()
			r.delivered = append(r.delivered, job)
			r.entries = append(r.entries, en)
			return nil
		},
		notify: func(en TurnJournalEntry, text string) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.notices = append(r.notices, text)
			return nil
		},
	}
}

func (r *resumeRecorder) counts() (int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.delivered), len(r.notices)
}

func (r *resumeRecorder) noticeText() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.notices, "\n")
}

func newResumeEngine(t *testing.T, dataDir string, ps ...Platform) *Engine {
	t.Helper()
	if len(ps) == 0 {
		ps = []Platform{&stubPlatformEngine{n: "test"}}
	}
	e := NewEngine("test", &stubAgent{}, ps, "", LangEnglish)
	e.SetDataDir(dataDir)
	// Stray scan is exercised by its own test; keep it off the others.
	strayScanned.Store(dataDir, struct{}{})
	t.Cleanup(func() { e.Stop() })
	return e
}

func userEntry(key, msg string) TurnJournalEntry {
	return TurnJournalEntry{Project: "test", SessionKey: key, InteractiveKey: key, Platform: strings.SplitN(key, ":", 2)[0],
		Trigger: TurnTriggerUser, LastUserMessage: msg, AgentType: "claudecode", AgentSessionID: "sid-1"}
}

// ---- fake bridge + fake agent (real processes) ----

const fakeBridgeEnv = "K4_FAKE_BRIDGE_DIR"

// TestK4FakeBridgeHelper is not a test: run as a child (env set), it plays the
// bridge: starts a fake agent in its own process group whose command line
// carries the bridge's agent-prompts marker and --resume <sid>, records the
// turn in the journal (unless K4_FAKE_BRIDGE_NOJOURNAL), says ready, and waits
// to be SIGKILLed.
func TestK4FakeBridgeHelper(t *testing.T) {
	dir := os.Getenv(fakeBridgeEnv)
	if dir == "" {
		t.Skip("helper process only")
	}
	args := strings.Fields(os.Getenv("K4_FAKE_AGENT_ARGS"))
	cmd := exec.Command("/bin/sh", append([]string{"-c", "sleep 300; :", "sh"}, args...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	pid := cmd.Process.Pid
	if os.Getenv("K4_FAKE_BRIDGE_NOJOURNAL") == "" {
		j, err := OpenTurnJournal(TurnJournalPath(dir, "test"))
		if err != nil {
			os.Exit(3)
		}
		en := userEntry("test:c1", "跑一个长活")
		en.AgentPID, en.AgentPGID, en.AgentSeenAt = pid, pid, time.Now()
		if _, err := j.Begin(en); err != nil {
			os.Exit(4)
		}
	}
	_ = os.WriteFile(filepath.Join(dir, "agent.pid"), []byte(strconv.Itoa(pid)), 0o600)
	time.Sleep(5 * time.Minute)
}

// startFakeBridge runs the helper, waits for its agent, SIGKILLs the helper and
// returns the agent's pid (now an orphan, parent gone).
func startFakeBridge(t *testing.T, dataDir string, agentArgs string, noJournal bool) int {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestK4FakeBridgeHelper$")
	cmd.Env = append(os.Environ(), fakeBridgeEnv+"="+dataDir, "K4_FAKE_AGENT_ARGS="+agentArgs)
	if noJournal {
		cmd.Env = append(cmd.Env, "K4_FAKE_BRIDGE_NOJOURNAL=1")
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pidFile := filepath.Join(dataDir, "agent.pid")
	var pid int
	waitFor(t, "fake agent started", func() bool {
		b, err := os.ReadFile(pidFile)
		if err != nil {
			return false
		}
		pid, _ = strconv.Atoi(string(b))
		return pid > 0
	})
	t.Cleanup(func() { _ = syscall.Kill(-pid, syscall.SIGKILL) })
	_ = cmd.Process.Signal(syscall.SIGKILL) // the bridge dies mid-turn
	_ = cmd.Wait()
	waitFor(t, "agent orphaned", func() bool {
		procs, _ := psSnapshot()
		for _, p := range procs {
			if p.pid == pid {
				return p.ppid == 1
			}
		}
		return false
	})
	return pid
}

func countProcsWith(t *testing.T, sub string) int {
	t.Helper()
	procs, err := psSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, p := range procs {
		if strings.Contains(p.command, sub) && !strings.Contains(p.command, "-test.run") {
			n++
		}
	}
	return n
}

func shortTermWait(t *testing.T) {
	old := orphanTermWait
	orphanTermWait = time.Second
	t.Cleanup(func() { orphanTermWait = old })
}

// ①: the bridge is SIGKILLed mid-turn; the next start kills the agent group it
// left before resuming, so the session id never runs in two processes, and the
// turn resumes once.
func TestTurnResume_OrphanReapedBeforeResume_RealProcess(t *testing.T) {
	shortenTurnResume(t)
	shortTermWait(t)
	dataDir := t.TempDir()
	marker := "--resume sid-1 --append-system-prompt-file " + dataDir + "/agent-prompts/p.md"
	pid := startFakeBridge(t, dataDir, marker, false)
	if !groupAlive(pid) {
		t.Fatal("orphan group not alive before resume")
	}

	e := newResumeEngine(t, dataDir)
	rec := &resumeRecorder{}
	var aliveAtDeliver, procsAtDeliver = true, -1
	rec.onDeliver = func(en TurnJournalEntry, job *TimerJob) {
		aliveAtDeliver = groupAlive(pid)
		procsAtDeliver = countProcsWith(t, "--resume sid-1")
	}
	e.turnResumeHooks = rec.hooks()
	e.ResumeInterruptedTurns()
	waitFor(t, "resume delivered", func() bool { n, _ := rec.counts(); return n == 1 })
	if aliveAtDeliver || procsAtDeliver != 0 {
		t.Fatalf("at delivery: old group alive=%v, processes on --resume sid-1=%d; want gone, 0", aliveAtDeliver, procsAtDeliver)
	}
	if job := rec.delivered[0]; job.resume == nil || job.SessionMode != "reuse" || !strings.Contains(job.Prompt, "跑一个长活") {
		t.Fatalf("delivered job: %+v", job)
	}
}

// ⑥: no journal entry at all (write failed, entry gone) — the start-up scan
// still kills an agent group the earlier bridge left.
func TestTurnResume_StrayScanWithoutJournal_RealProcess(t *testing.T) {
	shortTermWait(t)
	dataDir := t.TempDir()
	marker := "--append-system-prompt-file " + dataDir + "/agent-prompts/p.md"
	pid := startFakeBridge(t, dataDir, marker, true)
	oldStart := StartTime
	time.Sleep(1100 * time.Millisecond) // ps start times are whole seconds
	StartTime = time.Now()
	t.Cleanup(func() { StartTime = oldStart; strayScanned.Delete(dataDir) })

	e := NewEngine("test", &stubAgent{}, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	e.SetDataDir(dataDir)
	t.Cleanup(func() { e.Stop() })
	e.ResumeInterruptedTurns()
	if groupAlive(pid) {
		t.Fatal("stray agent group still alive after the start-up scan")
	}
}

// ⑥: a codex exec turn's process group is recognised by its own markers.
func TestTurnResume_CodexExecOrphanReaped_RealProcess(t *testing.T) {
	shortTermWait(t)
	dataDir := t.TempDir()
	cmd := exec.Command("/bin/sh", "-c", "sleep 300; :", "codex", "exec", "--skip-git-repo-check", "--json", "resume", "th-1", "-")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = syscall.Kill(-pid, syscall.SIGKILL) })

	e := newResumeEngine(t, dataDir)
	en := TurnJournalEntry{TurnID: "t1", AgentType: "codex", AgentPID: pid, AgentPGID: pid, StartedAt: time.Now(), AgentSeenAt: time.Now()}
	if err := e.reapTurnOrphan(en); err != nil {
		t.Fatalf("reap: %v", err)
	}
	if groupAlive(pid) {
		t.Fatal("codex exec group still alive")
	}

	// A reused pgid without the markers is left alone.
	other := exec.Command("/bin/sh", "-c", "sleep 300; :")
	other.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := other.Start(); err != nil {
		t.Fatal(err)
	}
	opid := other.Process.Pid
	go func() { _ = other.Wait() }()
	t.Cleanup(func() { _ = syscall.Kill(-opid, syscall.SIGKILL) })
	en.AgentPID, en.AgentPGID = opid, opid
	if err := e.reapTurnOrphan(en); err != nil || !groupAlive(opid) {
		t.Fatalf("unrelated group: err=%v alive=%v; want left alone", err, groupAlive(opid))
	}
}

// ⑥: an old process that cannot be stopped: no resume, and the channel is told.
func TestTurnResume_ReapFailureTellsChannel(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "活")}, nil)
	e := newResumeEngine(t, dataDir)
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.turnResumeHooks.reap = func(TurnJournalEntry) error { return errors.New("still alive") }
	e.ResumeInterruptedTurns()
	waitFor(t, "stuck notice", func() bool { _, n := rec.counts(); return n == 1 })
	if d, _ := rec.counts(); d != 0 || !strings.Contains(rec.noticeText(), "重启前的进程还没退出") {
		t.Fatalf("delivered=%d notices=%q", d, rec.noticeText())
	}
	if len(e.turnJournalStore().List()) != 1 {
		t.Fatal("entry should stay for the next start")
	}
}

// ①/S3: a platform reconnecting fires onPlatformReady again; resume runs once.
func TestTurnResume_OncePerProcess(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	seedJournal(t, dataDir, []TurnJournalEntry{userEntry("discord:c1", "活")}, nil)
	p := &stubLifecyclePlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := newResumeEngine(t, dataDir, p)
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.OnPlatformReady(p)
	waitFor(t, "first resume", func() bool { n, _ := rec.counts(); return n == 1 })
	for i := 0; i < 3; i++ {
		e.OnPlatformUnavailable(p, nil)
		e.OnPlatformReady(p)
	}
	time.Sleep(200 * time.Millisecond)
	if n, _ := rec.counts(); n != 1 {
		t.Fatalf("resumes = %d after reconnects, want 1", n)
	}
}

// ①/S4: a chain only resumes its newest entry; the older entry on the same
// chat folds its message in; the one its resume superseded is dropped.
func TestTurnResume_ChainOnlyNewest(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	ids := seedJournal(t, dataDir, []TurnJournalEntry{
		userEntry("test:c1", "最早那条"),
		userEntry("test:c1", "原始轮"),
		userEntry("test:c1", "续做轮"),
	}, func(i int, x *TurnJournalEntry) {
		x.StartedAt = time.Now().Add(time.Duration(i-3) * time.Minute)
	})
	// Entry 2 resumes entry 1 (written while 1 was still on disk: queued).
	j, _ := OpenTurnJournal(TurnJournalPath(dataDir, "test"))
	if _, err := j.Update(ids[2], func(x *TurnJournalEntry) { x.ResumedFrom = ids[1] }); err != nil {
		t.Fatal(err)
	}
	e := newResumeEngine(t, dataDir)
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.ResumeInterruptedTurns()
	waitFor(t, "resume", func() bool { n, _ := rec.counts(); return n == 1 })
	time.Sleep(100 * time.Millisecond)
	if n, _ := rec.counts(); n != 1 {
		t.Fatalf("resumes = %d, want 1", n)
	}
	if rec.entries[0].TurnID != ids[2] || rec.delivered[0].resume.resumedFrom != ids[2] {
		t.Fatalf("resumed %s, want the newest %s", rec.entries[0].TurnID, ids[2])
	}
	if !strings.Contains(rec.delivered[0].Prompt, "最早那条") {
		t.Fatalf("older message not folded in:\n%s", rec.delivered[0].Prompt)
	}
	left := e.turnJournalStore().List()
	if len(left) != 1 || left[0].TurnID != ids[2] {
		t.Fatalf("journal after resume: %+v", left)
	}
}

// ③ #17: cloud_web ready first must not deliver discord's resume.
func TestTurnResume_WaitsForOwnPlatform(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	seedJournal(t, dataDir, []TurnJournalEntry{userEntry("discord:c1", "活")}, nil)
	web := &stubLifecyclePlatform{stubPlatformEngine: stubPlatformEngine{n: "cloud_web"}}
	dc := &stubLifecyclePlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := newResumeEngine(t, dataDir, web, dc)
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.OnPlatformReady(web)
	time.Sleep(600 * time.Millisecond)
	if n, _ := rec.counts(); n != 0 {
		t.Fatalf("delivered %d before discord was ready", n)
	}
	e.OnPlatformReady(dc)
	waitFor(t, "resume after discord ready", func() bool { n, _ := rec.counts(); return n == 1 })
}

// ④ #18: only replies in [interrupted, this process start) dedupe; a reply
// after this start does not stop the resume.
func TestTurnResume_DedupWindow(t *testing.T) {
	shortenTurnResume(t)
	for _, tc := range []struct {
		name    string
		replyAt time.Time
		want    int
	}{
		{"reply during downtime drops", StartTime.Add(-time.Second), 0},
		{"reply after start still resumes", StartTime.Add(time.Second), 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := t.TempDir()
			seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "活")}, func(_ int, x *TurnJournalEntry) {
				x.StartedAt = StartTime.Add(-time.Minute)
				x.InterruptedAt = StartTime.Add(-30 * time.Second)
			})
			e := newResumeEngine(t, dataDir)
			s := e.sessions.GetOrCreateActive("test:c1")
			s.mu.Lock()
			s.History = append(s.History, HistoryEntry{Role: "assistant", Content: "答了", Timestamp: tc.replyAt})
			s.mu.Unlock()
			rec := &resumeRecorder{}
			e.turnResumeHooks = rec.hooks()
			e.ResumeInterruptedTurns()
			time.Sleep(200 * time.Millisecond)
			if n, _ := rec.counts(); n != tc.want {
				t.Fatalf("resumes = %d, want %d", n, tc.want)
			}
			if tc.want == 0 && len(e.turnJournalStore().List()) != 0 {
				t.Fatal("deduped entry left on disk")
			}
		})
	}
}

// ⑤ #19: no progress and too old stop with their own sentence.
func TestTurnResume_StopSentences(t *testing.T) {
	shortenTurnResume(t)
	for _, tc := range []struct {
		name string
		fix  func(x *TurnJournalEntry)
		want string
	}{
		{"no progress", func(x *TurnJournalEntry) { x.NoProgressCount = turnResumeMaxNoProgress }, turnResumeStopNoProgress},
		{"too old", func(x *TurnJournalEntry) { x.StartedAt = time.Now().Add(-3 * time.Hour) }, turnResumeStopTooOld},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := t.TempDir()
			seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "活")}, func(_ int, x *TurnJournalEntry) { tc.fix(x) })
			e := newResumeEngine(t, dataDir)
			rec := &resumeRecorder{}
			e.turnResumeHooks = rec.hooks()
			e.ResumeInterruptedTurns()
			waitFor(t, "stop notice", func() bool { _, n := rec.counts(); return n == 1 })
			if d, _ := rec.counts(); d != 0 || rec.noticeText() != tc.want {
				t.Fatalf("delivered=%d notice=%q, want 0 and %q", d, rec.noticeText(), tc.want)
			}
			if left := e.turnJournalStore().List(); len(left) != 1 || !left[0].Abandoned {
				t.Fatalf("entry not marked abandoned: %+v", left)
			}
		})
	}
}

// ⑥: the turn ran on a side session whose id differs from the chat's main
// session: do not resume the main one; resend the original instead.
func TestTurnResume_SideSessionFallsBackToOriginal(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "原话全文在这里")}, func(_ int, x *TurnJournalEntry) {
		x.AgentSessionID = "side-sid"
	})
	e := newResumeEngine(t, dataDir)
	e.sessions.GetOrCreateActive("test:c1").SetAgentSessionID("main-sid", "claudecode")
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.ResumeInterruptedTurns()
	waitFor(t, "resume", func() bool { n, _ := rec.counts(); return n == 1 })
	job := rec.delivered[0]
	if !strings.Contains(job.Prompt, "原消息全文") || !strings.Contains(job.Prompt, "原话全文在这里") || job.resume.fallback != "" {
		t.Fatalf("prompt should carry the original, no S1 fallback:\n%s\nfallback=%q", job.Prompt, job.resume.fallback)
	}
	if id := e.sessions.GetOrCreateActive("test:c1").GetAgentSessionID(); id != "main-sid" {
		t.Fatalf("main session id changed to %q", id)
	}
}

// ---- real delivery (ExecuteTimerJob) ----

// resumeAgent answers from a script shared by all its sessions: "err" → an
// error result (the dangling tool_use 400), "hold" → never answers, else a result.
type resumeAgent struct {
	mu     sync.Mutex
	script []string
	sent   []string
	sentBy []string
	starts []string
}

func (a *resumeAgent) Name() string { return "claudecode" }
func (a *resumeAgent) StartSession(_ context.Context, resume string) (AgentSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.starts = append(a.starts, resume)
	id := resume
	if id == "" {
		id = fmt.Sprintf("s%d", len(a.starts))
	}
	return &resumeAgentSession{a: a, id: id, events: make(chan Event, 8)}, nil
}
func (a *resumeAgent) ListSessions(_ context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *resumeAgent) Stop() error                                                { return nil }
func (a *resumeAgent) snapshot() ([]string, []string, []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.sent...), append([]string(nil), a.sentBy...), append([]string(nil), a.starts...)
}

type resumeAgentSession struct {
	a      *resumeAgent
	id     string
	events chan Event
}

func (s *resumeAgentSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	a := s.a
	a.mu.Lock()
	a.sent = append(a.sent, prompt)
	a.sentBy = append(a.sentBy, s.id)
	next := "ok"
	if len(a.script) > 0 {
		next, a.script = a.script[0], a.script[1:]
	}
	a.mu.Unlock()
	switch next {
	case "hold":
	case "text": // talks, then never ends (no tool step)
		s.events <- Event{Type: EventText, Content: "先核对一下产物", SessionID: s.id}
	case "err":
		s.events <- Event{Type: EventResult, Content: "API Error: 400 tool_use ids were found without tool_result blocks", Done: true,
			SessionID: s.id, Metadata: map[string]any{MetaResultIsError: true}}
	default:
		s.events <- Event{Type: EventResult, Content: "reply:" + next, Done: true, SessionID: s.id}
	}
	return nil
}
func (s *resumeAgentSession) RespondPermission(_ string, _ PermissionResult) error { return nil }
func (s *resumeAgentSession) Events() <-chan Event                                 { return s.events }
func (s *resumeAgentSession) CurrentSessionID() string                             { return s.id }
func (s *resumeAgentSession) Alive() bool                                          { return true }
func (s *resumeAgentSession) Close() error                                         { return nil }

// ① S1: the resumed session's first result is an error: re-run once on a fresh
// session with the original message in full.
func TestTurnResume_FirstResultErrorFallsBackToFresh(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "把报告写完")}, func(_ int, x *TurnJournalEntry) {
		x.AgentSessionID = "old-sid"
		x.LastStep = "Bash: go test"
	})
	p := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}
	a := &resumeAgent{script: []string{"err", "done"}}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	e.SetDataDir(dataDir)
	strayScanned.Store(dataDir, struct{}{})
	t.Cleanup(func() { e.Stop() })
	e.sessions.GetOrCreateActive("test:c1").SetAgentSessionID("old-sid", "claudecode")

	e.ResumeInterruptedTurns()
	waitFor(t, "fresh re-run reply", func() bool { return strings.Contains(joined(&p.stubPlatformEngine), "reply:done") })

	sent, by, starts := a.snapshot()
	if len(sent) != 2 || by[0] != "old-sid" || by[1] == "old-sid" {
		t.Fatalf("sends %q on %q (starts %q): want resume on old-sid, then one fresh re-run", sent, by, starts)
	}
	if strings.Contains(sent[0], "原消息全文") || !strings.Contains(sent[0], "Bash: go test") {
		t.Fatalf("resume prompt:\n%s", sent[0])
	}
	if !strings.Contains(sent[1], "原消息全文") || !strings.Contains(sent[1], "把报告写完") {
		t.Fatalf("fresh re-run lacks the original message:\n%s", sent[1])
	}
	if out := joined(&p.stubPlatformEngine); strings.Count(out, "♻️") != 1 || strings.Contains(out, "tool_use ids") {
		t.Fatalf("channel:\n%s", out)
	}
}

// ② #16: a resumed turn that makes no progress and is killed again, twice:
// the third start stops and says so.
func TestTurnResume_KilledTwiceWithoutProgressStops(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "长活")}, nil)

	for round := 1; round <= 2; round++ {
		p := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}
		a := &resumeAgent{script: []string{"hold"}}
		e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
		e.SetDataDir(dataDir)
		strayScanned.Store(dataDir, struct{}{})
		go e.ResumeInterruptedTurns()
		waitFor(t, fmt.Sprintf("round %d resumed", round), func() bool { s, _, _ := a.snapshot(); return len(s) == 1 })
		// The resumed turn is now on disk; the bridge is "killed" (abandoned, no Stop).
		j, _ := OpenTurnJournal(TurnJournalPath(dataDir, "test"))
		waitFor(t, "resumed entry written", func() bool {
			j, _ = OpenTurnJournal(TurnJournalPath(dataDir, "test"))
			l := j.List()
			return len(l) == 1 && l[0].NoProgressCount == round && l[0].ResumedFrom != ""
		})
	}
	p := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}
	a := &resumeAgent{}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	e.SetDataDir(dataDir)
	strayScanned.Store(dataDir, struct{}{})
	t.Cleanup(func() { e.Stop() })
	e.ResumeInterruptedTurns()
	waitFor(t, "stop sentence", func() bool { return strings.Contains(joined(&p.stubPlatformEngine), turnResumeStopNoProgress) })
	if sent, _, _ := a.snapshot(); len(sent) != 0 {
		t.Fatalf("third start resumed again: %q", sent)
	}
}

// Pure plan checks: leave bg/relay, drop heartbeat and timer jobs the timer re-runs.
func TestTurnResume_PlanSkips(t *testing.T) {
	now := time.Now()
	entries := []TurnJournalEntry{
		{TurnID: "bg", Kind: TurnKindBG, InteractiveKey: "a", StartedAt: now},
		{TurnID: "relay", Trigger: "relay_task", InteractiveKey: "b", StartedAt: now},
		{TurnID: "hb", Trigger: TurnTriggerHeartbeat, InteractiveKey: "c", StartedAt: now},
		{TurnID: "timer", Trigger: TurnTriggerTimer, TimerJobID: "j1", InteractiveKey: "d", StartedAt: now},
		{TurnID: "user", Trigger: TurnTriggerUser, InteractiveKey: "e", StartedAt: now},
	}
	plans := planTurnResumes(entries, turnResumeEnv{now: now, startTime: now,
		timerWillRerun: func(id string) bool { return id == "j1" }})
	got := map[string]turnResumeAction{}
	for _, p := range plans {
		got[p.entry.TurnID] = p.action
	}
	want := map[string]turnResumeAction{"bg": turnResumeLeave, "relay": turnResumeLeave, "hb": turnResumeDrop, "timer": turnResumeDrop, "user": turnResumeDeliver}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s: action %d, want %d (all %v)", k, got[k], v, got)
		}
	}
}

// ---- review must-fix tests ----

// Must-fix 1: an armed resume does not take the S1 fresh re-run while stopping,
// after /stop, or for capacity / prompt-too-long errors.
func TestTurnResume_FirstErrorExclusions(t *testing.T) {
	e := newResumeEngine(t, t.TempDir())
	isErr := map[string]any{MetaResultIsError: true}
	arm := func() *interactiveState { return &interactiveState{resumeArmed: true} }

	if st := arm(); !e.takeResumeFirstResultError(st, nil, Event{Content: "API Error: 400", Metadata: isErr}, nil) {
		t.Fatal("plain first error should take S1")
	}
	if st := arm(); !e.takeResumeFirstError(st, "API Error: 400", nil) {
		t.Fatal("plain first EventError should take S1")
	}
	for _, msg := range []string{"Selected model is at capacity. Please try a different model.", "prompt is too long: 1227574 tokens > 1048576 maximum"} {
		if st := arm(); e.takeResumeFirstResultError(st, nil, Event{Content: msg, Metadata: isErr}, nil) || st.resumeFailed != "" {
			t.Fatalf("result %q took S1", msg)
		}
		if st := arm(); e.takeResumeFirstError(st, msg, nil) || st.resumeFailed != "" {
			t.Fatalf("error %q took S1", msg)
		}
	}
	st := arm()
	st.turnCancelled = true
	if e.takeResumeFirstResultError(st, nil, Event{Content: "API Error: aborted", Metadata: isErr}, nil) {
		t.Fatal("/stop result took S1")
	}
	st = arm()
	st.turnCancelled = true
	if e.takeResumeFirstError(st, "aborted", nil) {
		t.Fatal("/stop error took S1")
	}

	e.platformLifecycleMu.Lock()
	e.stopping = true
	e.platformLifecycleMu.Unlock()
	if st := arm(); e.takeResumeFirstResultError(st, nil, Event{Content: "API Error: 400", Metadata: isErr}, nil) {
		t.Fatal("stopping result took S1")
	}
	if st := arm(); e.takeResumeFirstError(st, "API Error: 400", nil) {
		t.Fatal("stopping error took S1")
	}
	// retryFreshOnResumeError's own guard: stopping keeps the session id.
	sess := e.sessions.GetOrCreateActive("test:c1")
	sess.SetAgentSessionID("keep-sid", "claudecode")
	msg := Message{resumeFallback: "fallback"}
	if e.retryFreshOnResumeError(nil, msg, "API Error: 400", arm(), sess, e.sessions, e.agent, "test:c1", "", "test:c1") {
		t.Fatal("re-ran while stopping")
	}
	if id := sess.GetAgentSessionID(); id != "keep-sid" {
		t.Fatalf("session id cleared while stopping: %q", id)
	}
}

// Must-fix 2: a resumed turn that only talks (no tool step) and is killed
// twice still stops on the third start.
func TestTurnResume_TextOnlyKilledTwiceStops(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	// No agent session id: round 1 is not armed for S1 (the path the review flagged).
	prev := seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "长活")}, func(_ int, x *TurnJournalEntry) { x.AgentSessionID = "" })[0]
	for round := 1; round <= 2; round++ {
		p := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}
		a := &resumeAgent{script: []string{"text"}}
		e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
		e.SetDataDir(dataDir)
		strayScanned.Store(dataDir, struct{}{})
		go e.ResumeInterruptedTurns()
		waitFor(t, fmt.Sprintf("round %d text written", round), func() bool {
			j, _ := OpenTurnJournal(TurnJournalPath(dataDir, "test"))
			l := j.List()
			return len(l) == 1 && l[0].ResumedFrom == prev && strings.Contains(l[0].LastText, "先核对")
		})
		j, _ := OpenTurnJournal(TurnJournalPath(dataDir, "test"))
		l := j.List()
		prev = l[0].TurnID
		if l[0].NoProgressCount != round {
			t.Fatalf("round %d: no-progress count %d after text, want %d (text must not clear it)", round, l[0].NoProgressCount, round)
		}
	}
	p := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}}
	a := &resumeAgent{}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	e.SetDataDir(dataDir)
	strayScanned.Store(dataDir, struct{}{})
	t.Cleanup(func() { e.Stop() })
	e.ResumeInterruptedTurns()
	waitFor(t, "stop sentence", func() bool { return strings.Contains(joined(&p.stubPlatformEngine), turnResumeStopNoProgress) })
	if sent, _, _ := a.snapshot(); len(sent) != 0 {
		t.Fatalf("third start resumed again: %q", sent)
	}
}

// Must-fix 3: platform not ready / queue full are retried in this process; a
// failed delivery leaves ResumedAt unset.
func TestTurnResume_RetriesPlatformAndQueueFull(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	ids := seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "活")}, nil)
	e := newResumeEngine(t, dataDir)
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.turnResumeHooks.retryDelay, e.turnResumeHooks.retryFor = 20*time.Millisecond, time.Minute
	var mu sync.Mutex
	readyFails, deliverFails := 2, 1
	e.turnResumeHooks.ready = func(TurnJournalEntry) error {
		mu.Lock()
		defer mu.Unlock()
		if readyFails > 0 {
			readyFails--
			return errTimerPlatformNotReady
		}
		return nil
	}
	okDeliver := e.turnResumeHooks.deliver
	e.turnResumeHooks.deliver = func(en TurnJournalEntry, job *TimerJob) error {
		mu.Lock()
		fail := deliverFails > 0
		if fail {
			deliverFails--
		}
		mu.Unlock()
		if fail {
			return errors.New(`session "test:c1" is busy and its queue is full`)
		}
		return okDeliver(en, job)
	}
	e.ResumeInterruptedTurns()
	waitFor(t, "delivered after retries", func() bool { n, _ := rec.counts(); return n == 1 })
	en, ok := e.turnJournalStore().Get(ids[0])
	if !ok || en.ResumedAt.IsZero() {
		t.Fatalf("ResumedAt not set after the delivery: %+v", en)
	}
	if _, n := rec.counts(); n != 0 {
		t.Fatalf("notices %q; want none when it got through", rec.noticeText())
	}
}

// Must-fix 3: never delivered: ResumedAt rolled back and the channel is told why.
func TestTurnResume_NotResumedTellsChannel(t *testing.T) {
	shortenTurnResume(t)
	dataDir := t.TempDir()
	ids := seedJournal(t, dataDir, []TurnJournalEntry{userEntry("test:c1", "活")}, nil)
	e := newResumeEngine(t, dataDir)
	rec := &resumeRecorder{}
	e.turnResumeHooks = rec.hooks()
	e.turnResumeHooks.retryDelay, e.turnResumeHooks.retryFor = 20*time.Millisecond, 150*time.Millisecond
	var tries int
	var mu sync.Mutex
	e.turnResumeHooks.deliver = func(TurnJournalEntry, *TimerJob) error {
		mu.Lock()
		tries++
		mu.Unlock()
		return errors.New("busy and its queue is full")
	}
	e.ResumeInterruptedTurns()
	waitFor(t, "not-resumed notice", func() bool { _, n := rec.counts(); return n == 1 })
	if txt := rec.noticeText(); !strings.Contains(txt, "没能自动续上") || !strings.Contains(txt, "queue is full") {
		t.Fatalf("notice %q", txt)
	}
	mu.Lock()
	n := tries
	mu.Unlock()
	if n < 2 {
		t.Fatalf("delivery tried %d times, want retries", n)
	}
	en, _ := e.turnJournalStore().Get(ids[0])
	if !en.ResumedAt.IsZero() {
		t.Fatal("ResumedAt kept after failed deliveries (would count as no progress next start)")
	}

	// Platform never ready: same notice.
	dataDir2 := t.TempDir()
	seedJournal(t, dataDir2, []TurnJournalEntry{userEntry("test:c1", "活")}, nil)
	e2 := newResumeEngine(t, dataDir2)
	rec2 := &resumeRecorder{}
	e2.turnResumeHooks = rec2.hooks()
	e2.turnResumeHooks.retryDelay, e2.turnResumeHooks.retryFor = 20*time.Millisecond, 150*time.Millisecond
	e2.turnResumeHooks.ready = func(TurnJournalEntry) error { return errTimerPlatformNotReady }
	e2.ResumeInterruptedTurns()
	waitFor(t, "platform notice", func() bool { _, n := rec2.counts(); return n == 1 })
	if d, _ := rec2.counts(); d != 0 || !strings.Contains(rec2.noticeText(), "平台未就绪") {
		t.Fatalf("delivered=%d notice=%q", d, rec2.noticeText())
	}
}

// Extra must-fix: the start-up scan never reaps a codex exec without the
// bridge's mark (gpt/dsx start the same command line).
func TestTurnResume_StrayScanLeavesCodex_RealProcess(t *testing.T) {
	shortTermWait(t)
	dataDir := t.TempDir()
	pid := startFakeBridge(t, dataDir, "codex exec --skip-git-repo-check --json -", true)
	oldStart := StartTime
	time.Sleep(1100 * time.Millisecond)
	StartTime = time.Now()
	t.Cleanup(func() { StartTime = oldStart; strayScanned.Delete(dataDir) })
	e := NewEngine("test", &stubAgent{}, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	e.SetDataDir(dataDir)
	t.Cleanup(func() { e.Stop() })
	e.ResumeInterruptedTurns()
	if !groupAlive(pid) {
		t.Fatal("start-up scan reaped an unmarked codex exec")
	}
}
