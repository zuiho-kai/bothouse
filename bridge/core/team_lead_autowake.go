package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The lead is woken by the bridge, not by its own memory (user 2026-11-25 「这种问题修根因 我明明强调了
// 也不主动去设置定时唤醒或者其它的」「我给你的指令 明明让你续任务，你也不续？」).
//
// Before this, a ② stop was only posted to the chat and the workspace was nudged; nothing ran a
// turn of the chat's lead, so carrying on depended on the lead having armed a timer itself. Each
// way in below is one silent turn of the lead in that chat (queued like a workspace handback, held
// while the user is talking, queueChatLeadTurn):
//
//   - every ② stop of a chat's item also wakes that chat's lead with the item and where it stopped;
//   - a stuck item (handed out, no progress) is not a ② (#1993: the lead's business, not the
//     user's), so it wakes the lead once per stuck binding, without a post;
//   - keep-running (keep_running, default on; board keep-running on|off per chat): when a chat's
//     work has all finished or stopped for keepRunningAfter, the lead is woken once to dispatch
//     the next task or wrap up, and not again until that chat has work in progress and runs out
//     again (user 2026-11-25 「这持续推进是不是得默认开启啊，你这个做法任务弄完也会停吧」: no turns burnt
//     on an idle chat).

// teamKeepRunningFile: per-chat overrides of keep_running, written by board keep-running (board.py).
const teamKeepRunningFile = "keep-running.json"

// keepRunningAfter: how long a chat's work must have run out before its lead is woken, so a
// handover between two tasks is not taken for the end of the work.
// 沿用 the */20 patrol cron leads armed by hand for the same job before this switch.
var keepRunningAfter = 20 * time.Minute

// SetKeepRunning wires the project's keep_running switch (default on).
func (e *Engine) SetKeepRunning(on bool) { e.keepRunningOn.Store(on) }

// leadAutowakeHook: tests see the turns here instead of queueing them on a platform.
var leadAutowakeHook func(e *Engine, chat, desc, prompt string, board int) bool

// leadAutowake queues one lead turn in chat.
func leadAutowake(e *Engine, chat, desc, prompt string, board int) bool {
	if leadAutowakeHook != nil {
		return leadAutowakeHook(e, chat, desc, prompt, board)
	}
	plat, id, ok := strings.Cut(chat, ":")
	if !ok {
		return false
	}
	p := e.platformForName(plat)
	if p == nil {
		slog.Warn("team lead autowake: platform not ready", "chat", chat)
		return false
	}
	return e.queueChatLeadTurn(p, id, "", desc, prompt, board, nil)
}

type keepRunningOverride struct {
	On    *bool  `json:"on,omitempty"` // absent: on (the first version of the file only listed chats switched on)
	Since string `json:"since,omitempty"`
}

func (o keepRunningOverride) on() bool { return o.On == nil || *o.On }

// readKeepRunning: chat → its override. Missing or unreadable file: none.
func readKeepRunning(dir string) map[string]keepRunningOverride {
	out := map[string]keepRunningOverride{}
	b, err := os.ReadFile(filepath.Join(dir, teamKeepRunningFile))
	if err != nil {
		return out
	}
	if err := json.Unmarshal(b, &out); err != nil {
		slog.Warn("team lead autowake: bad keep-running file", "error", err)
		return map[string]keepRunningOverride{}
	}
	return out
}

// stopWakesLead: a ② stop the lead has to act on. A pause with a scheduled re-dispatch
// (WaitUntil) carries on by itself.
func stopWakesLead(it teamTaskBoardItem) bool {
	return it.WaitUntil == 0
}

func stopLeadPrompt(it teamTaskBoardItem, text string) string {
	return fmt.Sprintf("[停摆唤醒] 本频道任务板 #%d 停了，桥已把下面这条贴进本频道，不用再贴：\n%s\n\n"+
		"你是主角色，这一轮把它接上：看这一项的工作区和交回，干完没交回就催它交，卡在环境或外部就换路或改派，确实做不下去就派下一件。"+
		"用户叫停的、要花钱部署重启的先问用户。处理完一两句说清你怎么办的；确实不用动就回 NO_REPLY。", it.ID, text)
}

func keepRunningPrompt() string {
	return fmt.Sprintf("[持续推进] 本频道任务板上的活都做完或都停了，已经 %d 分钟没有在做的活。"+
		"这是这一轮活做完后唯一的一次叫醒：按用户在本频道的原话，从最近的用户要求、任务板待办、上一件的交回里定下一件，直接派出去；"+
		"没有可派的就跟用户说一句做完了、等什么，或回 NO_REPLY。之后频道没新活桥不再叫你。用户叫停的、要花钱部署重启的先问用户；"+
		"用户不要这个频道续派就 board keep-running off。", int(keepRunningAfter/time.Minute))
}

// keepArm: a chat whose work may run out and wake its lead. Idle: when it was first seen with
// nothing in work (zero while work is in progress).
type keepArm struct {
	Idle time.Time `json:"idle,omitzero"`
}

// wakeKeepRunning: for every keep-running chat, arm while it has work in progress; once it has had
// none for keepRunningAfter, wake its lead once and disarm. Reports whether st changed.
func (e *Engine) wakeKeepRunning(st *teamChatState, items []teamTaskBoardItem, now time.Time) bool {
	over := readKeepRunning(e.team.dir)
	chats := map[string]bool{}
	for _, it := range items {
		if c := e.leadChatOf(it); c != "" {
			chats[c] = true
		}
	}
	for c := range st.KeepArm {
		chats[c] = true
	}
	for c, o := range over {
		if o.on() {
			chats[c] = true
		}
	}
	changed := false
	for chat := range chats {
		on := e.keepRunningOn.Load()
		o, explicit := over[chat]
		if explicit {
			on = o.on()
		}
		if !on {
			if _, ok := st.KeepArm[chat]; ok {
				delete(st.KeepArm, chat)
				changed = true
			}
			continue
		}
		if st.KeepArm == nil {
			st.KeepArm = map[string]*keepArm{}
		}
		if explicit && o.Since != "" && st.KeepOnSeen[chat] != o.Since {
			// just switched on: the lead gets the one wake even if the chat's work already ran out
			if st.KeepOnSeen == nil {
				st.KeepOnSeen = map[string]string{}
			}
			st.KeepOnSeen[chat] = o.Since
			if st.KeepArm[chat] == nil {
				st.KeepArm[chat] = &keepArm{}
			}
			changed = true
		}
		a := st.KeepArm[chat]
		if teamTaskBoardLive(items, chat) {
			if a == nil || !a.Idle.IsZero() {
				st.KeepArm[chat] = &keepArm{}
				changed = true
			}
			continue
		}
		switch {
		case a == nil:
		case a.Idle.IsZero():
			a.Idle = now
			changed = true
		case now.Sub(a.Idle) >= keepRunningAfter:
			if leadAutowake(e, chat, "持续推进", keepRunningPrompt(), 0) {
				delete(st.KeepArm, chat)
				changed = true
			}
		}
	}
	return changed
}

func stuckLeadPrompt(it teamTaskBoardItem, why string) string {
	where := ""
	if it.wsName != "" {
		where = "（" + it.wsName + "）"
	}
	return fmt.Sprintf("[卡住唤醒] 本频道任务板 #%d【%s】%s卡住了：%s。这条没贴给用户。\n"+
		"你是主角色，这一轮把它接上：看工作区在干什么，干完没交回就催它交，卡在环境或外部就换路或改派，确实做不下去就派下一件。"+
		"用户叫停的、要花钱部署重启的先问用户。处理完一两句说清你怎么办的；确实不用动就回 NO_REPLY。", it.ID, teamTaskBoardShort(it), where, why)
}

// wakeStuckLeads wakes the lead once for each item that went stuck (per binding); reports
// whether st changed.
func (e *Engine) wakeStuckLeads(st *teamChatState, items []teamTaskBoardItem, now time.Time) bool {
	changed := false
	for _, it := range items {
		if it.Backlog != "" || it.Probe {
			continue
		}
		state, why := teamTaskBoardStateOf(it, now)
		if state != teamTaskStuck {
			continue
		}
		key := fmt.Sprintf("%d@s%s", it.ID, it.Bound)
		if _, ok := st.StuckWoke[key]; ok {
			continue
		}
		chat := e.leadChatOf(it)
		if chat == "" || !leadAutowake(e, chat, fmt.Sprintf("卡住唤醒 #%d", it.ID), stuckLeadPrompt(it, why), it.ID) {
			continue
		}
		if st.StuckWoke == nil {
			st.StuckWoke = map[string]time.Time{}
		}
		st.StuckWoke[key] = now
		changed = true
	}
	return changed
}

// leadChatOf: the chat (not a workspace) an item is shown on, where its lead talks with the user.
func (e *Engine) leadChatOf(it teamTaskBoardItem) string {
	for _, c := range it.chats() {
		if _, isWS := e.workspaceOwner(teamChannelID(c)); !isWS {
			return c
		}
	}
	return ""
}
