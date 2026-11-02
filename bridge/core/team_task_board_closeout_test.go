package core

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestTeamTaskBoardMergedReviewsAreDisplayOnly(t *testing.T) {
	now := time.Date(2026, 11, 2, 19, 0, 0, 0, time.Local)
	for _, platform := range []string{"discord", "qq", "feishu", "cloud_web"} {
		t.Run(platform, func(t *testing.T) {
			chat := platform + ":main"
			items := []teamTaskBoardItem{
				{ID: 1, Short: "发布验收", own: chat, Status: "待发布验证"},
				{ID: 2, Short: "记忆从项", own: chat, Paused: "11-02 18:00", PauseWhy: "并入 #1：保留真实入口验收", ReturnedAt: now.Add(-time.Hour), Reviewer: "lead"},
				{ID: 3, Short: "模型从项", own: chat, Paused: "11-02 18:00", PauseWhy: "并入主线 #1：保留隔离验收", ReviewRejected: "真实入口未验"},
				{ID: 4, Short: "等待确认", own: chat, Paused: "11-02 18:00", PauseWhy: "等待用户答复；并入 #1"},
			}
			before, _ := json.Marshal(items)
			for name, render := range map[string]func() string{
				"table":     func() string { return renderTeamTaskTable(items, nil, chat, now) },
				"board":     func() string { return renderTeamTaskBoard(items, chat, now) },
				"workspace": func() string { return renderWorkspaceTaskBoardFit(items, chat, now, backfillMaxMsgRunes) },
			} {
				got := render()
				if !strings.Contains(got, "发布验收") || !strings.Contains(got, "等待确认") || strings.Contains(got, "记忆从项") || strings.Contains(got, "模型从项") || strings.Contains(got, "暂停 1 件") {
					t.Errorf("%s must show parent and user decision without duplicate reviews:\n%s", name, got)
				}
			}
			after, _ := json.Marshal(items)
			if !reflect.DeepEqual(before, after) || !teamTaskBoardLive(items, chat) {
				t.Fatal("display consolidation changed pending acceptance or source records")
			}
		})
	}
}

func TestTeamTaskTableRejectedReasonIsShort(t *testing.T) {
	now := time.Date(2026, 11, 2, 19, 0, 0, 0, time.Local)
	history := strings.Repeat("旧审核经过不应放在置顶", 30)
	it := teamTaskBoardItem{ID: 1, Short: "入口验收", own: "room:main", Paused: "11-02 18:00", PauseWhy: "验收退回：" + history, ReviewRejected: history, Status: "代码已验；待发布入口验证"}
	got := renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", now)
	if strings.Contains(got, history) || !strings.Contains(got, it.Status) || strings.Contains(got, "未开工") {
		t.Fatalf("show current short stop, retain history in detail:\n%s", got)
	}
}

func TestTeamTaskTableMergedPRKeepsClosureStateWhenOverdue(t *testing.T) {
	now := time.Date(2026, 11, 2, 19, 0, 0, 0, time.Local)
	it := teamTaskBoardItem{ID: 1, Short: "发布验收", own: "room:main", Reviewer: "lead", ReturnedAt: now.Add(-24 * time.Hour), PRMerge: map[string]string{"commit": "abc"}}
	got := renderTeamTaskTable([]teamTaskBoardItem{it}, nil, "room:main", now)
	if !strings.Contains(got, "PR已合并") || !strings.Contains(got, "待收口") || strings.Contains(got, "没人验收") {
		t.Fatalf("merged work still waits for closure, not first review:\n%s", got)
	}
}

func TestTeamTaskBoardConsolidationKeepsUnresolvedTargets(t *testing.T) {
	now := time.Date(2026, 11, 2, 19, 0, 0, 0, time.Local)
	for _, scenario := range []string{"missing", "foreign-chat", "done", "self", "cycle", "broken-chain", "active", "user-status"} {
		t.Run(scenario, func(t *testing.T) {
			child := teamTaskBoardItem{ID: 1, Short: "必须保留", own: "room:main", Paused: "11-02 18:00", PauseWhy: "并入 #2", ReturnedAt: now}
			target := teamTaskBoardItem{ID: 2, Short: "归并目标", own: "room:main"}
			switch scenario {
			case "missing":
				target.ID = 3
			case "foreign-chat":
				target.own = "room:other"
			case "done":
				target.Status = "完成"
			case "self":
				child.PauseWhy = "并入 #1"
			case "cycle":
				target.Paused, target.PauseWhy = "11-02 18:00", "并入 #1"
			case "broken-chain":
				target.Paused, target.PauseWhy = "11-02 18:00", "并入 #3"
			case "active":
				child.Paused = ""
			case "user-status":
				child.Status = "等待用户确认"
			}
			items := []teamTaskBoardItem{child, target}
			if got := renderTeamTaskTable(items, nil, "room:main", now); !strings.Contains(got, child.Short) {
				t.Fatalf("unresolved consolidation hid pending work:\n%s", got)
			}
		})
	}
}

func TestTeamTaskBoardConsolidationChainAndReversibleView(t *testing.T) {
	now := time.Date(2026, 11, 2, 19, 0, 0, 0, time.Local)
	items := []teamTaskBoardItem{
		{ID: 1, Short: "底层从项", own: "room:main", Paused: "11-02 18:00", PauseWhy: "并入 #2", ReturnedAt: now},
		{ID: 2, Short: "中层从项", own: "room:main", Paused: "11-02 18:00", Status: "已并入主线 #3", ReviewRejected: "未验"},
		{ID: 3, Short: "最终主项", own: "room:main"},
	}
	got := renderTeamTaskTable(items, nil, "room:main", now)
	if !strings.Contains(got, "最终主项") || strings.Contains(got, "从项") {
		t.Fatal(got)
	}
	// A resumed child is active again without changing its retained review receipt.
	items[0].Paused = ""
	got = renderTeamTaskTable(items, nil, "room:main", now)
	if !strings.Contains(got, "底层从项") || items[0].ReturnedAt.IsZero() {
		t.Fatal(got)
	}
	// Workspaces do not borrow another workspace's parent to hide their own handback.
	items[0].Paused = "11-02 18:00"
	items[0].own, items[0].parent = "room:work", "room:main"
	got = renderWorkspaceTaskBoardFit(items, "room:work", now, backfillMaxMsgRunes)
	if !strings.Contains(got, "底层从项") {
		t.Fatal(got)
	}
}
