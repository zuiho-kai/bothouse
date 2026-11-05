package core

import (
	"strings"
	"testing"
	"time"
)

// 11-05 agentm: the watch told a blocked role to carry on every ten minutes and each time it
// answered a long "做不了". Two such answers in a row stop the watch and tell a person once.
func TestWatchCantDoTwiceStopsAndTellsOnce(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "接上游的接口")
	e.adminFrom = "999"
	writeReleaseBoard(t, e, map[string]any{"id": 5, "what": "接上游的接口", "status": "进行中", "who": "工作区1橘", "ws": "discord:ws1", "chat": "discord:chatA"})
	reply := "这件我做不了：上游接口还没开，我这边没有权限。"
	e.watchTurnEnded(p, "discord:ws1", reply, true, false, false, false, time.Time{})
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.CantDo != 1 || got.Idle.Reported {
		t.Fatalf("after one cant-do: %+v", got.Idle)
	}
	e.watchTurnEnded(p, "discord:ws1", reply, true, false, false, false, time.Time{})
	got := handoffsOf(e, "discord:ws1")[0]
	if !got.Idle.Reported {
		t.Fatalf("two cant-do in a row must stop the watch: %+v", got.Idle)
	}
	e.watchTurnEnded(p, "discord:ws1", reply, true, false, false, false, time.Time{})
	n := 0
	for _, s := range p.sentTo("discord:chatA") {
		if strings.Contains(s, "cannot do") {
			n++
			if !strings.Contains(s, "<@999>") {
				t.Fatalf("the notice must call the person: %q", s)
			}
		}
	}
	if n != 1 {
		t.Fatalf("cant-do notices = %d, want 1 (%q)", n, p.sentTo("discord:chatA"))
	}
}

// Real progress in between resets the count.
func TestWatchCantDoResetByProgress(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "接上游的接口")
	e.watchTurnEnded(p, "discord:ws1", "做不了，等上游", true, false, false, false, time.Time{})
	e.watchTurnEnded(p, "discord:ws1", "改完了第一步，正在跑测试", true, false, false, false, time.Time{})
	e.watchTurnEnded(p, "discord:ws1", "做不了，等上游", true, false, false, false, time.Time{})
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.CantDo != 1 || got.Idle.Reported {
		t.Fatalf("progress must reset the count: %+v", got.Idle)
	}
}

func TestWatchBoardWaiting(t *testing.T) {
	for s, want := range map[string]bool{"等上游": true, "等待接口开通": true, "等用户确认": true, "进行中": false, "": false, "在做：等会儿跑测试": false} {
		if watchBoardWaiting(s) != want {
			t.Errorf("watchBoardWaiting(%q) != %v", s, want)
		}
	}
	for s, want := range map[string]bool{"这件我做不了": true, "I can't proceed without access": true, "无法继续": true, "做完了": false, "可以做": false} {
		if watchIsCantDo(s) != want {
			t.Errorf("watchIsCantDo(%q) != %v", s, want)
		}
	}
}
