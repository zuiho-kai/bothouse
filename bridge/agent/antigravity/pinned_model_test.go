package antigravity

import (
	"strings"
	"testing"
)

// A cmd that already carries a model flag ("agy --model x") decides which model
// runs (buildAntigravityArgs does not add another --model). What the bridge
// shows and groups quota by must be that model, and the prompt must not offer
// a model switch that cannot take effect.
func TestPinnedCmdModel_DisplayMatchesActual(t *testing.T) {
	for _, args := range [][]string{
		{"--model", "gemini-pinned"},
		{"--model=gemini-pinned"},
		{"-m", "gemini-pinned"},
		{"-m=gemini-pinned"},
	} {
		a := &Agent{model: "gemini-configured", cliExtraArgs: args, activeIdx: -1}
		if got := a.GetModel(); got != "gemini-pinned" {
			t.Fatalf("%v: GetModel() = %q, want the cmd's model", args, got)
		}
		a.SetModel("gemini-switched")
		if got := a.GetModel(); got != "gemini-pinned" {
			t.Fatalf("%v: after SetModel GetModel() = %q, want the cmd's model (it still runs)", args, got)
		}
	}
}

func TestPinnedCmdModel_NoModelSwitchInstructions(t *testing.T) {
	pinned := &antigravitySession{workDir: t.TempDir(), extraArgs: []string{"--model", "gemini-pinned"}}
	got, _ := pinned.preparePrompt("hello", nil, nil)
	if strings.Contains(got, "[cc-connect model-control instructions]") {
		t.Fatalf("pinned cmd model still gets model-switch instructions: %s", got)
	}
	if !strings.Contains(got, "[Task lifecycle]") || !strings.HasSuffix(got, "hello") {
		t.Fatalf("pinned prompt lost lifecycle guidance or request: %s", got)
	}
	free := &antigravitySession{workDir: t.TempDir(), model: "gemini-a"}
	if got, _ := free.preparePrompt("hello", nil, nil); !strings.Contains(got, "[cc-connect model-control instructions]") {
		t.Fatalf("unpinned prompt lost model-switch instructions: %s", got)
	}
}

func TestPinnedCmdModel_QuotaUsesActualModel(t *testing.T) {
	a := &Agent{model: "gemini-configured", cliExtraArgs: []string{"-m", "gemini-pinned"}, activeIdx: -1}
	if got := a.usageModel("gemini-configured"); got != "gemini-pinned" {
		t.Fatalf("usageModel = %q, want the cmd's model", got)
	}
	b := &Agent{model: "gemini-configured", activeIdx: -1}
	if got := b.usageModel("gemini-x"); got != "gemini-x" {
		t.Fatalf("unpinned usageModel = %q, want the asked model", got)
	}
}

func TestModelFlagHelpersAgree(t *testing.T) {
	for _, c := range []struct {
		args []string
		want string
	}{
		{[]string{"--model", "x"}, "x"},
		{[]string{"--model=x"}, "x"},
		{[]string{"-m", "x"}, "x"},
		{[]string{"-m=x"}, "x"},
		{[]string{"--yolo"}, ""},
	} {
		if got := modelFromArgs(c.args); got != c.want {
			t.Errorf("modelFromArgs(%v) = %q, want %q", c.args, got, c.want)
		}
		if got := hasModelFlag(c.args); got != (c.want != "") {
			t.Errorf("hasModelFlag(%v) = %v, disagrees with modelFromArgs", c.args, got)
		}
	}
}
