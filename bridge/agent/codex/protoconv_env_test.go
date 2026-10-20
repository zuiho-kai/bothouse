package codex

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestCodexProvider_OpenAIChatUsesConverter(t *testing.T) {
	a := &Agent{providers: []core.ProviderConfig{{Name: "ds", BaseURL: "https://api.siliconflow.cn/v1", APIKey: "real",
		APIFormat: core.APIFormatOpenAIChat}}, activeIdx: 0}
	name, key, wire, _ := a.activeProviderCodexConfig()
	if name != "ds" || key == "real" || wire != "responses" {
		t.Fatalf("codex config = %q %q %q", name, key, wire)
	}
	var base string
	for _, kv := range a.providerEnvLocked() {
		if v, ok := strings.CutPrefix(kv, "OPENAI_BASE_URL="); ok {
			base = v
		}
	}
	if !strings.HasPrefix(base, "http://127.0.0.1:") || !strings.HasSuffix(base, "/v1") {
		t.Fatalf("OPENAI_BASE_URL = %q", base)
	}
}
