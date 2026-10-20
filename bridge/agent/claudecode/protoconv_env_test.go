package claudecode

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// A provider whose upstream only speaks Chat Completions is reached through the local converter.
func TestProviderEnv_OpenAIChatProviderUsesLocalConverter(t *testing.T) {
	a := &Agent{providers: []core.ProviderConfig{{Name: "local", BaseURL: "http://127.0.0.1:11434/v1", APIKey: "real",
		Model: "qwen3:0.6b", APIFormat: core.APIFormatOpenAIChat}}, activeIdx: 0}
	a.mu.Lock()
	env := envSliceToMap(a.providerEnvLocked())
	a.mu.Unlock()
	if got := env["ANTHROPIC_BASE_URL"]; !strings.HasPrefix(got, "http://127.0.0.1:") || strings.Contains(got, "11434") {
		t.Fatalf("ANTHROPIC_BASE_URL = %q, want the local converter", got)
	}
	if env["ANTHROPIC_AUTH_TOKEN"] == "real" {
		t.Fatal("the real key must stay inside the converter")
	}
	if env["ANTHROPIC_MODEL"] != "qwen3:0.6b" {
		t.Fatalf("ANTHROPIC_MODEL = %q", env["ANTHROPIC_MODEL"])
	}
}
