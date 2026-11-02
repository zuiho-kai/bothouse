package core

import (
	"errors"
)

// ErrTaskFactUndeliverable marks a permanent refusal (e.g. Discord 403/404)
// to publish a fact with a given account. Retrying cannot succeed, so the
// creator posts a visible note instead and later facts keep flowing.
var ErrTaskFactUndeliverable = errors.New("task fact permanently undeliverable")

// taskReporter is also the task-relay integration seam: resolve req.To before
// recording an assignment, then persist it on each deliberately public event.
// Missing worker configuration never falls back to the creator's account.
func (p *PublicProgress) taskReporter(project, platform, session string, creator TaskCardPublisher) (TaskCardPublisher, error) {
	if project == "" || project == p.project {
		return creator, nil
	}
	if p.resolveReporter == nil {
		return nil, errors.New("task reporter resolver unavailable")
	}
	return p.resolveReporter(project, platform, session)
}

func (e *Engine) resolveTaskReporter(project, platform, session string) (TaskCardPublisher, error) {
	if e.relayManager == nil {
		return nil, &notBoundError{project: project}
	}
	return e.relayManager.ResolveTaskReporter(e.name, project, platform, session)
}

// ResolveTaskReporter selects a real engine/platform, never a caller's display
// name. Both bots must be registered and bound in the channel that will receive
// the task: the card's channel (the source workspace, or the execution
// workspace for a chat-channel source) and, for a cross-workspace dispatch, the
// execution workspace too.
func (rm *RelayManager) ResolveTaskReporter(source, project, platform, session string) (TaskCardPublisher, error) {
	name, chat, err := parseSessionKeyParts(session)
	if err != nil || name != platform {
		return nil, errors.New("task reporter session platform mismatch")
	}
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	binding := rm.effectiveBindingForLocked(platform, chat, source)
	target := rm.engines[project]
	if rm.engines[source] == nil || target == nil || target.ctx == nil || target.ctx.Err() != nil {
		return nil, errors.New("task reporter engine unavailable")
	}
	if binding == nil || binding.Platform != platform {
		// Bindings are loaded with the relay manager, so this is permanent
		// (e.g. runtime `/bind -<worker>`), not a startup race: retrying
		// would block every later fact of the card.
		return nil, &notBoundError{project: project, permanent: true}
	}
	if _, ok := binding.Bots[source]; !ok {
		return nil, &notBoundError{project: source}
	}
	if _, ok := binding.Bots[project]; !ok {
		// Bindings are loaded with the relay manager, so this is permanent
		// (e.g. runtime `/bind -<worker>`), not a startup race: retrying
		// would block every later fact of the card.
		return nil, &notBoundError{project: project, permanent: true}
	}
	for _, candidate := range target.platforms {
		if candidate.Name() != platform {
			continue
		}
		sink, ok := candidate.(TaskCardPublisher)
		if !ok {
			return nil, errors.New("task reporter platform cannot publish task facts")
		}
		if _, err := sink.TaskCardDestination(session); err != nil {
			return nil, errors.New("task reporter cannot address this session")
		}
		return sink, nil
	}
	return nil, errors.New("task reporter platform unavailable")
}

// taskReporterName is project's bot name as bound in session's channel, or "".
// A binding made by /bind stores the project id as the name; then the project's
// configured name (team_name) is used instead.
func (e *Engine) taskReporterName(project, session string) string {
	if e.relayManager != nil {
		if name := e.relayManager.BoundBotName(project, session); name != "" && name != project {
			return name
		}
	}
	return e.projectDisplayName(project)
}

// BoundBotName is the display name the channel binding gives project's bot, or "".
func (rm *RelayManager) BoundBotName(project, session string) string {
	_, chat, err := parseSessionKeyParts(session)
	if err != nil {
		return ""
	}
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	if b := rm.bindings[chat]; b != nil {
		return b.Bots[project]
	}
	return ""
}

// projectDisplayName is a configured project's name for people (Engine.DisplayName:
// team_name, else the project id), or "" when no such project runs in this process.
func (e *Engine) projectDisplayName(project string) string {
	if project == e.name {
		return e.DisplayName()
	}
	if e.relayManager == nil {
		return ""
	}
	e.relayManager.mu.RLock()
	target := e.relayManager.engines[project]
	e.relayManager.mu.RUnlock()
	if target == nil {
		return ""
	}
	return target.DisplayName()
}

// displayNames replaces project ids on a card snapshot with the projects' names for
// people: the executor (Task.Agent) and bot member rows whose name fell back to the
// id (also rows stored before names were resolved). Unknown projects keep the id.
// Only the outgoing snapshot changes; the stored record keeps its ids.
func (p *PublicProgress) displayNames(t *Task) {
	if t == nil || p.projectName == nil {
		return
	}
	if name := p.projectName(t.Agent); name != "" {
		t.Agent = name
	}
	for i := range t.Members {
		m := &t.Members[i]
		if m.ReporterProject == "" || m.Name != m.ReporterProject {
			continue
		}
		if name := p.projectName(m.ReporterProject); name != "" {
			m.Name = name
		}
	}
}
