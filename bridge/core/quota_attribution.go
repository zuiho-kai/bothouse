package core

import (
	"encoding/json"
	"fmt"
	"strings"
)

// botLabel names this bot and the model of the failed turn, e.g. "Bot (model)",
// so a quota or error notice in a shared channel is attributed to the right bot.
func (e *Engine) botLabel(session AgentSession, agent Agent) string {
	name := e.exitBotName()
	if agent == nil {
		agent = e.agent
	}
	if model := replyFooterModel(session, agent); model != "" {
		if name == "" {
			return model
		}
		return name + " (" + model + ")"
	}
	return name
}

// quotaExhaustedMessage words the notice for a turn the adapter marked with
// MetaQuotaExhausted: which bot/model ran out and, if known, when it resets.
func (e *Engine) quotaExhaustedMessage(reset string, session AgentSession, agent Agent) string {
	label := e.botLabel(session, agent)
	if reset = strings.TrimSpace(reset); reset != "" {
		return e.i18n.Tf(MsgQuotaExhaustedResets, label, reset)
	}
	return e.i18n.Tf(MsgQuotaExhausted, label)
}

// agentErrorMessage formats a generic agent error for the chat, prefixed with
// this bot's name so it is not blamed on another bot in the channel.
func (e *Engine) agentErrorMessage(detail any) string {
	// Only the bot name here: the model belongs to the footer, which follows
	// the display settings.
	msg := fmt.Sprintf(e.i18n.T(MsgError), detail)
	if name := e.exitBotName(); name != "" {
		msg = "[" + name + "] " + msg
	}
	return msg
}

// displayModelName renders a model value for the footer. Some agents report
// the model as a JSON array such as ["provider","model"]; show it as
// "provider/model" instead of the raw JSON.
func displayModelName(model string) string {
	model = strings.TrimSpace(model)
	if !strings.HasPrefix(model, "[") {
		return model
	}
	var parts []string
	if err := json.Unmarshal([]byte(model), &parts); err != nil {
		return model
	}
	out := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, "/")
}
