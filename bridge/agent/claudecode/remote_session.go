package claudecode

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

type remoteClaudeConfig struct {
	remoteHost       string
	relayHost        string
	sshArgs          []string
	cliBin           string
	cliExtraArgs     []string
	model            string
	effort           string
	systemPrompt     string
	appendPrompt     string
	allowedTools     []string
	disallowedTools  []string
	pluginDirs       []string
	extraEnv         []string
	disableVerbose   bool
	maxContextTokens int
	voiceStream      bool
}

func newRemoteClaudeSession(
	ctx context.Context,
	remoteHost, relayHost string,
	sshArgs []string,
	workDir, cliBin string,
	cliExtraArgs []string,
	model, effort, sessionID, mode, systemPrompt, appendSystemPrompt string,
	allowedTools, disallowedTools, pluginDirs, extraEnv []string,
	platformPrompt string,
	disableVerbose bool,
	maxContextTokens int,
	voiceStream bool,
) *claudeSession {
	sessionCtx, cancel := context.WithCancel(ctx)
	cs := &claudeSession{
		events:  make(chan core.Event, 64),
		workDir: workDir,
		ctx:     sessionCtx,
		cancel:  cancel,
		done:    make(chan struct{}),
		remoteCfg: &remoteClaudeConfig{
			remoteHost:       strings.TrimSpace(remoteHost),
			relayHost:        strings.TrimSpace(relayHost),
			sshArgs:          append([]string(nil), sshArgs...),
			cliBin:           cliBin,
			cliExtraArgs:     append([]string(nil), cliExtraArgs...),
			model:            model,
			effort:           effort,
			systemPrompt:     systemPrompt,
			appendPrompt:     buildAppendSystemPrompt(core.AgentSystemPrompt(), platformPrompt, appendSystemPrompt),
			allowedTools:     append([]string(nil), allowedTools...),
			disallowedTools:  append([]string(nil), disallowedTools...),
			pluginDirs:       append([]string(nil), pluginDirs...),
			extraEnv:         append([]string(nil), extraEnv...),
			disableVerbose:   disableVerbose,
			maxContextTokens: maxContextTokens,
			voiceStream:      voiceStream,
		},
	}
	cs.setPermissionMode(mode)
	cs.sessionID.Store(sessionID)
	cs.alive.Store(true)
	return cs
}

func (cs *claudeSession) buildRemoteTurnArgs(prompt string) []string {
	cfg := cs.remoteCfg
	args := make([]string, 0, len(cfg.cliExtraArgs)+24)
	args = append(args, cfg.cliExtraArgs...)
	args = append(args, "-p", prompt, "--output-format", "stream-json")
	if cfg.voiceStream {
		args = append(args, "--include-partial-messages")
	}
	if !cfg.disableVerbose {
		args = append(args, "--verbose")
	}
	permMode := cs.permissionModeValue()
	if permMode == "" || permMode == "default" {
		// Remote print-mode turns cannot present a bridge approval card.
		permMode = "dontAsk"
	}
	args = append(args, "--permission-mode", permMode)
	if sid := cs.CurrentSessionID(); sid != "" && sid != core.ContinueSession {
		args = append(args, "--resume", sid)
	}
	if cfg.model != "" {
		args = append(args, "--model", cfg.model)
	}
	if cfg.effort != "" {
		args = append(args, "--effort", cfg.effort)
	}
	if cfg.maxContextTokens > 0 {
		args = append(args, "--max-context-tokens", strconv.Itoa(cfg.maxContextTokens))
	}
	if len(cfg.allowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(cfg.allowedTools, ","))
	}
	if len(cfg.disallowedTools) > 0 {
		args = append(args, "--disallowedTools", strings.Join(cfg.disallowedTools, ","))
	}
	for _, dir := range cfg.pluginDirs {
		args = append(args, "--plugin-dir", dir)
	}
	if cfg.systemPrompt != "" {
		args = append(args, "--system-prompt", cfg.systemPrompt)
	}
	return args
}

func (cs *claudeSession) sendRemote(prompt string) error {
	cs.remoteTurnMu.Lock()
	defer cs.remoteTurnMu.Unlock()
	if !cs.alive.Load() {
		return fmt.Errorf("session process is not running")
	}
	if cs.remoteTurnCancel != nil {
		return fmt.Errorf("remote Claude Code turn is already running")
	}
	cs.takeAPIErrorFallback()
	cs.interrupting.Store(false)
	turnCtx, turnCancel := context.WithCancel(cs.ctx)
	cs.remoteTurnCancel = turnCancel
	cs.remoteWg.Add(1)
	go func() {
		defer cs.remoteWg.Done()
		defer turnCancel()

		args := cs.buildRemoteTurnArgs(prompt)
		script := core.BuildRemoteDuccScript(
			cs.remoteCfg.cliBin,
			cs.workDir,
			args,
			cs.remoteCfg.appendPrompt,
			cs.remoteCfg.extraEnv,
		)
		var result map[string]any
		err := core.StreamRemoteScript(turnCtx, core.SSHExecConfig{
			RemoteHost: cs.remoteCfg.remoteHost,
			RelayHost:  cs.remoteCfg.relayHost,
			SSHArgs:    cs.remoteCfg.sshArgs,
		}, script, func(line string) {
			var event map[string]any
			if json.Unmarshal([]byte(line), &event) == nil && event["type"] == "result" && !isCompactionResult(event) {
				result = event
				return
			}
			cs.handleReadLoopLine(line)
		})

		cs.remoteTurnMu.Lock()
		interrupted := cs.interrupting.Load()
		cs.remoteTurnCancel = nil
		cs.remoteTurnMu.Unlock()

		if cs.ctx.Err() != nil {
			return
		}
		if !interrupted && result != nil {
			cs.handleResult(result)
			return
		}
		if cs.takeAPIErrorFallback() && !interrupted {
			return
		}
		switch {
		case interrupted:
			err = fmt.Errorf("cancelled")
		case err != nil:
			err = fmt.Errorf("claudecode remote (%s): %w", cs.remoteCfg.remoteHost, err)
		default:
			err = fmt.Errorf("claudecode remote (%s) exited without a result", cs.remoteCfg.remoteHost)
		}
		select {
		case cs.events <- core.Event{Type: core.EventError, Error: err}:
		case <-cs.ctx.Done():
		}
	}()
	return nil
}

func (cs *claudeSession) cancelRemoteTurn() error {
	cs.remoteTurnMu.Lock()
	defer cs.remoteTurnMu.Unlock()
	if cs.remoteTurnCancel != nil {
		cs.interrupting.Store(true)
		cs.remoteTurnCancel()
	}
	return nil
}

func (cs *claudeSession) closeRemote() error {
	cs.remoteCloseOnce.Do(func() {
		cs.remoteTurnMu.Lock()
		cs.alive.Store(false)
		cs.cancel()
		cs.remoteTurnMu.Unlock()
		cs.remoteWg.Wait()
		cs.closeSubTasks()
		close(cs.events)
		close(cs.done)
	})
	return nil
}
