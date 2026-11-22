package team

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// #1836 (11-21 13:37 JST): 「再看：」 written as a clock time fell to the 1h default, silently.
const clockReport = "细节：\n等外部：等周末那轮跑完\n" +
	"再看：11-23 18:00 JST 之后接回，看那轮有没有按预期跑、有没有再冒出撞词假叫醒；主角色 11-24 06:30 JST 定时统一核，那之前接回没有新情况就继续等，不重跑测试。"

func TestWaitExternalClockTime(t *testing.T) {
	now := time.Date(2026, 11, 21, 13, 37, 0, 0, time.Local)
	// 11-23 18:00 is 52h away: held at the 24h cap, not the 1h default.
	if _, after, unread, ok := waitExternal(clockReport, now); !ok || unread != "" || after != WaitExternalMax {
		t.Fatalf("#1836 line: after = %v unread %q ok %v, want %v", after, unread, ok, WaitExternalMax)
	}
	if _, after, _, _ := waitExternal("等外部：x\n再看：11-22 09:00 之后", now); after != 19*time.Hour+23*time.Minute {
		t.Fatalf("clock within a day: after = %v", after)
	}
	if _, after, _, _ := waitExternal("等外部：x。再看：11-21 23:37", now); after != 10*time.Hour {
		t.Fatalf("clock on the 等外部 line: after = %v", after)
	}
	if _, after, unread, _ := waitExternal("等外部：x\n再看：11-20 09:00", now); after != WaitExternalDefault || unread != "" {
		t.Fatalf("past clock: after = %v unread %q, want default", after, unread)
	}
	ny, err := time.LoadLocation("America/New_York")
	if err == nil {
		want := time.Date(2026, 11, 21, 9, 30, 0, 0, ny).Sub(now)
		if _, after, _, _ := waitExternal("等外部：x\n再看：11-21 09:30 ET 开盘", now); after != want {
			t.Fatalf("ET clock: after = %v, want %v", after, want)
		}
	}
	// durations as before (#1815 same-line form included)
	if _, after, _, _ := waitExternal("等外部：卡在今晚那份判断还没写。再看：7h（16:20 JST 复查仍未出）", now); after != 7*time.Hour {
		t.Fatalf("#1815: after = %v", after)
	}
	if _, after, _, _ := waitExternal("等外部：等对方回\n再看：1h30m", now); after != 90*time.Minute {
		t.Fatalf("1h30m: after = %v", after)
	}
}

func TestWaitExternalUnreadLogged(t *testing.T) {
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	body := "等外部：等对方回\n再看：等他周一上班之后"
	if _, after, ok := WaitExternalFor(1836, body, time.Now()); !ok || after != WaitExternalDefault {
		t.Fatalf("unread: after = %v ok %v, want default", after, ok)
	}
	out := buf.String()
	if !strings.Contains(out, "level=WARN") || !strings.Contains(out, "board_item=1836") || !strings.Contains(out, "等他周一上班之后") {
		t.Fatalf("no Warn with the item and the line: %q", out)
	}
	buf.Reset()
	if _, _, _ = WaitExternalFor(1, "等外部：x\n再看：2h", time.Now()); buf.Len() != 0 {
		t.Fatalf("read line logged: %q", buf.String())
	}
}
