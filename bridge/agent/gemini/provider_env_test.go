package gemini

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProviderEnv_BaseURLAndConverter(t *testing.T) {
	a := &Agent{providers: []core.ProviderConfig{{Name: "p", BaseURL: "https://api.deepseek.com/v1", APIKey: "real",
		APIFormat: core.APIFormatOpenAIChat}}, activeIdx: 0}
	env := map[string]string{}
	for _, kv := range a.providerEnvLocked() {
		k, v, _ := strings.Cut(kv, "=")
		env[k] = v
	}
	if !strings.HasPrefix(env["GOOGLE_GEMINI_BASE_URL"], "http://127.0.0.1:") || env["GEMINI_API_KEY"] == "real" {
		t.Fatalf("env = %v", env)
	}
	a.providers[0].APIFormat = ""
	env = map[string]string{}
	for _, kv := range a.providerEnvLocked() {
		k, v, _ := strings.Cut(kv, "=")
		env[k] = v
	}
	if env["GOOGLE_GEMINI_BASE_URL"] != "https://api.deepseek.com/v1" || env["GEMINI_API_KEY"] != "real" {
		t.Fatalf("native env = %v", env)
	}
}
