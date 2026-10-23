package core

import "errors"

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
		return nil, errors.New("task reporter requires a relay binding")
	}
	return e.relayManager.ResolveTaskReporter(e.name, project, platform, session)
}

// ResolveTaskReporter selects a real engine/platform, never a caller's display
// name. Both bots must be registered and bound in the task's original channel.
func (rm *RelayManager) ResolveTaskReporter(source, project, platform, session string) (TaskCardPublisher, error) {
	name, chat, err := parseSessionKeyParts(session)
	if err != nil || name != platform {
		return nil, errors.New("task reporter session platform mismatch")
	}
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	binding := rm.bindings[chat]
	target := rm.engines[project]
	if rm.engines[source] == nil || target == nil || target.ctx == nil || target.ctx.Err() != nil {
		return nil, errors.New("task reporter engine unavailable")
	}
	if binding == nil || binding.Platform != platform {
		return nil, errors.New("task reporter is not bound in this channel")
	}
	if _, ok := binding.Bots[source]; !ok {
		return nil, errors.New("task creator is not bound in this channel")
	}
	if _, ok := binding.Bots[project]; !ok {
		return nil, errors.New("task reporter is not bound in this channel")
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
