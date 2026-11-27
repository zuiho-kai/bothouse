package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// #2094: 龙娘, called into 彩虹猫's workspace, handed 彩虹猫's task back. Only the owner may.
func TestWorkspaceExitRefusesARoleThatIsNotTheOwner(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	exitBoardItem(t, e, 771, "彩虹猫的活")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "caihongmao", "彩虹猫的活", 771); err != nil {
		t.Fatal(err)
	}
	_, err := e.WorkspaceExit(e.ctx, exitWSKey, team.ExitKindReport, "[report] #771 背景：不是我的活。\n已经完成。\n要你做的：没有。\n给你的：无\n我加的：无")
	if !errors.Is(err, ErrWorkspaceExitNotOwner) {
		t.Fatalf("a non-owner's handback = %v, want ErrWorkspaceExitNotOwner", err)
	}
	if task, _, err := e.TeamTask(771); err != nil || task.State != TeamTaskDispatched {
		t.Fatalf("task changed by a refused handback: %+v err=%v", task, err)
	}
	if !notWorkspaceOwner(e, p, exitWSKey, 0) {
		t.Fatal("橘 counted as the owner of caihongmao's task")
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", e.name, "彩虹猫的活", 771); err == nil && notWorkspaceOwner(e, p, exitWSKey, 771) {
		t.Fatal("the owner named by project is not the owner")
	}
}

// A teammate's @ in a workspace wakes only the role working the task there.
func TestTeammateCallInWorkspaceWakesOnlyTheOwner(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	call := &Message{SessionKey: exitWSKey, Mentioned: true, FromBot: true, UserName: "彩虹猫", Content: "进度：原句 @橘"}
	if got := e.addresseeOf(p, call); got != AddrSelf {
		t.Fatalf("no task in the workspace: addressee = %v, want self", got)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "caihongmao", "彩虹猫的活", 771); err != nil {
		t.Fatal(err)
	}
	if got := e.addresseeOf(p, call); got != AddrOther {
		t.Fatalf("teammate's call to a non-owner: addressee = %v, want other", got)
	}
	person := *call
	person.FromBot = false
	if got := e.addresseeOf(p, &person); got != AddrSelf {
		t.Fatalf("a person's call: addressee = %v, want self", got)
	}
}

// #2098: #2082's wake was held by a cooldown 16:49→18:40; meanwhile #2082 closed and #2094 took
// 工作区6, and the wake ran there. The wake set through the API belongs to the task handed there.
func TestHandoffWakeIsDroppedWhenItsTaskLeftTheWorkspace(t *testing.T) {
	e, agent, ts := taskTimerFixture(t)
	api := &APIServer{timer: ts, engines: map[string]*Engine{e.name: e}}
	body, _ := json.Marshal(TimerAddRequest{Project: e.name, SessionKey: "discord:ws1", Delay: "1h",
		Description: "工作区接手：t", Prompt: "你是工作区频道里的主角色，接手 #7", Handoff: true})
	rec := httptest.NewRecorder()
	api.handleTimerAdd(rec, httptest.NewRequest(http.MethodPost, "/timer/add", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("timer add: %d %s", rec.Code, rec.Body.String())
	}
	var wake *TimerJob
	for _, j := range ts.store.ListPending() {
		if j.Handoff {
			wake = j
		}
	}
	if wake == nil || wake.TaskHandoff == "" || wake.TaskHandoff != e.workspaceHandoffID("discord:ws1") {
		t.Fatalf("handoff wake = %+v, want bound to task #7's handoff", wake)
	}

	if freed, err := e.ParkTeamWorkspaceWhy("discord:ws1", "", time.Time{}, "workspace park", false); err != nil || !freed {
		t.Fatalf("park = %v, %v", freed, err)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "u", 8); err != nil {
		t.Fatal(err)
	}
	ts.executeJob(wake.ID)
	if got := ts.store.Get(wake.ID); !got.Fired || !strings.Contains(got.LastError, "no longer in") {
		t.Fatalf("wake after its task left = %+v, want dropped", got)
	}
	if n := agent.session.normal.Load() + agent.session.strict.Load(); n != 0 {
		t.Fatalf("%d prompts reached ws1, now task 8's", n)
	}
}
