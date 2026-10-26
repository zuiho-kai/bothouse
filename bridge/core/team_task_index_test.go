package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type indexedProgressPlatform struct {
	*progressTestPlatform
	board stubBoardPlatform
}

func (p *indexedProgressPlatform) UpsertBoard(ctx context.Context, key, id, text string, live bool) (string, error) {
	return p.board.UpsertBoard(ctx, key, id, text, live)
}

// Three user actions use the real Engine, reporter, heartbeat writer and board
// updater. Only the model process and message transport are fixtures.
func TestCUJ_Progress2_PinnedIndexLifecycle(t *testing.T) {
	_, e, a, _, session := inputFixture(t)
	p := &indexedProgressPlatform{progressTestPlatform: newProgressPlatform()}
	e.platforms = []Platform{p}
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	e.SetTeam(dir, "G哥", true)
	boards := map[string]*boardChat{}
	send := func(id, text string) {
		e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), MessageID: id, UserID: "human", Content: text, Mentioned: true})
	}
	report := func(token string, seq int64, kind string) string {
		id, err := e.publicProgress.Report(PublicProgressRequest{Project: "gge", SessionKey: inputTestKey, Run: token, Seq: seq, Kind: kind, Title: "修复语音", Summary: "公开进展"})
		if err != nil {
			t.Fatal(err)
		}
		e.publicProgress.Flush(context.Background())
		return id
	}
	refresh := func(wantState TaskState, wantCount int) string {
		var files []teamFile
		inputWait(t, func() bool {
			files = readTeamFiles(dir, time.Now())
			return len(files) == 1 && len(files[0].Tasks) == wantCount && (wantCount == 0 || files[0].Tasks[0].State == wantState)
		})
		e.updateTeamBoards(files, boards)
		return p.board.content[inputTestKey]
	}
	send("one", "检查语音绑定")
	token := progressToken(t, inputPrompt(t, a))
	id := report(token, 1, "start")
	if text := refresh(TaskStateInProgress, 1); !strings.Contains(text, "https://example.test/cards/"+id) {
		t.Fatal("real entry did not publish index link", text)
	}
	boardID := boards[inputTestKey].MessageID
	report(token, 2, "waiting")
	if text := refresh(TaskStateWaitingUser, 1); !strings.Contains(text, "Needs your input") {
		t.Fatal("waiting not visible", text)
	}
	// The same live task resumes and obtains a result. Removing its entry must
	// leave the card and facts available, without treating it as accepted.
	report(token, 3, "result")
	inputDone(a, "结果已提交，待验收")
	inputWait(t, func() bool { return !session.Busy() })
	if text := refresh("", 0); strings.Contains(text, "https://example.test/cards/") {
		t.Fatal("result retained in live index", text)
	}
	if p.task(id).State != TaskStateResultReady || len(p.facts) == 0 {
		t.Fatal("historical card/facts lost")
	}
	send("two", "再检查另一个绑定")
	token = progressToken(t, inputPrompt(t, a))
	report(token, 1, "start")
	refresh(TaskStateInProgress, 1)
	a.session.events <- Event{Type: EventError, Error: errors.New("fixture failure")}
	inputWait(t, func() bool { return !session.Busy() })
	refresh("", 0)
	send("three", "你好")
	inputPrompt(t, a)
	inputDone(a, "你好")
	inputWait(t, func() bool { return !session.Busy() })
	refresh("", 0)
	if boards[inputTestKey].MessageID != boardID || len(p.snapshots) != 2 {
		t.Fatal("board replaced or chat created a task")
	}
}

func TestTaskIndexLifecycleAndRestart(t *testing.T) {
	for _, outcome := range []string{"result", "failed", "cancelled", "waiting", "crash"} {
		t.Run(outcome, func(t *testing.T) {
			dir := t.TempDir()
			platform := newProgressPlatform()
			p, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			run := p.begin(platform, "discord:111:user", LangChinese, nil)
			if len(p.taskLinks()) != 0 {
				t.Fatal("ordinary chat listed")
			}
			req := PublicProgressRequest{Project: "fish", SessionKey: "discord:111:user", Run: run, Seq: 1, Kind: "start", Title: "检查绑定", Summary: "正在检查"}
			id, err := p.Report(req)
			if err != nil {
				t.Fatal(err)
			}
			platform.fail = true
			p.Flush(context.Background())
			if len(p.taskLinks()) != 0 {
				t.Fatal("unpublished card got a fabricated link")
			}
			platform.fail = false
			p.Flush(context.Background())
			if links := p.taskLinks(); len(links) != 1 || links[0].ID != id {
				t.Fatalf("missing published card: %+v", links)
			}
			if outcome == "waiting" {
				req.Seq, req.Kind, req.Summary = 2, "waiting", "请决定下一步"
				if _, err := p.Report(req); err != nil {
					t.Fatal(err)
				}
				p.finish(run, "result")
			} else if outcome != "crash" {
				p.finish(run, outcome)
			}
			p.Flush(context.Background())
			restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
			if err != nil {
				t.Fatal(err)
			}
			want := 0
			if outcome == "waiting" {
				want = 1
			}
			if got := restored.taskLinks(); len(got) != want {
				t.Fatalf("index after %s: %+v", outcome, got)
			}
			data, err := os.ReadFile(filepath.Join(p.dir, id+".json"))
			if err != nil {
				t.Fatal("historical card removed", err)
			}
			var record progressRecord
			if err := json.Unmarshal(data, &record); err != nil {
				t.Fatal(err)
			}
			if record.Task.MessageID == "" || record.Task.ThreadID == "" || len(record.Task.Events) == 0 {
				t.Fatal("history/bindings lost")
			}
		})
	}
}

func TestTaskIndexScopesSortsAndBoundsLinks(t *testing.T) {
	now := time.Now()
	files := []teamFile{{Project: "fish", Name: "肥鱼"}}
	for n := 0; n < 18; n++ {
		files[0].Tasks = append(files[0].Tasks, teamTaskLink{ID: fmt.Sprint(n), SessionKey: "discord:111:u", Title: fmt.Sprint("任务", n), URL: fmt.Sprintf("https://example.test/card/%d", n), State: TaskStateInProgress, UpdatedAt: now.Add(time.Duration(n) * time.Second)})
	}
	files[0].Tasks = append(files[0].Tasks,
		teamTaskLink{ID: "wait", SessionKey: "discord:111", Title: "请决定 [链接](危险) @everyone\n另一行", URL: "https://example.test/card/wait", State: TaskStateWaitingUser},
		teamTaskLink{ID: "secret", SessionKey: "discord:222", Title: "PRIVATE_SECRET", URL: "https://example.test/secret", State: TaskStateWaitingUser},
		teamTaskLink{ID: "done", SessionKey: "discord:111", Title: "COMPLETED", URL: "https://example.test/done", State: TaskStateCompleted},
		teamTaskLink{ID: "bad", SessionKey: "discord:111", Title: "BAD_LINK", URL: "javascript:alert(1)", State: TaskStateWaitingUser})
	files[0].Tasks = append(files[0].Tasks, files[0].Tasks[0])
	got := renderTeamBoardWithTasks(files, "discord:111", LangChinese)
	for _, forbidden := range []string{"PRIVATE_SECRET", "https://example.test/secret", "COMPLETED", "BAD_LINK", "@everyone", "[链接]"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("index contains %q: %s", forbidden, got)
		}
	}
	if strings.Index(got, "待你处理") >= strings.Index(got, "进行中") || !strings.Contains(got, "另有 7 项任务") {
		t.Fatal("priority/overflow wrong", got)
	}
	if strings.Count(got, "https://example.test/") != 12 || len([]rune(got)) > 4000 {
		t.Fatal("invalid bounded links", got)
	}
	for _, lang := range []Language{LangEnglish, LangChinese, LangTraditionalChinese, LangJapanese, LangSpanish} {
		text := renderTeamBoardWithTasks(files, "discord:111", lang)
		if strings.Contains(text, "board_tasks_") {
			t.Fatal("missing translation", lang)
		}
	}
}

func TestTaskIndexCreatesBoardWithoutToolActivityAndKeepsHistory(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	allChatsAreWorkspaces(e)
	boards := map[string]*boardChat{}
	files := []teamFile{{Project: "fish", Name: "肥鱼", Tasks: []teamTaskLink{{ID: "t1", SessionKey: "discord:111", Title: "验证语音", URL: "https://example.test/card/1", State: TaskStateWaitingUser}}}}
	if !e.updateTeamBoards(files, boards) || p.posts != 1 {
		t.Fatal("waiting task did not create index")
	}
	id := boards["discord:111"].MessageID
	if e.updateTeamBoards(files, boards) || p.posts != 1 {
		t.Fatal("unchanged index reposted")
	}
	files[0].Tasks = nil
	if !e.updateTeamBoards(files, boards) || boards["discord:111"].MessageID != id {
		t.Fatal("ending task replaced/deleted the board")
	}
	if strings.Contains(p.content["discord:111"], "https://example.test/card/1") {
		t.Fatal("ended task retained in index")
	}
}
