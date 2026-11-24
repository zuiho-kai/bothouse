package claudecode

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestNew_ParsesProjectEnvFromOpts(t *testing.T) {
	opts := map[string]any{
		"work_dir":    t.TempDir(),
		"run_as_user": "skip-lookpath",
		"env": map[string]string{
			"ANTHROPIC_BASE_URL":            "https://api.kimi.com/coding",
			"ANTHROPIC_AUTH_TOKEN":          "sk-kimi-test",
			"ANTHROPIC_MODEL":               "K2.6",
			"ANTHROPIC_REASONING_MODEL":     "K2.6",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL": "K2.6",
		},
	}

	a, err := New(opts)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	agent := a.(*Agent)
	agent.mu.Lock()
	defer agent.mu.Unlock()

	if len(agent.configEnv) != 5 {
		t.Fatalf("expected 5 env vars, got %d: %v", len(agent.configEnv), agent.configEnv)
	}

	envMap := envSliceToMap(agent.configEnv)
	if got := envMap["ANTHROPIC_BASE_URL"]; got != "https://api.kimi.com/coding" {
		t.Errorf("ANTHROPIC_BASE_URL = %q, want %q", got, "https://api.kimi.com/coding")
	}
	if got := envMap["ANTHROPIC_AUTH_TOKEN"]; got != "sk-kimi-test" {
		t.Errorf("ANTHROPIC_AUTH_TOKEN = %q, want %q", got, "sk-kimi-test")
	}
	if got := envMap["ANTHROPIC_MODEL"]; got != "K2.6" {
		t.Errorf("ANTHROPIC_MODEL = %q, want %q", got, "K2.6")
	}
}

func TestNew_ParsesProjectEnvFromMapStringAny(t *testing.T) {
	opts := map[string]any{
		"work_dir":    t.TempDir(),
		"run_as_user": "test-user",
		"env": map[string]any{
			"ANTHROPIC_BASE_URL":   "https://api.mimo.com/v1",
			"ANTHROPIC_AUTH_TOKEN": "sk-mimo-test",
			"ANTHROPIC_MODEL":      "mimo-large",
		},
	}

	a, err := New(opts)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	agent := a.(*Agent)
	agent.mu.Lock()
	defer agent.mu.Unlock()

	envMap := envSliceToMap(agent.configEnv)
	if got := envMap["ANTHROPIC_BASE_URL"]; got != "https://api.mimo.com/v1" {
		t.Errorf("ANTHROPIC_BASE_URL = %q, want %q", got, "https://api.mimo.com/v1")
	}
	if got := envMap["ANTHROPIC_MODEL"]; got != "mimo-large" {
		t.Errorf("ANTHROPIC_MODEL = %q, want %q", got, "mimo-large")
	}
}

func TestNew_NoEnvOpts(t *testing.T) {
	opts := map[string]any{
		"work_dir":    t.TempDir(),
		"run_as_user": "test-user",
	}

	a, err := New(opts)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	agent := a.(*Agent)
	agent.mu.Lock()
	defer agent.mu.Unlock()

	if len(agent.configEnv) != 0 {
		t.Fatalf("expected 0 env vars when no env in opts, got %d: %v", len(agent.configEnv), agent.configEnv)
	}
}

func TestNew_ProjectEnvOverridesProviderEnv(t *testing.T) {
	opts := map[string]any{
		"work_dir":    t.TempDir(),
		"run_as_user": "test-user",
		"env": map[string]string{
			"ANTHROPIC_BASE_URL":   "https://api.deepseek.com/v1",
			"ANTHROPIC_AUTH_TOKEN": "sk-deepseek-test",
			"ANTHROPIC_MODEL":      "deepseek-chat",
		},
	}

	a, err := New(opts)
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	agent := a.(*Agent)
	// Set providers to simulate a provider being configured
	agent.providers = []core.ProviderConfig{
		{
			Name:    "deepseek",
			BaseURL: "https://api.deepseek.com/v1",
			APIKey:  "sk-deepseek-test",
			Model:   "deepseek-chat",
		},
	}
	agent.activeIdx = 0

	// runtimeEnvLocked merges configEnv + providerEnv + sessionEnv
	// configEnv (from opts["env"]) should be present
	env := agent.runtimeEnvLocked()
	envMap := envSliceToMap(env)

	if got := envMap["ANTHROPIC_BASE_URL"]; got != "https://api.deepseek.com/v1" {
		t.Errorf("ANTHROPIC_BASE_URL = %q, want %q", got, "https://api.deepseek.com/v1")
	}
	if got := envMap["ANTHROPIC_MODEL"]; got != "deepseek-chat" {
		t.Errorf("ANTHROPIC_MODEL = %q, want %q", got, "deepseek-chat")
	}
	// Auto compaction stays on (a subagent's autoCompactWindow needs it), with the main
	// session's window at the model's own and idle compaction out of reach (#1960).
	if got, ok := envMap["DISABLE_AUTO_COMPACT"]; ok {
		t.Errorf("DISABLE_AUTO_COMPACT = %q, want it unset: it also stops subagents compacting", got)
	}
	if got := envMap["CLAUDE_CODE_AUTO_COMPACT_WINDOW"]; got != "10000000" {
		t.Errorf("CLAUDE_CODE_AUTO_COMPACT_WINDOW = %q, want 10000000 (capped by the CLI at the model window)", got)
	}
	if got := envMap["CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS"]; got != "1000000000" {
		t.Errorf("CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS = %q, want 1000000000 (no idle compaction)", got)
	}
}

// config.toml [env] comes after the bridge's compaction defaults, so an operator can
// still pick another window or turn the CLI's auto compaction off altogether. The
// child takes the last entry of a repeated key (exec.Cmd.Env), as envSliceToMap does.
func TestRuntimeEnv_ConfigEnvOverridesCompactionDefaults(t *testing.T) {
	a, err := New(map[string]any{
		"work_dir":    t.TempDir(),
		"run_as_user": "skip-lookpath",
		"env": map[string]string{
			"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "400000",
			"DISABLE_AUTO_COMPACT":            "1",
		},
	})
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}
	envMap := envSliceToMap(a.(*Agent).runtimeEnvLocked())
	if got := envMap["CLAUDE_CODE_AUTO_COMPACT_WINDOW"]; got != "400000" {
		t.Errorf("CLAUDE_CODE_AUTO_COMPACT_WINDOW = %q, want the config.toml value 400000", got)
	}
	if got := envMap["DISABLE_AUTO_COMPACT"]; got != "1" {
		t.Errorf("DISABLE_AUTO_COMPACT = %q, want the config.toml value 1", got)
	}
	if got := envMap["CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS"]; got != "1000000000" {
		t.Errorf("CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS = %q, want the bridge default", got)
	}
}
