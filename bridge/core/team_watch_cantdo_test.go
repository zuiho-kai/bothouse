package core

import "testing"

func TestWatchBoardWaiting(t *testing.T) {
	for s, want := range map[string]bool{"等上游": true, "等待接口开通": true, "等用户确认": true, "进行中": false, "": false, "在做：等会儿跑测试": false} {
		if watchBoardWaiting(s) != want {
			t.Errorf("watchBoardWaiting(%q) != %v", s, want)
		}
	}
}
