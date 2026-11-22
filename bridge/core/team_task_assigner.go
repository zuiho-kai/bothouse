package core

// #988: the person who set a task gets the task's result and its questions (user 11-22 「以后谁布置的
// 任务 需要拍板或者做完了要@他一下 通知一下，就是@真人」, 11-23 「我只关心用户 也就是说真人角色能得到反馈
// 就是结果或者需要拍板」). ws-handoff writes the sender of the turn that handed the task off (bothouse
// identity show, signed by the bridge) to the board row; the report post and the question call read it.

// teamTaskAssigner: who set the task, as the bridge recorded the turn's sender (callerKindOf).
type teamTaskAssigner struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // CallerHuman, CallerBot, CallerScheduled, CallerLocal
}

// PlatformOwner is a platform that names its owner from its own config: the first user ID in its
// allow_from (the setup wizard writes the owner's ID into an empty allow_from; on this machine the
// lead's Discord allow_from starts with the owner and the lead has no admin_from).
type PlatformOwner interface {
	OwnerUserID() string
}

// assignerUser is the platform user to notify for item: the assigner when a person set it; when a
// bot, a timer or the local API did, the owner — the first user ID in admin_from (as send --dm),
// else the first in p's allow_from (PlatformOwner; this machine's lead has only allow_from).
// "" for a row written before the field existed, or with no owner configured.
func (e *Engine) assignerUser(p Platform, item *teamTaskBoardItem) string {
	if item == nil || item.Assigner == nil {
		return ""
	}
	if item.Assigner.Kind == CallerHuman && item.Assigner.ID != "" {
		return item.Assigner.ID
	}
	if u := e.dmUser(); u != "" {
		return u
	}
	if o, ok := p.(PlatformOwner); ok {
		return o.OwnerUserID()
	}
	return ""
}

// withAssignerMention puts the platform mention of item's assigner (assignerUser) at the start of
// text; text unchanged when there is no one to notify.
func (e *Engine) withAssignerMention(p Platform, item *teamTaskBoardItem, text string) string {
	if m := watchMention(p.Name(), e.assignerUser(p, item)); m != "" {
		return m + " " + text
	}
	return text
}

// withAssignerMentionFor is withAssignerMention for a message sent to sessionKey that delivers the
// result of board item id (ws-pass posting the finished files, #988).
func (e *Engine) withAssignerMentionFor(sessionKey string, id int, text string) string {
	name, _, err := parseSessionKeyParts(sessionKey)
	if err != nil {
		return text
	}
	return e.withAssignerMention(e.platformForName(name), e.boardItemByID(id), text)
}
