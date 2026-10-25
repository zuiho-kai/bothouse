package core

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// IsStopAllCommand reports whether text is the channel-wide stop command
// "/stop all". Platforms use it to let the command through even when the
// message does not mention this bot, so every bot in the channel sees it.
func IsStopAllCommand(text string) bool {
	fields := strings.Fields(strings.TrimSpace(text))
	return len(fields) == 2 && strings.EqualFold(fields[0], "/stop") && strings.EqualFold(fields[1], "all")
}

// IsBareStopWord reports whether text is only a stop word (「停」「暂停」 stop …,
// see localStopWords) and not a reply to some message. Platforms use it,
// together with their own "no @, no reply" check, to let an unaddressed stop
// through to every bot in the channel, like "/stop all". A name or mention in
// the text ("肥鱼，停", "<@id> 停") does not match.
func IsBareStopWord(text string) bool {
	return !strings.HasPrefix(text, localReplyPrefix) && isLocalStopWord(text)
}

// isUnaddressedStop reports whether msg is a person's stop word that calls no
// bot: no @, no reply, not a private chat, not addressed to a teammate by name.
// It is handled like "/stop all": every bot stops its own work in the channel.
// "@A 停" keeps the single-bot path (applyLocalGate on the called bot).
// Only msg.StopAll counts: the platform sets it after its own "no @, no reply"
// check. Platforms that never fill Mentioned/Direct (weixin, qq, line …) do not
// set it, so a "停" in their private chats is not taken as a channel-wide stop.
func (e *Engine) isUnaddressedStop(msg *Message) bool {
	return msg.StopAll && !msg.FromBot && !msg.Mentioned && !msg.Direct && !msg.AddressedOther &&
		len(msg.Images) == 0 && len(msg.Files) == 0 && msg.Audio == nil && IsBareStopWord(msg.Content)
}

// sessionKeyChannel returns the "platform:channel" identity of an
// interactive-state key, which may carry a workspace prefix
// ("<workspace>:<platform>:<channel>[:<user>]").
func sessionKeyChannel(key, platform string) (string, bool) {
	if platform == "" {
		return "", false
	}
	prefix := platform + ":"
	idx := strings.LastIndex(key, prefix)
	for idx > 0 && key[idx-1] != ':' {
		idx = strings.LastIndex(key[:idx], prefix)
	}
	if idx < 0 {
		return "", false
	}
	ch := extractChannelID(key[idx:])
	if ch == "" {
		return "", false
	}
	return platform + ":" + ch, true
}

// stopChannel stops every interactive session of this engine that belongs to
// the same channel as sessionKey: the running turn is cancelled and pending
// permission requests are released. Other channels are left alone. It returns
// how many sessions were stopped. Each engine only stops its own sessions; in a
// multi-bot channel every bot receives "/stop all" and stops itself.
//
// A Discord thread has its own channel id, so a stop in a thread stops only that
// thread, and a stop in the parent channel leaves its threads running (decided
// 2026-10-25: a stop in a thread does not reach the parent channel).
func (e *Engine) stopChannel(platform, sessionKey string) int {
	target, ok := sessionKeyChannel(sessionKey, platform)
	if !ok {
		return 0
	}
	e.interactiveMu.Lock()
	var keys []string
	for k := range e.interactiveStates {
		if ch, ok := sessionKeyChannel(k, platform); ok && ch == target {
			keys = append(keys, k)
		}
	}
	for k := range e.nativeCompactions {
		if _, dup := e.interactiveStates[k]; dup {
			continue
		}
		if ch, ok := sessionKeyChannel(k, platform); ok && ch == target {
			keys = append(keys, k)
		}
	}
	e.interactiveMu.Unlock()

	stopped := 0
	for _, k := range keys {
		if e.stopInteractiveSessionWithOptions(k, true) {
			stopped++
		}
	}
	return stopped
}

// cmdStopAll handles "/stop all" and an unaddressed stop word: stop this bot's
// work in the whole channel.
func (e *Engine) cmdStopAll(p Platform, msg *Message) {
	if e.stopChannel(msg.Platform, msg.SessionKey) == 0 {
		// Stay quiet when idle so a multi-bot channel is not flooded with
		// "nothing running" replies from every bot.
		return
	}
	if !e.claimStopAck(msg) {
		return
	}
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgExecutionStopped))
}

const stopAckMaxAge = time.Hour

// claimStopAck makes sure only one bot confirms a channel-wide stop. Every bot
// that stopped something tries to create the same file under the shared data
// dir (the one holding lead.json); the one that creates it replies, the others
// stay quiet. With no data dir, no message id, or a file error other than
// "already exists", it returns true: a duplicate confirmation is better than none.
func (e *Engine) claimStopAck(msg *Message) bool {
	if e.dataDir == "" || msg.MessageID == "" {
		return true
	}
	ch, _ := sessionKeyChannel(msg.SessionKey, msg.Platform)
	if ch == "" {
		ch = msg.Platform
	}
	dir := filepath.Join(e.dataDir, "stop-ack")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slog.Debug("stop all: ack dir", "error", err)
		return true
	}
	name := strings.NewReplacer(":", "_", "/", "_", string(filepath.Separator), "_").Replace(ch + "_" + msg.MessageID)
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			return false
		}
		slog.Debug("stop all: ack claim", "error", err)
		return true
	}
	_ = f.Close()
	pruneStopAcks(dir, name)
	return true
}

// pruneStopAcks removes claim files older than stopAckMaxAge.
func pruneStopAcks(dir, keep string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-stopAckMaxAge)
	for _, ent := range entries {
		if ent.Name() == keep {
			continue
		}
		if info, err := ent.Info(); err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, ent.Name()))
		}
	}
}
