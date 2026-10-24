package cloudweb

import (
	"net/url"
	"regexp"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

// A line opening with this bot's name ("龙娘，…") calls it like an @, the same rule as Discord
// (platform/discord discord.go: core.NameCalled for people and teammate bots). The gateway may mark
// such a message mentioned itself, but not every gateway does for every sender (rh/cloudweb.py only
// for bots), so the platform also checks — and does so before the lead-return context is worked out,
// or a lead's name-call dispatch hands nothing back (the Discord bug fixed in #248).

// teamPlatforms: every cloud_web platform running in this process, so "龙娘、橘，…" is read as
// calling both (same as platform/discord teamBotNames).
var teamPlatforms sync.Map // *Platform → struct{}

// hubBotName is the name the hub shows for this bot: ws_url ?name=, else ?bot= (rh/cloudweb.py
// 文件头「连接」; core/setup_cloudweb.go cloudWebBotURL leaves name out when it equals the project).
func hubBotName(wsURL string) string {
	u, err := url.Parse(strings.TrimSpace(wsURL))
	if err != nil {
		return ""
	}
	if n := strings.TrimSpace(u.Query().Get("name")); n != "" {
		return n
	}
	return strings.TrimSpace(u.Query().Get("bot"))
}

func (p *Platform) teamNames() []string {
	var names []string
	teamPlatforms.Range(func(k, _ any) bool {
		if o, _ := k.(*Platform); o != nil && o != p && o.botName != "" {
			names = append(names, o.botName)
		}
		return true
	})
	return names
}

// botLabelRe is the 【名字】 the gateway puts before a teammate bot's text (rh/cloudweb.py on_new).
var botLabelRe = regexp.MustCompile(`^【[^】\n]*】`)

func (p *Platform) calledByName(m wireInboundMessage) bool {
	if p.botName == "" {
		return false
	}
	text := strings.TrimSpace(m.Content)
	if m.FromBot {
		text = botLabelRe.ReplaceAllString(text, "")
	}
	return core.NameCalled(text, p.botName, p.teamNames()...)
}
