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

// SetMentionAssigner wires the project's mention_assigner switch (#2089); off is the default.
func (e *Engine) SetMentionAssigner(on bool) { e.mentionAssignerOn.Store(on) }

// mentionAssignerEnabled: the lead project's mention_assigner switch; a worker returning a result
// obeys the same switch as the team lead (taskForumPeers).
func (e *Engine) mentionAssignerEnabled() bool {
	if e.team != nil {
		for _, peer := range e.taskForumPeers() {
			if peer.isTeamLead() {
				return peer.mentionAssignerOn.Load()
			}
		}
	}
	return e.mentionAssignerOn.Load()
}

// assignerUser is the platform user to notify for item: the assigner when a person set it; when a
// bot, a timer or the local API did, the owner — the first user ID in admin_from (as send --dm),
// else the first in p's allow_from (PlatformOwner; this machine's lead has only allow_from).
// "" while mention_assigner is off (#2089), for a row written before the field existed, or with no
// owner configured.
func (e *Engine) assignerUser(p Platform, item *teamTaskBoardItem) string {
	if !e.mentionAssignerEnabled() || item == nil || item.Assigner == nil {
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

// prepareAssignerMention resolves item's assigner mention for a release post in sessionKey,
// suppressing a duplicate ping when the same bot already notified that user for this task within
// humanMentionDedupWindow (#2091). Returns the rendered text and the user ID allowed to notify
// ("" when mention_assigner is off, no assigner exists, or dedup suppressed it).
func (e *Engine) prepareAssignerMention(p Platform, sessionKey string, item *teamTaskBoardItem, text string) (string, string) {
	if p == nil {
		return text, ""
	}
	user := e.assignerUser(p, item)
	if user == "" {
		return text, ""
	}
	taskID := 0
	if item != nil {
		taskID = item.ID
	}
	if e.isHumanMentionDeduped(sessionKey, user, taskID) {
		return text, ""
	}
	if m := watchMention(p.Name(), user); m != "" {
		return m + " " + text, user
	}
	return text, ""
}

// prepareAssignerMentionFor is prepareAssignerMention for a message sent to sessionKey that
// delivers the result of board item id (ws-pass posting the finished files, #988 / #2091).
func (e *Engine) prepareAssignerMentionFor(sessionKey string, id int, text string) (string, string) {
	name, _, err := parseSessionKeyParts(sessionKey)
	if err != nil {
		return text, ""
	}
	return e.prepareAssignerMention(e.platformForName(name), sessionKey, e.boardItemByID(id), text)
}
