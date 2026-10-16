package antigravity

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func modelCLI(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agy")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nset -eu\n"+body), 0700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAvailableModels_NativeCLIModelCanBeQueued(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("GOOGLE_API_KEY", "")
	cmd := modelCLI(t, `
test "$#" -eq 1
test "$1" = models
printf 'Fetching available models...\n' >&2
printf 'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n'
printf 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'
printf 'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)\n'
`)
	ag, err := New(map[string]any{"cmd": cmd, "work_dir": t.TempDir(), "model": "gemini-3.8-flash-medium"})
	if err != nil {
		t.Fatal(err)
	}
	e := core.NewEngine("model-regression", ag, nil, filepath.Join(t.TempDir(), "sessions.json"), core.LangEnglish)
	t.Cleanup(func() { e.Stop() })
	status := e.ModelStatus(context.Background(), "test")
	if len(status.Models) != 3 || status.Models[1].Name != "gemini-3.8-flash-high" {
		t.Fatalf("bridge did not advertise CLI models: %+v", status.Models)
	}
	r := e.QueueModelSwitch(context.Background(), "test", "gemini-3.8-flash-high", "", false)
	if !r.OK || r.Model != "gemini-3.8-flash-high" {
		t.Fatalf("CLI advertised the model, but bridge rejected it: %+v", r)
	}
	if ag.(*Agent).GetModel() != "gemini-3.8-flash-medium" {
		t.Fatal("queue must not change the current turn's model")
	}
	if got := e.ModelStatus(context.Background(), "test").Pending; got != r.Model {
		t.Fatalf("pending = %q, want %q", got, r.Model)
	}
	if r := e.QueueModelSwitch(context.Background(), "other", "invented-model", "", false); r.OK {
		t.Fatal("unadvertised model was accepted")
	}
}

func TestAvailableModels_UsesSessionCommandAndEnvironment(t *testing.T) {
	t.Setenv("MODEL_DISCOVERY_ORDER", "inherited")
	dir := t.TempDir()
	cmd := modelCLI(t, `
test "$#" -eq 2
test "$1" = --test-profile
test "$2" = models
test "$PWD" -ef "$MODEL_DISCOVERY_DIR"
test "$MODEL_DISCOVERY_CONFIG" = config
test "$MODEL_DISCOVERY_PROVIDER" = provider
test "$MODEL_DISCOVERY_ORDER" = session
printf 'native-model-high\tNative Model (High)\n'
`)
	a := &Agent{
		cmd: cmd, cliExtraArgs: []string{"--test-profile"}, workDir: dir,
		configEnv: []string{"MODEL_DISCOVERY_DIR=" + dir, "MODEL_DISCOVERY_CONFIG=config", "MODEL_DISCOVERY_ORDER=config"},
		providers: []core.ProviderConfig{{Env: map[string]string{
			"MODEL_DISCOVERY_PROVIDER": "provider", "MODEL_DISCOVERY_ORDER": "provider",
		}}},
		activeIdx: 0, sessionEnv: []string{"MODEL_DISCOVERY_ORDER=session"},
	}
	got := a.AvailableModels(context.Background())
	if len(got) != 1 || got[0].Name != "native-model-high" {
		t.Fatalf("CLI command/environment mismatch: %+v", got)
	}
}

func TestAvailableModels_ConfiguredModelsTakePriority(t *testing.T) {
	want := []core.ModelOption{{Name: "configured-model", Desc: "Explicit provider model"}}
	a := &Agent{cmd: filepath.Join(t.TempDir(), "missing-cli"),
		providers: []core.ProviderConfig{{Models: want}}, activeIdx: 0}
	if got := a.AvailableModels(context.Background()); !reflect.DeepEqual(got, want) {
		t.Fatalf("models = %+v, want %+v", got, want)
	}
}

func TestAvailableModels_DiscoveryFailureDoesNotInventModels(t *testing.T) {
	for _, tt := range []struct {
		name, script string
	}{
		{"nonzero exit with partial output", "printf 'partial-model\tPartial Model\n'; exit 3\n"},
		{"empty output", "exit 0\n"},
		{"non-model output", "printf 'Fetching available models...\nNo models available\n'\n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := &Agent{cmd: modelCLI(t, tt.script), activeIdx: -1}
			if got := a.AvailableModels(context.Background()); len(got) != 0 {
				t.Fatalf("unverified fallback models: %+v", got)
			}
		})
	}
}

func TestAvailableModels_DiscoveryRespectsCancellation(t *testing.T) {
	a := &Agent{cmd: modelCLI(t, "exec sleep 10\n"), activeIdx: -1}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if got := a.AvailableModels(ctx); len(got) != 0 {
		t.Fatalf("canceled discovery advertised models: %+v", got)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("discovery ignored caller deadline: %s", elapsed)
	}
}

func TestParseCLIModels_PreservesNativeIDsAndDescriptions(t *testing.T) {
	output := "Fetching available models...\n" +
		"gemini-3.8-flash-high\tGemini 3.8 Flash (High)\r\n" +
		"claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)\n" +
		"gpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n" +
		"gemini-3.8-flash-high\tDuplicate\n" +
		"invalid row\tNot an ID\nmissing-desc\t\n\n"
	want := []core.ModelOption{
		{Name: "gemini-3.8-flash-high", Desc: "Gemini 3.8 Flash (High)"},
		{Name: "claude-sonnet-5-5-high", Desc: "Claude Sonnet 5.5 (High)"},
		{Name: "gpt-oss-120b-medium", Desc: "GPT-OSS 120B (Medium)"},
	}
	if got := parseCLIModels(output); !reflect.DeepEqual(got, want) {
		t.Fatalf("models = %+v, want %+v", got, want)
	}
}
