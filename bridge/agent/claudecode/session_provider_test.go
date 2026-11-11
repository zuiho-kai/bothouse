package claudecode

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestSessionProviderEnv(t *testing.T) {
	ps := []core.ProviderConfig{{Name: "main", BaseURL: "https://a"}, {Name: "local-qwen", BaseURL: "http://127.0.0.1:1234", APIKey: "k", Model: "qwen"}}
	env, model, ok := sessionProviderEnv(ps, "local-qwen")
	joined := strings.Join(env, "\n")
	if !ok || model != "qwen" || !strings.Contains(joined, "ANTHROPIC_BASE_URL=http://127.0.0.1:1234") || !strings.Contains(joined, "ANTHROPIC_AUTH_TOKEN=k") {
		t.Fatalf("got %v %q %v", env, model, ok)
	}
	if _, _, ok := sessionProviderEnv(ps, "nope"); ok {
		t.Fatal("unknown provider must not match")
	}
}
