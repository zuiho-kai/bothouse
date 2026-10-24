package core

import "strings"

// IsStopAllCommand reports whether text is the channel-wide stop command
// "/stop all". Platforms use it to let the command through even when the
// message does not mention this bot, so every bot in the channel sees it.
func IsStopAllCommand(text string) bool {
	fields := strings.Fields(strings.TrimSpace(text))
	return len(fields) == 2 && strings.EqualFold(fields[0], "/stop") && strings.EqualFold(fields[1], "all")
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

// cmdStopAll handles "/stop all": stop this bot's work in the whole channel.
func (e *Engine) cmdStopAll(p Platform, msg *Message) {
	if e.stopChannel(msg.Platform, msg.SessionKey) == 0 {
		// Stay quiet when idle so a multi-bot channel is not flooded with
		// "nothing running" replies from every bot.
		return
	}
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgExecutionStopped))
}
