package feishu

// SelfMention identifies this role for assignment wakeups on Feishu and Lark.
func (p *Platform) SelfMention() string {
	id := p.getBotOpenID()
	if id == "" {
		return ""
	}
	return `<at user_id="` + id + `"></at>`
}
