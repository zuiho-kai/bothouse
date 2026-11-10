package antigravity

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/chenhg5/cc-connect/agent/antigravityhook"
	"github.com/chenhg5/cc-connect/core"
)

// Mid-turn input (#1317): a message sent while agy runs a turn joins that turn through the role's
// inbox hook (antigravityhook.Inbox) instead of waiting in the queue for the next turn.

var (
	_ core.MidTurnSender = (*antigravitySession)(nil)
	_ core.MidTurnSender = (*streamSession)(nil)
)

// SupportsMidTurnInput (core gate): agy turns take mid-turn input through the inbox hook. A session
// whose inbox could not be set up refuses it in SendMidTurn, and the message is queued.
func (a *Agent) SupportsMidTurnInput() bool { return antigravityhook.InboxSupported() }

// inboxHookExe is the bothouse binary the hook runs (a test points it at a built binary).
var inboxHookExe = os.Executable

// setupInbox installs the role's inbox hook and creates this session's inbox; the returned env
// entry goes into the agy process environment. nil when unsupported or on failure (logged).
func setupInbox(workDir string) (*antigravityhook.Inbox, string) {
	if !antigravityhook.InboxSupported() || workDir == "" {
		return nil, ""
	}
	exe, err := inboxHookExe()
	if err != nil {
		slog.Warn("antigravity: mid-turn input off: no executable path", "error", err)
		return nil, ""
	}
	if err := ensureInboxHook(workDir, exe); err != nil {
		slog.Warn("antigravity: mid-turn input off: hook not installed", "work_dir", workDir, "error", err)
		return nil, ""
	}
	inbox, err := antigravityhook.NewInbox(filepath.Join(workDir, ".cc-connect", "agy-inbox"))
	if err != nil {
		slog.Warn("antigravity: mid-turn input off: inbox not created", "error", err)
		return nil, ""
	}
	return inbox, antigravityhook.EnvInbox + "=" + inbox.Dir
}

// inboxHookFile is agy's workspace hook file (the same file bothouse's guard hooks use).
func inboxHookFile(workDir string) string { return filepath.Join(workDir, ".agents", "hooks.json") }

// inboxHookSpec is the hooks.json entry for the inbox hook. Outside a bothouse agy process (no
// EnvInbox) or with an empty inbox, the shell answers "go on" without starting bothouse.
func inboxHookSpec(exe string) map[string]any {
	q := shellQuote(exe)
	pre := `[ -n "$` + antigravityhook.EnvInbox + `" ] && [ -x ` + q + ` ] && ls "$` + antigravityhook.EnvInbox + `"/*.msg >/dev/null 2>&1 || { echo '{}'; exit 0; }; exec ` + q + " " + antigravityhook.InboxHookArg + " PreInvocation"
	stop := `[ -n "$` + antigravityhook.EnvInbox + `" ] && [ -x ` + q + ` ] || { echo '{"decision":"allow"}'; exit 0; }; exec ` + q + " " + antigravityhook.InboxHookArg + " Stop"
	return map[string]any{
		"PreInvocation": []any{map[string]any{"type": "command", "command": pre, "timeout": 10}},
		"Stop":          []any{map[string]any{"type": "command", "command": stop, "timeout": 10}},
	}
}

// ensureInboxHook writes the inbox hook into the role's hooks.json, keeping every other entry.
func ensureInboxHook(workDir, exe string) error {
	path := inboxHookFile(workDir)
	hooks := map[string]json.RawMessage{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &hooks); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		if hooks == nil {
			hooks = map[string]json.RawMessage{}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	want, err := json.Marshal(inboxHookSpec(exe))
	if err != nil {
		return err
	}
	if old, ok := hooks[antigravityhook.InboxHookName]; ok && jsonEqual(old, want) {
		return nil
	}
	hooks[antigravityhook.InboxHookName] = want
	data, err := json.MarshalIndent(hooks, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func jsonEqual(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return string(xa) == string(ya)
}

// openInbox starts a turn's inbox (clears the "turn ended" mark of the previous turn).
func (as *antigravitySession) openInbox() {
	if as.inbox == nil {
		return
	}
	if n := as.inbox.Pending(); n > 0 {
		slog.Info("antigravity: mid-turn messages left from the last turn go into this one", "count", n)
	}
	if err := as.inbox.Open(); err != nil {
		slog.Warn("antigravity: open mid-turn inbox", "error", err)
	}
}

// putMidTurn writes one mid-turn message (attachments saved like a turn's, without the turn's
// standing instructions: the running turn's prompt carried them).
func (as *antigravitySession) putMidTurn(prompt string, images []core.ImageAttachment, files []core.FileAttachment) error {
	if as.inbox == nil {
		return fmt.Errorf("antigravity: mid-turn input unavailable")
	}
	text, saved := as.attachRefs(prompt, images, files)
	core.ArchiveAttachments(append([]string(nil), saved...))
	if err := as.inbox.Put(text); err != nil {
		return fmt.Errorf("antigravity: mid-turn input: %w", err)
	}
	return nil
}

// SendMidTurn (core.MidTurnSender) joins the running turn, or fails so core queues the message.
func (as *antigravitySession) SendMidTurn(prompt, _ string, images []core.ImageAttachment, files []core.FileAttachment) error {
	if !as.alive.Load() {
		return fmt.Errorf("antigravity: session is closed")
	}
	as.runMu.Lock()
	running := as.run != nil
	as.runMu.Unlock()
	if !running {
		return fmt.Errorf("antigravity: no turn running")
	}
	return as.putMidTurn(prompt, images, files)
}

// SendMidTurn for the persistent stream transport: a turn is running while busy.
func (s *streamSession) SendMidTurn(prompt, _ string, images []core.ImageAttachment, files []core.FileAttachment) error {
	s.mu.Lock()
	busy := s.busy && s.Alive()
	s.mu.Unlock()
	if !busy {
		return fmt.Errorf("antigravity: no stream turn running")
	}
	return s.putMidTurn(prompt, images, files)
}
