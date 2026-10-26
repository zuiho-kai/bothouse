package core

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// rawDestinationPlatform models Discord's TaskCardDestination: it returns the
// platform channel ID, not a session key. Facts must therefore use the card's
// session key (Task.CardSession), never its channel ID.
type rawDestinationPlatform struct{ *progressTestPlatform }

func (p *rawDestinationPlatform) TaskCardDestination(session string) (string, error) {
	_, chat, err := parseSessionKeyParts(session)
	if err != nil {
		return "", err
	}
	return chat, nil
}

// A task workspace is an execution location, not a new task identity: it must
// belong to the source chat and have room for the work.
func TestResolveTaskWorkspaceChecksOwnershipAndOccupancy(t *testing.T) {
	e := NewEngine("source", &stubAgent{}, []Platform{newProgressPlatform()}, "", LangChinese)
	e.SetDataDir(t.TempDir())
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	got, err := e.resolveTaskWorkspace("discord:room:user", "ws1")
	if err != nil || got != "discord:ws1" {
		t.Fatalf("own workspace = %q, %v", got, err)
	}
	if _, err := e.resolveTaskWorkspace("discord:room:user", "ws9"); err == nil || !strings.Contains(err.Error(), "not a recorded workspace") {
		t.Fatalf("unrecorded workspace = %v", err)
	}
	if _, err := e.resolveTaskWorkspace("discord:room:user", "feishu:ws1"); err == nil {
		t.Fatal("cross-platform workspace accepted")
	}
	if err := e.ClaimTeamWorkspace("discord:other", "ws2", "工作区2"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.resolveTaskWorkspace("discord:room:user", "ws2"); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("cross-channel workspace = %v", err)
	}

	busy := NewEngine("source", &stubAgent{}, []Platform{newProgressPlatform()}, "", LangChinese)
	busy.SetDataDir(t.TempDir())
	claimSourceWorkspace(t, busy)
	for i := 0; i < teamWorkspaceBusy; i++ {
		if err := busy.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := busy.resolveTaskWorkspace("discord:room:user", "ws1"); err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("full workspace = %v", err)
	}
}

// A chat channel that owns workspaces is a valid task source: the task keeps
// the chat's run and session, while the card opens in the execution workspace.
func TestResolveTaskWorkspaceAcceptsOwningChatSource(t *testing.T) {
	e := NewEngine("source", &stubAgent{}, []Platform{newProgressPlatform()}, "", LangChinese)
	e.SetDataDir(t.TempDir())
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:other", "ws2", "工作区2"); err != nil {
		t.Fatal(err)
	}
	got, err := e.resolveTaskWorkspace("discord:lobby:user", "ws1")
	if err != nil || got != "discord:ws1" {
		t.Fatalf("chat-source sibling workspace = %q, %v", got, err)
	}
	if _, err := e.resolveTaskWorkspace("discord:lobby:user", "ws2"); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("chat-source foreign workspace = %v", err)
	}
	if _, err := e.resolveTaskWorkspace("discord:lobby:user", "ws9"); err == nil || !strings.Contains(err.Error(), "not a recorded workspace") {
		t.Fatalf("chat-source unrecorded workspace = %v", err)
	}
	if _, err := e.resolveTaskWorkspace("discord:chat-without-workspaces:user", "ws1"); err == nil {
		t.Fatal("workspace accepted for a chat channel with no workspaces")
	}
}

func taskWorkspaceAssignment(id, run, member, workspace string) TaskMemberAssignment {
	return TaskMemberAssignment{
		ReporterProject: "target",
		Project:         "source",
		SessionKey:      "discord:room:user",
		Run:             run,
		TaskID:          id,
		MemberID:        member,
		Name:            "Target",
		Title:           "workspace member",
		Ref:             "无（新建）",
		Workspace:       workspace,
	}
}

// The member credential is scoped to the workspace, while its row and result
// stay on the source card.
func TestAssignMemberWorkspaceScopesCredentialToWorkspace(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.resolveWorkspace = e.resolveTaskWorkspace
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		if project == "target" && platformName == "discord" && (session == "discord:ws1" || session == "discord:room:user") {
			return platform, nil
		}
		return nil, errors.New("unbound test reporter")
	}

	req := taskWorkspaceAssignment(id, run, "m1", "ws1")
	grant, err := p.AssignMember(req)
	if err != nil {
		t.Fatal(err)
	}
	if grant.ReportCommand != "" || !strings.Contains(grant.ReportVia, "task relay") {
		t.Fatalf("non-native member credential leaked to the creator: %+v", grant)
	}
	p.mu.Lock()
	var command string
	for _, g := range p.memberRuns {
		if g.id == "m1" {
			command = p.memberReportCommand(g)
		}
	}
	p.mu.Unlock()
	if !strings.Contains(command, "--session 'discord:ws1'") {
		t.Fatalf("report command not scoped to workspace: %s", command)
	}
	task, ok := p.Task(id)
	if !ok || len(task.Members) != 1 || task.Members[0].Workspace != "discord:ws1" {
		t.Fatalf("member row = %+v", task)
	}
	token := progressToken(t, command)
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: token, Seq: 1, Kind: "update", Summary: "wrong chat"}); err == nil {
		t.Fatal("report from the source chat accepted for a workspace member")
	}
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:ws1", Run: token, Seq: 1, Kind: "update", Summary: "working in workspace"}); err != nil {
		t.Fatalf("workspace report: %v", err)
	}
	retry, err := p.AssignMember(req)
	if err != nil || retry.ReportCommand != grant.ReportCommand || retry.ReportVia != grant.ReportVia {
		t.Fatalf("idempotent retry = %+v, %v", retry, err)
	}
	task, _ = p.Task(id)
	if len(task.Members) != 1 {
		t.Fatalf("retry added a member row: %+v", task.Members)
	}

	// The workspace survives a fresh process reading the same data dir.
	restored, err := NewPublicProgress(p.dataDir, "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	reloaded, ok := restored.Task(id)
	if !ok || len(reloaded.Members) != 1 || reloaded.Members[0].Workspace != "discord:ws1" {
		t.Fatalf("restored member = %+v", reloaded)
	}
	if _, err := restored.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:ws1", Run: token, Seq: 2, Kind: "update", Summary: "after restart"}); err == nil {
		t.Fatal("restart kept the member credential alive")
	}
}

// A workspace of another chat, or one this chat never claimed, is not a valid
// execution target.
func TestAssignMemberWorkspaceRejectsForeignAndUnrecorded(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:other", "ws2", "工作区2"); err != nil {
		t.Fatal(err)
	}
	p.resolveWorkspace = e.resolveTaskWorkspace
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		return platform, nil
	}
	for _, tc := range []struct{ workspace, want string }{
		{"ws2", "another chat channel"},
		{"ws9", "not a recorded workspace"},
	} {
		req := taskWorkspaceAssignment(id, run, "m-"+tc.workspace, tc.workspace)
		if _, err := p.AssignMember(req); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("workspace %s = %v, want %q", tc.workspace, err, tc.want)
		}
	}
	task, _ := p.Task(id)
	if len(task.Members) != 0 {
		t.Fatalf("rejected assignment created rows: %+v", task.Members)
	}
}

// The target runs in the workspace session, while the receipt and final
// result stay on the source task; retries and conflicting targets are
// resolved from that receipt.
func TestTaskRelayWorkspaceExecutesThereAndReturnsResult(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws2", "工作区2"); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	p.resolveWorkspace = source.resolveTaskWorkspace
	rm.Bind("discord", "ws1", map[string]string{"source": "Source", "target": "Target"})
	rm.Bind("discord", "ws2", map[string]string{"source": "Source", "target": "Target"})
	session.events <- Event{Type: EventResult, Content: "workspace result"}

	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	result, err := rm.Send(context.Background(), req)
	if err != nil || result.Response != "workspace result" {
		t.Fatalf("relay = %+v, %v", result, err)
	}
	scope := id + ":" + fmt.Sprintf("%x", sha256.Sum256([]byte(req.RequestID)))
	wsKey := relayConversationKey("source", "discord", "ws1") + ":task:" + scope
	target := rm.engines["target"]
	if target.sessions.ActiveSessionID(wsKey) == "" {
		t.Fatal("target did not run in the workspace session")
	}
	if target.sessions.ActiveSessionID(relayConversationKey("source", "discord", "room")+":task:"+scope) != "" {
		t.Fatal("target also ran in the source chat session")
	}
	task, _ := p.Task(id)
	found := false
	for _, ev := range task.Events {
		if strings.Contains(ev.Detail, "workspace result") {
			found = true
		}
	}
	if !found {
		t.Fatalf("result not returned to the source task: %+v", task.Events)
	}
	rec := readProgressRecord(t, p.dir, id)
	if rec.Relays[req.RequestID].Workspace != "discord:ws1" {
		t.Fatalf("receipt workspace = %q", rec.Relays[req.RequestID].Workspace)
	}

	if cached, err := rm.Send(context.Background(), req); err != nil || cached.Response != result.Response {
		t.Fatalf("retry = %+v, %v", cached, err)
	}
	conflict := req
	conflict.Workspace = "ws2"
	if _, err := rm.Send(context.Background(), conflict); err == nil || !strings.Contains(err.Error(), "already dispatched to workspace") {
		t.Fatalf("conflicting target = %v", err)
	}
	if starts.Load() != 1 {
		t.Fatalf("retry or conflict reran target: %d starts", starts.Load())
	}

	// A restart reloads the receipt and returns the durable result without running again.
	restored, err := NewPublicProgress(p.dataDir, "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restored.resolveWorkspace = source.resolveTaskWorkspace
	rm.engines["source"].publicProgress = restored
	if cached, err := rm.Send(context.Background(), req); err != nil || cached.Response != result.Response {
		t.Fatalf("restart replay = %+v, %v", cached, err)
	}
	if starts.Load() != 1 {
		t.Fatalf("restart replay reran target: %d starts", starts.Load())
	}
}

// A cross-workspace relay runs the target in B, so its agent process must see
// B's session identity; inheriting A's CC_SESSION_KEY would make tools in the
// workspace default to the wrong channel.
func TestTaskRelayWorkspaceInjectsExecutionSessionEnv(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	agent := &controllableAgent{}
	rm, session := taskRelayManagerWithAgent(t, p, platform, nil, &starts, agent)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	p.resolveWorkspace = source.resolveTaskWorkspace
	rm.Bind("discord", "ws1", map[string]string{"source": "Source", "target": "Target"})
	session.events <- Event{Type: EventResult, Content: "env result"}

	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	if result, err := rm.Send(context.Background(), req); err != nil || result.Response != "env result" {
		t.Fatalf("workspace relay = %+v, %v", result, err)
	}
	if got := envValue(agent.sessionEnv, "CC_SESSION_KEY"); got != "discord:ws1" {
		t.Fatalf("CC_SESSION_KEY = %q, want execution workspace", got)
	}
	if got := envValue(agent.sessionEnv, "CC_PROJECT"); got != "target" {
		t.Fatalf("CC_PROJECT = %q, want target", got)
	}
	for _, kv := range agent.sessionEnv {
		if strings.Contains(kv, "discord:room") {
			t.Fatalf("agent env leaked the source workspace: %q", kv)
		}
	}
}

// A target that is not bound in the workspace cannot receive its assignment.
func TestTaskRelayWorkspaceRequiresTargetBinding(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	rm, _ := taskRelayManager(t, p, platform, nil, &starts)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	p.resolveWorkspace = source.resolveTaskWorkspace
	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	if _, err := rm.Send(context.Background(), req); err == nil || !strings.Contains(err.Error(), "没绑定") {
		t.Fatalf("unbound workspace target = %v", err)
	}
	if starts.Load() != 0 {
		t.Fatal("unbound target started")
	}
	if _, ok := p.records[id].record.Relays[req.RequestID]; ok {
		t.Fatal("failed binding check left a receipt")
	}
}

// The 409 guard that keeps task assignment authorized by the source chat's
// run is not removed: pointing the assignment session at the workspace still
// fails, while the same run with an explicit workspace succeeds.
func TestAssignMemberWorkspaceKeepsSourceRunSessionCheck(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.resolveWorkspace = e.resolveTaskWorkspace
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		return platform, nil
	}
	req := taskWorkspaceAssignment(id, run, "m1", "ws1")
	req.SessionKey = "discord:ws1"
	if _, err := p.AssignMember(req); err == nil || !strings.Contains(err.Error(), "not active for this run and session") {
		t.Fatalf("workspace session assignment = %v", err)
	}
	task, _ := p.Task(id)
	if len(task.Members) != 0 {
		t.Fatalf("wrong-session assignment created rows: %+v", task.Members)
	}
	req.SessionKey = "discord:room:user"
	if _, err := p.AssignMember(req); err != nil {
		t.Fatalf("source-run assignment with workspace: %v", err)
	}
}

// A member whose bot is not bound in the execution workspace is rejected
// before a row is recorded.
func TestAssignMemberWorkspaceRequiresBoundTarget(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	p.resolveWorkspace = e.resolveTaskWorkspace
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		return nil, errors.New("unbound test reporter")
	}
	if _, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m1", "ws1")); err == nil || !strings.Contains(err.Error(), "unbound test reporter") {
		t.Fatalf("unbound workspace target = %v", err)
	}
	task, _ := p.Task(id)
	if len(task.Members) != 0 {
		t.Fatalf("rejected assignment created rows: %+v", task.Members)
	}
}

// A task relay must reject a workspace that another chat owns, that was never
// recorded, or that belongs to another platform, without running the target.
func TestTaskRelayWorkspaceRejectsForeignAndUnrecorded(t *testing.T) {
	for _, tc := range []struct{ name, workspace, want string }{
		{"foreign", "ws2", "another chat channel"},
		{"unrecorded", "ws9", "not a recorded workspace"},
		{"other-platform", "feishu:ws2", "not on platform discord"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, platform, _, id := taskRelayFixture(t)
			e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
			e.SetDataDir(p.dataDir)
			claimSourceWorkspace(t, e)
			if err := e.ClaimTeamWorkspace("discord:other", "ws2", "工作区2"); err != nil {
				t.Fatal(err)
			}
			var starts atomic.Int32
			rm, _ := taskRelayManager(t, p, platform, nil, &starts)
			source := rm.engines["source"]
			source.dataDir = p.dataDir
			p.resolveWorkspace = source.resolveTaskWorkspace
			req := taskRelayRequest(id)
			req.Workspace = tc.workspace
			if _, err := rm.Send(context.Background(), req); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("workspace %s = %v, want %q", tc.workspace, err, tc.want)
			}
			if starts.Load() != 0 {
				t.Fatal("rejected workspace started the target")
			}
			if _, ok := p.records[id].record.Relays[req.RequestID]; ok {
				t.Fatal("rejected workspace left a receipt")
			}
		})
	}
}

// A retry is resolved from its durable receipt even after the workspace goes
// back to the pool and another chat claims it; a new dispatch cannot take the
// moved workspace.
func TestTaskRelayWorkspaceRetrySurvivesHandoffChange(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	p.resolveWorkspace = source.resolveTaskWorkspace
	rm.Bind("discord", "ws1", map[string]string{"source": "Source", "target": "Target"})
	session.events <- Event{Type: EventResult, Content: "handoff result"}

	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	result, err := rm.Send(context.Background(), req)
	if err != nil || result.Response != "handoff result" {
		t.Fatalf("relay = %+v, %v", result, err)
	}
	if !e.releaseTeamWorkspace("discord:ws1", time.Now().Add(time.Hour), false) {
		t.Fatal("workspace was not released")
	}
	if err := e.ClaimTeamWorkspace("discord:other", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if cached, err := rm.Send(context.Background(), req); err != nil || cached.Response != result.Response {
		t.Fatalf("retry after handoff = %+v, %v", cached, err)
	}
	next := req
	next.RequestID = "dispatch-two"
	if _, err := rm.Send(context.Background(), next); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("new dispatch to moved workspace = %v", err)
	}
	conflict := req
	conflict.Workspace = "ws2"
	if _, err := rm.Send(context.Background(), conflict); err == nil || !strings.Contains(err.Error(), "already dispatched to workspace") {
		t.Fatalf("conflicting target after handoff = %v", err)
	}
	if starts.Load() != 1 {
		t.Fatalf("retry or moved dispatch reran target: %d starts", starts.Load())
	}
}

// The member credential is delivered in the workspace relay prompt, accepted
// only from the workspace, and the final result still lands on the source
// task card.
func TestTaskRelayWorkspaceMemberCredentialAndResult(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	memberTokenCh := make(chan string, 1)
	rm, session := taskRelayManager(t, p, platform, func(prompt string) {
		var token string
		for _, line := range strings.Split(prompt, "\n") {
			if !strings.Contains(line, "member m1") {
				continue
			}
			fields := strings.Fields(line)
			for i, f := range fields {
				if f == "--run" && i+1 < len(fields) {
					token = fields[i+1]
				}
			}
		}
		if token == "" {
			t.Errorf("member credential missing from relay prompt")
			return
		}
		memberTokenCh <- token
		if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:room:user", Run: token, Seq: 1, Kind: "result", Summary: "wrong chat"}); err == nil {
			t.Error("member report from the source chat accepted")
		}
		if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: "discord:ws1", Run: token, Seq: 1, Kind: "result", Summary: "member finished in workspace"}); err != nil {
			t.Errorf("workspace member report: %v", err)
		}
	}, &starts)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	p.resolveWorkspace = source.resolveTaskWorkspace
	rm.Bind("discord", "ws1", map[string]string{"source": "Source", "target": "Target"})
	grant, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m1", "ws1"))
	if err != nil {
		t.Fatal(err)
	}
	if grant.ReportCommand != "" {
		t.Fatalf("workspace member credential leaked to the creator: %+v", grant)
	}
	session.events <- Event{Type: EventResult, Content: "workspace final result"}
	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	result, err := rm.Send(context.Background(), req)
	if err != nil || result.Response != "workspace final result" {
		t.Fatalf("relay = %+v, %v", result, err)
	}
	var token string
	select {
	case token = <-memberTokenCh:
	default:
		t.Fatal("member credential not delivered in the relay prompt")
	}
	task, _ := p.Task(id)
	if len(task.Members) != 1 || task.Members[0].Status != "completed" || task.Members[0].Workspace != "discord:ws1" {
		t.Fatalf("member row = %+v", task.Members)
	}
	var memberEvent, resultEvent bool
	for _, ev := range task.Events {
		if strings.Contains(ev.Detail, "member finished in workspace") {
			memberEvent = true
		}
		if strings.Contains(ev.Detail, "workspace final result") {
			resultEvent = true
		}
	}
	if !memberEvent || !resultEvent {
		t.Fatalf("member/result events missing: %+v", task.Events)
	}
	raw, err := os.ReadFile(filepath.Join(p.dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), token) {
		t.Fatal("member credential persisted")
	}
	if starts.Load() != 1 {
		t.Fatalf("workspace dispatch ran %d times", starts.Load())
	}
}

// Concurrent delivery retries with one request id run the target once.
func TestTaskRelayWorkspaceDuplicateDispatchRunsOnce(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	p.resolveWorkspace = source.resolveTaskWorkspace
	rm.Bind("discord", "ws1", map[string]string{"source": "Source", "target": "Target"})
	session.events <- Event{Type: EventResult, Content: "only result"}
	req := taskRelayRequest(id)
	req.Workspace = "ws1"

	errs := make([]error, 4)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = rm.Send(context.Background(), req)
		}(i)
	}
	wg.Wait()
	if starts.Load() != 1 {
		t.Fatalf("duplicate dispatch ran target %d times", starts.Load())
	}
	success := false
	for _, err := range errs {
		if err == nil {
			success = true
			continue
		}
		if !strings.Contains(err.Error(), "is running") {
			t.Fatalf("unexpected duplicate error: %v", err)
		}
	}
	if !success {
		t.Fatal("no duplicate dispatch returned the result")
	}
}

func readProgressRecord(t *testing.T, dir, id string) progressRecord {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var rec progressRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

// claimSourceWorkspace records the source session (discord:room) as a workspace
// of discord:lobby: task cards only live in workspace channels (#453), and a
// cross-workspace dispatch goes to a sibling workspace of the same chat.
func claimSourceWorkspace(t *testing.T, e *Engine) {
	t.Helper()
	if err := e.ClaimTeamWorkspace("discord:lobby", "room", "工作区9"); err != nil {
		t.Fatal(err)
	}
}

// crossWorkspaceGateFixture: the card lives in workspace room of chat lobby,
// ws1 is a sibling workspace of lobby, ws2 belongs to another chat. The real
// #453 card gate (isTeamWorkspaceChat) is on, not the nil test default.
func crossWorkspaceGateFixture(t *testing.T) (*PublicProgress, *progressTestPlatform, *Engine, string, string) {
	t.Helper()
	p, platform, run, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangChinese)
	e.SetDataDir(p.dataDir)
	claimSourceWorkspace(t, e)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspace("discord:other", "ws2", "工作区2"); err != nil {
		t.Fatal(err)
	}
	p.workspaceChat = e.isTeamWorkspaceChat
	p.resolveWorkspace = e.resolveTaskWorkspace
	return p, platform, e, run, id
}

// #431 after #453: a dispatch goes from workspace A or the owning chat channel
// to a workspace B of the same chat; a workspace of another chat is refused.
func TestCrossWorkspaceDispatchThroughWorkspaceCardGate(t *testing.T) {
	p, platform, e, run, id := crossWorkspaceGateFixture(t)
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		return platform, nil
	}
	if err := p.checkWorkspaceCard("discord:room:user"); err != nil {
		t.Fatalf("source workspace refused by the card gate: %v", err)
	}

	// A -> B, same chat: allowed, the row stays on A's card.
	if _, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m1", "ws1")); err != nil {
		t.Fatalf("sibling workspace assignment: %v", err)
	}
	task, _ := p.Task(id)
	if task.SessionKey != "discord:room:user" || len(task.Members) != 1 || task.Members[0].Workspace != "discord:ws1" {
		t.Fatalf("card = %s, members %+v", task.SessionKey, task.Members)
	}

	// A -> a workspace of another chat: refused, no row.
	if _, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m2", "ws2")); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("foreign workspace assignment = %v", err)
	}
	if task, _ := p.Task(id); len(task.Members) != 1 {
		t.Fatalf("foreign assignment created rows: %+v", task.Members)
	}

	// Chat channel as source: progress start still opens no card there, but a
	// batch assignment with an explicit workspace opens the card in that
	// workspace and keeps the chat run/session as the task identity.
	lobby := "discord:lobby:user"
	lobbyRun := p.begin(platform, lobby, LangChinese, nil)
	if _, err := p.Report(PublicProgressRequest{Project: "source", SessionKey: lobby, Run: lobbyRun, Seq: 1, Kind: "start", Title: "chat task", Summary: "start"}); !errors.Is(err, errCardOutsideWorkspace) {
		t.Fatalf("chat channel progress start = %v", err)
	}
	req := taskWorkspaceAssignment("", lobbyRun, "m3", "ws1")
	req.SessionKey, req.BatchID = lobby, "chat-batch"
	grant, err := p.AssignMember(req)
	if err != nil {
		t.Fatalf("chat channel source assignment: %v", err)
	}
	chatTask, ok := p.Task(grant.TaskID)
	if !ok || chatTask.SessionKey != lobby || chatTask.ChannelID != "discord:ws1" {
		t.Fatalf("chat-source card = %+v, %v", chatTask, ok)
	}
	foreignChat := taskWorkspaceAssignment("", lobbyRun, "m4", "ws2")
	foreignChat.SessionKey, foreignChat.BatchID = lobby, "chat-batch-2"
	if _, err := p.AssignMember(foreignChat); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("chat-source foreign workspace assignment = %v", err)
	}
	noWorkspace := taskWorkspaceAssignment("", lobbyRun, "m5", "")
	noWorkspace.SessionKey, noWorkspace.BatchID = lobby, "chat-batch-3"
	if _, err := p.AssignMember(noWorkspace); !errors.Is(err, errCardOutsideWorkspace) {
		t.Fatalf("chat-source assignment without workspace = %v", err)
	}
	if _, err := e.resolveTaskWorkspace(lobby, "ws1"); err != nil {
		t.Fatalf("chat channel source workspace = %v", err)
	}
}

// Facts of a chat-source task are posted through the bot bound in the card's
// execution workspace, not in the chat channel that owns the task.
func TestChatSourceCardFactsUseExecutionWorkspace(t *testing.T) {
	p, platform, e, _, _ := crossWorkspaceGateFixture(t)
	if err := e.ClaimTeamWorkspace("discord:lobby", "ws3", "工作区3"); err != nil {
		t.Fatal(err)
	}
	raw := &rawDestinationPlatform{progressTestPlatform: platform}
	var sessions []string
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		sessions = append(sessions, session)
		return raw, nil
	}
	lobby := "discord:lobby:user"
	lobbyRun := p.begin(raw, lobby, LangChinese, nil)
	req := taskWorkspaceAssignment("", lobbyRun, "m1", "ws1")
	req.SessionKey, req.BatchID = lobby, "chat-batch"
	grant, err := p.AssignMember(req)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0] != "discord:ws1" {
		t.Fatalf("first member reporter sessions = %v, want only discord:ws1", sessions)
	}
	p.mu.Lock()
	r := p.records[grant.TaskID]
	p.mu.Unlock()
	if r == nil {
		t.Fatal("chat-source card missing")
	}
	r.mu.Lock()
	if r.record.Task.ChannelID != "ws1" || r.record.Task.CardSession != "discord:ws1" {
		r.mu.Unlock()
		t.Fatalf("card destination = channel %q, session %q", r.record.Task.ChannelID, r.record.Task.CardSession)
	}
	r.mu.Unlock()
	// A second member in another workspace of the same chat still reports to
	// the workspace holding the card, not to its own execution workspace.
	sessions = nil
	second := taskWorkspaceAssignment(grant.TaskID, lobbyRun, "m2", "ws3")
	second.SessionKey = lobby
	if _, err := p.AssignMember(second); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 || sessions[0] != "discord:ws1" || sessions[1] != "discord:ws3" {
		t.Fatalf("second member reporter sessions = %v, want card ws1 then execution ws3", sessions)
	}
	sessions = nil
	r.mu.Lock()
	p.appendEvent(r, TaskEventProgress, "member fact", true)
	r.record.Task.Events[len(r.record.Task.Events)-1].ReporterProject = "target"
	r.mu.Unlock()
	if _, err := p.flushRun(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	if len(sessions) == 0 {
		t.Fatal("fact reporter was never resolved")
	}
	for _, session := range sessions {
		if session != "discord:ws1" {
			t.Fatalf("fact reporter sessions = %v, want only discord:ws1", sessions)
		}
	}
}

// The same cases through task relay with the real gate and bindings,
// including a task owned by the chat channel itself.
func TestCrossWorkspaceRelayThroughWorkspaceCardGate(t *testing.T) {
	p, platform, _, _, id := crossWorkspaceGateFixture(t)
	var starts atomic.Int32
	agent := &controllableAgent{}
	rm, session := taskRelayManagerWithAgent(t, p, platform, nil, &starts, agent)
	source := rm.engines["source"]
	source.dataDir = p.dataDir
	for _, ch := range []string{"ws1", "ws2", "lobby"} {
		rm.Bind("discord", ch, map[string]string{"source": "Source", "target": "Target"})
	}
	session.events <- Event{Type: EventResult, Content: "sibling result"}

	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	if result, err := rm.Send(context.Background(), req); err != nil || result.Response != "sibling result" {
		t.Fatalf("sibling workspace relay = %+v, %v", result, err)
	}
	foreign := taskRelayRequest(id)
	foreign.RequestID, foreign.Workspace = "dispatch-foreign", "ws2"
	if _, err := rm.Send(context.Background(), foreign); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("foreign workspace relay = %v", err)
	}
	lobby := "discord:lobby:user"
	lobbyRun := p.begin(platform, lobby, LangChinese, nil)
	chatAssign := taskWorkspaceAssignment("", lobbyRun, "m-chat", "ws1")
	chatAssign.SessionKey, chatAssign.BatchID = lobby, "chat-batch"
	grant, err := p.AssignMember(chatAssign)
	if err != nil {
		t.Fatalf("chat channel source assignment: %v", err)
	}
	// Each relay closes its target session, so the chat dispatch gets a fresh one.
	chatSession := &taskRelaySession{controllableAgentSession: newControllableSession("target")}
	agent.startSessionFn = func(context.Context, string) (AgentSession, error) { starts.Add(1); return chatSession, nil }
	chatSession.events <- Event{Type: EventResult, Content: "chat result"}
	chat := taskRelayRequest(grant.TaskID)
	chat.RequestID, chat.SessionKey, chat.Workspace = "dispatch-chat", lobby, "ws1"
	if result, err := rm.Send(context.Background(), chat); err != nil || result.Response != "chat result" {
		t.Fatalf("chat channel source relay = %+v, %v", result, err)
	}
	chatForeign := chat
	chatForeign.RequestID, chatForeign.Workspace = "dispatch-chat-foreign", "ws2"
	if _, err := rm.Send(context.Background(), chatForeign); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("chat channel source foreign relay = %v", err)
	}
	chatNoWorkspace := chat
	chatNoWorkspace.RequestID, chatNoWorkspace.Workspace = "dispatch-chat-no-workspace", ""
	if _, err := rm.Send(context.Background(), chatNoWorkspace); !errors.Is(err, errCardOutsideWorkspace) {
		t.Fatalf("chat channel source relay without workspace = %v", err)
	}
	if starts.Load() != 2 {
		t.Fatalf("refused dispatches started the target: %d starts", starts.Load())
	}
}

// Facts of a cross-workspace member land on the source card, so its bot must
// be bound in the source workspace as well as the execution workspace.
func TestCrossWorkspaceRequiresBindingInSourceToo(t *testing.T) {
	p, platform, _, run, id := crossWorkspaceGateFixture(t)
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		if session == "discord:ws1" {
			return platform, nil
		}
		return nil, errors.New("unbound in " + session)
	}
	if _, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m1", "ws1")); err == nil || !strings.Contains(err.Error(), "unbound in discord:room:user") {
		t.Fatalf("assignment with target unbound in source = %v", err)
	}
	if task, _ := p.Task(id); len(task.Members) != 0 {
		t.Fatalf("rejected assignment created rows: %+v", task.Members)
	}

	// relay Send already refuses a target unbound in the source chat; the
	// receipt step checks both channels on its own as well.
	req := taskRelayRequest(id)
	req.Workspace = "ws1"
	if _, _, err := p.beginTaskRelay(req, "Target"); err == nil || !strings.Contains(err.Error(), "unbound in discord:room:user") {
		t.Fatalf("relay with target unbound in source = %v", err)
	}
	if _, ok := p.records[id].record.Relays[req.RequestID]; ok {
		t.Fatal("failed binding check left a receipt")
	}
}

// An assign retry returns its committed grant even after the execution
// workspace fills up or changes hands; new work there is still refused.
func TestAssignMemberWorkspaceRetryBeforeLiveChecks(t *testing.T) {
	p, platform, e, run, id := crossWorkspaceGateFixture(t)
	p.resolveReporter = func(project, platformName, session string) (TaskCardPublisher, error) {
		return platform, nil
	}
	req := taskWorkspaceAssignment(id, run, "m1", "ws1")
	grant, err := p.AssignMember(req)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < teamWorkspaceBusy; i++ {
		if err := e.ClaimTeamWorkspace("discord:lobby", "ws1", "工作区1"); err != nil {
			t.Fatal(err)
		}
	}
	if retry, err := p.AssignMember(req); err != nil || retry.ReportVia != grant.ReportVia || retry.MemberID != grant.MemberID {
		t.Fatalf("retry after workspace filled = %+v, %v", retry, err)
	}
	if _, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m2", "ws1")); err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("new work in a full workspace = %v", err)
	}
	if !e.releaseTeamWorkspace("discord:ws1", time.Now().Add(time.Hour), false) {
		t.Fatal("workspace was not released")
	}
	if err := e.ClaimTeamWorkspace("discord:other", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	if retry, err := p.AssignMember(req); err != nil || retry.ReportVia != grant.ReportVia {
		t.Fatalf("retry after workspace changed hands = %+v, %v", retry, err)
	}
	if _, err := p.AssignMember(taskWorkspaceAssignment(id, run, "m3", "ws1")); err == nil || !strings.Contains(err.Error(), "another chat channel") {
		t.Fatalf("new work in a re-claimed workspace = %v", err)
	}
}
