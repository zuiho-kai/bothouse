package core

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// #1407: a connection-only rerun must neither populate agent defaults nor touch persona files.
func TestApplyWizardQQReusePreservesRole(t *testing.T) {
	noHardware(t)
	ws := fakeNapCat(t, "")
	dir := t.TempDir()
	persona := filepath.Join(dir, "AGENTS.md")
	before := []byte("# My existing role\nDo not change its language.\n")
	if err := os.WriteFile(persona, before, 0o600); err != nil {
		t.Fatal(err)
	}
	store := newMemStore()
	store.projects["existing"] = &WizardProjectWrite{Name: "existing", AgentType: "codex", WorkDir: dir, PlatformType: "qq", Options: map[string]any{"ws_url": ws, "token": "saved", "allow_from": "12345"}}
	store.order = []string{"existing"}
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: []LocalCLI{{AgentType: "codex", Path: "/custom/codex", Supported: true}}}
	res := ApplyWizard(context.Background(), env, WizardRequest{Platform: "qq", Language: "zh", QQ: &WizardQQ{WSURL: ws, AllowFrom: "67890"}, Roles: []WizardRole{{ReuseProject: "existing"}}})
	if !res.Saved {
		t.Fatalf("rerun failed: %s", res.Error)
	}
	p := store.projects["existing"]
	if p.AgentType != "codex" || p.AgentCmd != "" || p.WorkDir != dir {
		t.Errorf("agent changed: %+v", p)
	}
	if p.Options["token"] != "saved" {
		t.Error("blank token removed the saved credential")
	}
	after, err := os.ReadFile(persona)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Errorf("persona changed: %q, %v", after, err)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 {
		t.Errorf("work directory changed: %v, %v", files, err)
	}
}

func TestApplyWizardQQBlankTokenUsesSavedCredential(t *testing.T) {
	noHardware(t)
	ws := fakeNapCat(t, "saved")
	store := newMemStore()
	store.projects["existing"] = &WizardProjectWrite{Name: "existing", AgentType: "codex", WorkDir: t.TempDir(), PlatformType: "qq", Options: map[string]any{"ws_url": ws, "token": "saved", "allow_from": "12345"}}
	store.order = []string{"existing"}
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	req := WizardRequest{Platform: "qq", QQ: &WizardQQ{WSURL: ws, AllowFrom: "12345"}, Roles: []WizardRole{{}}}
	req.DryRun = true
	preview := ApplyWizard(context.Background(), env, req)
	if !preview.OK || preview.QQ == nil || preview.QQ.Code != "ok" {
		t.Fatalf("preview did not use saved token: %+v", preview)
	}
	req.DryRun = false
	saved := ApplyWizard(context.Background(), env, req)
	if !saved.Saved || store.projects["existing"].Options["token"] != "saved" {
		t.Fatalf("save did not preserve tested token: %+v", saved)
	}
}

func TestApplyWizardQQBlankTokenKeepsEnvironmentReference(t *testing.T) {
	noHardware(t)
	t.Setenv("QQ_WIZARD_TEST_TOKEN", "saved")
	ws := fakeNapCat(t, "saved")
	store := newMemStore()
	store.projects["existing"] = &WizardProjectWrite{Name: "existing", AgentType: "codex", WorkDir: t.TempDir(), PlatformType: "qq", Options: map[string]any{"ws_url": ws, "token": "${QQ_WIZARD_TEST_TOKEN}", "allow_from": "12345"}}
	store.order = []string{"existing"}
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	req := WizardRequest{Platform: "qq", QQ: &WizardQQ{WSURL: ws, AllowFrom: "12345"}, Roles: []WizardRole{{}}}
	res := ApplyWizard(context.Background(), env, req)
	if !res.Saved || store.projects["existing"].Options["token"] != "${QQ_WIZARD_TEST_TOKEN}" {
		t.Fatalf("saved credential reference was expanded into config or lost: %+v", res)
	}
	t.Setenv("QQ_WIZARD_TEST_TOKEN", "")
	res = ApplyWizard(context.Background(), env, req)
	if res.Saved || res.OK {
		t.Fatal("missing environment credential must fail without saving")
	}
}
