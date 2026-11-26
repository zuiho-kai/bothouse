package core

import "time"

// EngineOptions is everything an Engine is wired with once, at startup.
// Settings a config reload may change keep their setters (applyProjectSettings
// in cmd/cc-connect); a new startup-only setting is a field here, not a new
// Set* method (TestEngineShapeRatchet counts them).
type EngineOptions struct {
	Name             string
	Agent            Agent
	Platforms        []Platform
	SessionStorePath string
	Lang             Language

	BaseWorkDir  string
	ProjectState *ProjectStateStore
	DataDir      string

	PublicProgress *PublicProgressOptions // nil: public progress stays off
	MultiWorkspace *MultiWorkspaceOptions // nil: single workspace
	Observe        *ObserveOptions        // nil: no terminal observation

	Shell         ShellOptions
	Hooks         *HookManager // nil: no hooks
	References    ReferenceRenderCfg
	StreamPreview StreamPreviewCfg

	Save EngineSaveFuncs
}

// PublicProgressOptions turns public progress on. A nil archive time keeps
// the default.
type PublicProgressOptions struct {
	ThreadArchiveAfter            *time.Duration
	ResultReadyThreadArchiveAfter *time.Duration
}

// MultiWorkspaceOptions turns on the upstream multi-workspace mode. Nil
// pointers keep the defaults.
type MultiWorkspaceOptions struct {
	BaseDir             string
	BindingStorePath    string
	InitAllowLocalPaths *bool
	IdleTimeout         *time.Duration
	SkipGit             *bool
}

// ObserveOptions mirrors a Claude Code project's terminal session into a chat.
type ObserveOptions struct {
	ProjectDir string
	SessionKey string
}

// ShellOptions is the shell /shell and exec commands run in.
type ShellOptions struct {
	Shell   string
	Flag    string
	Profile string
}

// EngineSaveFuncs write chat-made changes back to the config file.
type EngineSaveFuncs struct {
	CommandAdd func(name, description, prompt, exec, workDir string) error
	CommandDel func(name string) error
	AliasAdd   func(name, command string) error
	AliasDel   func(name string) error
	Display    func(mode *string, thinkingMessages *bool, thinkingMaxLen, toolMaxLen *int, toolMessages *bool) error
}

// NewEngineWithOptions builds an Engine and applies its startup wiring in the
// order the steps depend on each other: the data directory before public
// progress (it reads it), public progress before its archive times, the
// multi-workspace mode before its idle timeout. It returns the engine even
// with an error, so the caller can still stop what was started.
func NewEngineWithOptions(o EngineOptions) (*Engine, error) {
	e := NewEngine(o.Name, o.Agent, o.Platforms, o.SessionStorePath, o.Lang)
	e.SetBaseWorkDir(o.BaseWorkDir)
	e.SetProjectStateStore(o.ProjectState)
	e.SetDataDir(o.DataDir)
	if pp := o.PublicProgress; pp != nil {
		if err := e.EnablePublicProgress(); err != nil {
			return e, err
		}
		if pp.ThreadArchiveAfter != nil {
			e.SetPublicProgressThreadArchiveAfter(*pp.ThreadArchiveAfter)
		}
		if pp.ResultReadyThreadArchiveAfter != nil {
			e.SetPublicProgressResultReadyThreadArchiveAfter(*pp.ResultReadyThreadArchiveAfter)
		}
	}
	if mw := o.MultiWorkspace; mw != nil {
		e.SetMultiWorkspace(mw.BaseDir, mw.BindingStorePath)
		if mw.InitAllowLocalPaths != nil {
			e.SetWorkspaceInitAllowLocalPaths(*mw.InitAllowLocalPaths)
		}
		if mw.IdleTimeout != nil {
			e.SetWorkspaceIdleTimeout(*mw.IdleTimeout)
		}
		if mw.SkipGit != nil {
			e.SetSkipGit(*mw.SkipGit)
		}
	}
	if o.Observe != nil {
		e.SetObserveConfig(o.Observe.ProjectDir, o.Observe.SessionKey)
	}
	e.SetCommandSaveAddFunc(o.Save.CommandAdd)
	e.SetCommandSaveDelFunc(o.Save.CommandDel)
	e.SetAliasSaveAddFunc(o.Save.AliasAdd)
	e.SetAliasSaveDelFunc(o.Save.AliasDel)
	e.SetShell(o.Shell.Shell, o.Shell.Flag, o.Shell.Profile)
	if o.Hooks != nil {
		e.SetHooks(o.Hooks)
	}
	e.SetReferenceConfig(o.References)
	e.SetStreamPreviewCfg(o.StreamPreview)
	e.SetDisplaySaveFunc(o.Save.Display)
	return e, nil
}
