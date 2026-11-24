package core

import (
	"crypto/sha256"
	"encoding/hex"
)

// The one exit for every block the bridge puts before a message (#1903, user 2026-11-23「搞统一的
// 管理，然后就只发第一遍，最后二三轮n只是根据记忆论坛搜出来的标题」). Before this each block decided by
// itself how often it went, so every new block went every turn until someone noticed (10-30 fixed
// the team rules and missed the model-control instructions; 11-23 the life page, identity and
// delegation policy were still on every turn).
//
// injectBlock sends a block once per agent context: a new session, a switched agent session or a
// compaction (ResetTurnCtx) sends it again, and so does a block whose key changed. Only the blocks
// in injectEveryTurn may go on every turn; TestInjectEveryTurnLocked pins that list, so a new
// per-turn block is a deliberate change to the test, never the default.

// injectEveryTurn: block name → why it cannot be once per context.
var injectEveryTurn = map[string]string{
	"turn_ctx":        "本轮消息从记忆论坛搜出的标题，每轮按消息重搜",
	"subagent_source": "这条是 bot/定时发的，不能算人授权开子 agent；只在这种轮附一句",
}

// injectEvents: blocks that are events, not repeats. Each is built from something that happened
// since the last turn and is cleared once sent, by its own take/settle; withTurnBlocksRef passes
// them through. The channel backfill (backfill.go) is the same kind and is part of the message.
var injectEvents = map[string]string{
	"reply_task":   "回复引用的那件活的背景，每件活每会话一次",
	"outbound":     "上一轮以来往外发过的消息，有才发、发过即清",
	"lead_handoff": "主角色交接记录，换会话后发一次",
	"handoff":      "旧会话交接，换会话后发一次",
	"memory":       "记忆目录，新会话第一轮发一次",
	"interrupted":  "上一轮被打断的提示，有才发、发过即清",
}

// injectFixedKey: blocks sent once per context even when their text changes later: the life page
// is mostly edited by the role itself, and the teammate status changes all the time (#1903 C, A).
var injectFixedKey = map[string]bool{"life_page": true, "team": true}

// injectBlock returns text when this delivery must carry the block called name, else "". A block
// goes again when its text changed (rules: an edited file reaches the context on its next turn),
// except the injectFixedKey ones. A nil session gets the block on every delivery.
func (e *Engine) injectBlock(session *Session, name, text string) string {
	if text == "" {
		return ""
	}
	if _, every := injectEveryTurn[name]; every || session == nil {
		return text
	}
	key := "1"
	if !injectFixedKey[name] {
		sum := sha256.Sum256([]byte(text))
		key = hex.EncodeToString(sum[:8])
	}
	if !session.takeOnce(name, key) {
		return ""
	}
	return text
}

// takeOnce marks the block name as sent with key in this agent context; false when it already was.
// SettleHandoff puts the old mark back when the delivery carrying it never reached the agent.
func (s *Session) takeOnce(name, key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.TurnCtx == nil {
		s.TurnCtx = &TurnCtxSent{}
	}
	old, had := s.TurnCtx.Once[name]
	if had && old == key {
		return false
	}
	if s.TurnCtx.Once == nil {
		s.TurnCtx.Once = map[string]string{}
	}
	if s.onceTaken == nil {
		s.onceTaken = map[string]string{}
	}
	if _, taken := s.onceTaken[name]; !taken {
		s.onceTaken[name] = old
	}
	s.TurnCtx.Once[name] = key
	return true
}

// settleOnce keeps the blocks this turn marked as sent when it was delivered, else restores the
// marks it replaced. Called with s.mu held (SettleHandoff).
func (s *Session) settleOnceLocked(delivered bool) {
	if !delivered && s.TurnCtx != nil {
		for name, old := range s.onceTaken {
			if old == "" {
				delete(s.TurnCtx.Once, name)
			} else {
				s.TurnCtx.Once[name] = old
			}
		}
	}
	s.onceTaken = nil
}

// TurnPreambleAgent is optional for an Agent whose CLI takes no native system prompt and needs
// standing instructions in its prompt (acp: model control; antigravity: model control and the task
// lifecycle). The engine sends the text once per agent context through injectBlock, like every
// other block, instead of the agent prepending it to each prompt.
type TurnPreambleAgent interface {
	TurnPreamble() string
}

func agentPreamble(agent Agent) string {
	if p, ok := agent.(TurnPreambleAgent); ok {
		return p.TurnPreamble()
	}
	return ""
}
