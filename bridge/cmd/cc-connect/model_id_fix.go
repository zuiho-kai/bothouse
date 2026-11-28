package main

import (
	"context"
	"log/slog"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// fixDisplayNameModels (#2113): configs written before the wizard checked models can hold a
// display name ("Opus 4.7") where the relay wants its ID (claude-opus-4-7); every turn then fails
// with model_not_found. At project start each such model is looked up in the endpoint's model list
// and the ID is used and written back. One without a match stays and is logged as an error saying
// what to write instead. Only models with a space are touched, so a normal start makes no request.
func fixDisplayNameModels(proj *config.ProjectConfig) {
	ctx := context.Background()
	for i := range proj.Agent.Providers {
		p := &proj.Agent.Providers[i]
		if !core.LooksLikeDisplayName(p.Model) {
			continue
		}
		id, err := core.ResolveModelID(ctx, p.BaseURL, p.APIKey, p.Model)
		if err != nil {
			slog.Error("provider model is a display name, not a model ID; the API will reject it", "project", proj.Name, "provider", p.Name, "model", p.Model, "error", err)
			continue
		}
		slog.Warn("provider model was a display name; using the model ID", "project", proj.Name, "provider", p.Name, "from", p.Model, "to", id)
		p.Model = id
		if err := config.SaveProviderModel(proj.Name, p.Name, id); err != nil {
			slog.Warn("could not write the model ID back to config", "project", proj.Name, "provider", p.Name, "error", err)
		}
	}
	model, _ := proj.Agent.Options["model"].(string)
	if !core.LooksLikeDisplayName(model) {
		return
	}
	var base, key string
	active, _ := proj.Agent.Options["provider"].(string)
	for i, p := range proj.Agent.Providers {
		if p.Name == active || (active == "" && i == 0) {
			base, key = p.BaseURL, p.APIKey
		}
	}
	id, err := core.ResolveModelID(ctx, base, key, model)
	if err != nil {
		slog.Error("agent model is a display name, not a model ID; the API will reject it", "project", proj.Name, "model", model, "error", err)
		return
	}
	slog.Warn("agent model was a display name; using the model ID", "project", proj.Name, "from", model, "to", id)
	opts := make(map[string]any, len(proj.Agent.Options))
	for k, v := range proj.Agent.Options {
		opts[k] = v
	}
	opts["model"] = id
	proj.Agent.Options = opts
	if err := config.SaveAgentModel(proj.Name, id); err != nil {
		slog.Warn("could not write the model ID back to config", "project", proj.Name, "error", err)
	}
}
