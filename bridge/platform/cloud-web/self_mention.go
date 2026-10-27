package cloudweb

import "net/url"

// SelfMention uses the hub's configured mention alias, or its stable member ID.
func (p *Platform) SelfMention() string {
	p.liveMu.RLock()
	raw, _ := p.startOpts["ws_url"].(string)
	p.liveMu.RUnlock()
	if u, err := url.Parse(raw); err == nil {
		if id := u.Query().Get("mention_id"); id != "" {
			return "<@" + id + ">"
		}
	}
	return "@" + p.selfID
}
