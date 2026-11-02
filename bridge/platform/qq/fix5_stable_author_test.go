package qq

import (
	"context"
	"strings"
	"testing"
)

// 回归测试：任务板 #11 未完成缺口（2026-11-02）
// 「两个人用同一张群名片时，[群里刚才的聊天] 只有显示名，历史事实归属不可恢复」。
// 修复前本组断言失败（ambient 行形如 `成员：...`，没有稳定号）；
// 修复后每一行形如 `成员[ID:20001]：...`，同名两人可从背景分清归属。
//
// 本文件是修复方自带的回归测试，不验收自身：初审与 G哥终验另做。

func TestFix5GroupAmbientCarriesStableAuthorIDPerLine(t *testing.T) {
	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f)
	const gid = 41001 // 测试常量：假群号
	f.push(groupMessage(gid, 20001, 1, textSegment("我是A只喝茉莉茶")))
	awaitMessage(t, msgs)
	f.push(groupMessage(gid, 20002, 2, textSegment("我是B只喝可可")))
	awaitMessage(t, msgs)
	// 第三条的「刚才的聊天」里才同时有 A、B 两行（当前这条不进自己的背景）。
	f.push(groupMessage(gid, 20001, 3, textSegment("再说一句")))
	m := awaitMessage(t, msgs)
	if !strings.Contains(m.AmbientChat, "成员[ID:20001]：我是A只喝茉莉茶") {
		t.Fatalf("背景缺少带稳定号的 A 行：%q", m.AmbientChat)
	}
	if !strings.Contains(m.AmbientChat, "成员[ID:20002]：我是B只喝可可") {
		t.Fatalf("背景缺少带稳定号的 B 行：%q", m.AmbientChat)
	}
	if strings.Contains(m.AmbientChat, "user_id=") {
		t.Fatalf("背景出现非预期的字段样式：%q", m.AmbientChat)
	}
	t.Logf("实测背景逐行带稳定号：%q（session=%s user=%s）", m.AmbientChat, m.SessionKey, m.UserID)
}

func TestFix5GroupAmbientOwnLineCarriesSelfID(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("send_group_msg", func(map[string]any) map[string]any { return map[string]any{"message_id": 901} })
	p, msgs := startTestPlatform(t, f)
	const gid = 41002 // 测试常量：假群号
	f.push(groupMessage(gid, 20001, 11, textSegment("在吗")))
	first := awaitMessage(t, msgs)
	if err := p.Send(context.Background(), first.ReplyCtx, "在"); err != nil {
		t.Fatal(err)
	}
	f.push(groupMessage(gid, 20002, 12, textSegment("再来一句")))
	m := awaitMessage(t, msgs)
	if !strings.Contains(m.AmbientChat, "你[ID:10000]：在") {
		t.Fatalf("自己的历史行未带自身号：%q", m.AmbientChat)
	}
	if !strings.Contains(m.AmbientChat, "成员[ID:20001]：在吗") {
		t.Fatalf("群友行未带稳定号：%q", m.AmbientChat)
	}
	t.Logf("实测自己的行：%q", m.AmbientChat)
}

func TestFix5GroupAmbientUnknownSpeakerKeepsPlainName(t *testing.T) {
	p := &Platform{}
	const gid = 41003 // 测试常量：假群号
	p.noteGroupLine(gid, 0, "成员", "号未知的行")
	p.noteGroupLine(gid, 20001, "成员", "号已知的行")
	got := p.groupContext(gid)
	if !strings.Contains(got, "成员：号未知的行") {
		t.Fatalf("号未知时未退回显示名：%q", got)
	}
	if !strings.Contains(got, "成员[ID:20001]：号已知的行") {
		t.Fatalf("号已知时未标注稳定号：%q", got)
	}
	t.Logf("实测未知号的退路：%q", got)
}
