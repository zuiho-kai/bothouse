package opencode

import "github.com/chenhg5/cc-connect/core"

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

func (a *Agent) activeProviderKey() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.activeProviderKeyLocked()
}

func (a *Agent) configuredModels() []core.ModelOption {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return core.GetProviderModels(a.providers, a.activeIdx)
}

func (a *Agent) persistentModels() []core.ModelOption {
	return a.persistentModelsForSnapshot(a.modelDiscoverySnapshot())
}
