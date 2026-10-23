package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestApplyWizardCollabDedicatedCredentials(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	dir := t.TempDir()
	serverDir := filepath.Join(dir, "server")
	seedCollabRoster(t, serverDir)
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: filepath.Join(dir, "bridge"), CLIs: testCLIs}
	req := cloudWebReq("http://127.0.0.1:1", "", WizardRole{Name: "alpha"}, WizardRole{Name: "beta"})
	req.CloudWeb.CollabDataDir = serverDir
	req.DryRun = true
	res := ApplyWizard(context.Background(), env, req)
	if !res.OK || res.Saved || store.batches != 0 {
		t.Fatalf("dry run failed: %+v", res)
	}
	if _, err := os.Stat(filepath.Join(serverDir, collabCredentialsFile)); !os.IsNotExist(err) {
		t.Fatalf("dry run created credentials: %v", err)
	}
	req.DryRun = false
	res = ApplyWizard(context.Background(), env, req)
	if !res.Saved || !res.NeedsUserAction || res.CloudWeb != nil {
		t.Fatalf("save must require real connection verification: %+v", res)
	}
	path := filepath.Join(serverDir, collabCredentialsFile)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var tokens map[string]string
	if err := json.Unmarshal(b, &tokens); err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 2 || tokens["alpha"] == "" || tokens["alpha"] == tokens["beta"] {
		t.Fatal("expected two distinct dedicated credentials")
	}
	info, _ := os.Stat(path)
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatal("credential file must be private")
	}
	output, _ := json.Marshal(res)
	for id, token := range tokens {
		opts := store.projects[id].Options
		if opts["token"] != token || opts["allow_from"] != "owner" {
			t.Fatal("server/client credentials or owner allowlist differ")
		}
		if strings.Contains(opts["ws_url"].(string), token) || strings.Contains(string(output), token) {
			t.Fatal("secret leaked into URL or wizard output")
		}
	}
	// Re-running updates the same projects, retains credentials and needs no live server.
	res = ApplyWizard(context.Background(), env, req)
	if !res.Saved {
		t.Fatalf("rerun failed: %+v", res)
	}
	again, _ := os.ReadFile(path)
	if string(again) != string(b) || store.projects["alpha"].Options["token"] != tokens["alpha"] {
		t.Fatal("rerun rotated credentials")
	}
}

func seedCollabRoster(t *testing.T, dir string, ids ...string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(ids)
	const script = "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('CREATE TABLE members (id TEXT PRIMARY KEY)'); for (const id of JSON.parse(process.argv[2]) ?? []) db.prepare('INSERT INTO members VALUES (?)').run(id); db.close();"
	if out, err := exec.Command("node", "--input-type=module", "-e", script, filepath.Join(dir, "collab.sqlite3"), string(b)).CombinedOutput(); err != nil {
		t.Fatalf("seed isolated collab roster: %v: %s", err, out)
	}
}

func TestApplyWizardCollabPreservesExistingWireIdentity(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	dir := t.TempDir()
	serverDir := filepath.Join(dir, "server")
	seedCollabRoster(t, serverDir)
	store := newMemStore()
	store.projects["worker"] = &WizardProjectWrite{Name: "worker", AgentType: "codex", PlatformType: "cloud_web", WorkDir: dir,
		Options: map[string]any{"ws_url": "ws://127.0.0.1:1/cloud-web/ws?bot=alpha", "token": "old-test-only"}}
	store.order = []string{"worker"}
	req := cloudWebReq("http://127.0.0.1:1", "", WizardRole{Name: "alpha", ReuseProject: "worker"})
	req.CloudWeb.CollabDataDir = serverDir
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
	if !res.Saved {
		t.Fatalf("migration failed: %+v", res)
	}
	opts := store.projects["worker"].Options
	if cloudWebQuery(opts["ws_url"].(string), "bot") != "alpha" {
		t.Fatal("migration changed the identity holding private room memberships")
	}
	var tokens map[string]string
	b, _ := os.ReadFile(filepath.Join(serverDir, collabCredentialsFile))
	if json.Unmarshal(b, &tokens) != nil || tokens["alpha"] == "" || tokens["worker"] != "" || opts["token"] != tokens["alpha"] {
		t.Fatal("dedicated credential not bound to the original wire identity")
	}
}

func TestApplyWizardCollabRejectsExistingNativeIdentityBeforeWriting(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	for _, initialized := range []bool{false, true} {
		dir := t.TempDir()
		serverDir := filepath.Join(dir, "server")
		if initialized {
			// Seeds, live UI members and removed members all retain their ids in this table.
			seedCollabRoster(t, serverDir, "alpha")
		}
		store := newMemStore()
		req := cloudWebReq("http://127.0.0.1:1", "", WizardRole{Name: "alpha"})
		req.CloudWeb.CollabDataDir = serverDir
		res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
		if res.Saved || res.Error == "" || store.batches != 0 {
			t.Fatalf("unsafe provisioning accepted: %+v", res)
		}
		if _, err := os.Stat(filepath.Join(serverDir, collabCredentialsFile)); !os.IsNotExist(err) {
			t.Fatal("unsafe provisioning wrote credentials")
		}
	}
}

func TestApplyWizardCollabRejectsBadInputsBeforeWriting(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	for _, name := range []string{"owner", "system", "user"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			store := newMemStore()
			req := cloudWebReq("http://127.0.0.1:1", "", WizardRole{Name: name})
			req.CloudWeb.CollabDataDir = filepath.Join(dir, "server")
			res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
			if res.OK || store.batches != 0 {
				t.Fatal("reserved bot identity was accepted")
			}
		})
	}
	for _, token := range []string{"", "old-shared-secret"} {
		dir := t.TempDir()
		store := newMemStore()
		req := cloudWebReq("http://127.0.0.1:1", token, WizardRole{Name: "same"}, WizardRole{Name: "same"})
		req.CloudWeb.CollabDataDir = filepath.Join(dir, "server")
		res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
		if res.OK || store.batches != 0 {
			t.Fatal("duplicate name/shared credential accepted")
		}
	}
}

func TestCollabProvisionRefusesUnsafeCredentialFile(t *testing.T) {
	for _, payload := range []string{`{"owner":"secret"}`, `{"a":"same","b":"same"}`, `null`, `{"a":""}`} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, collabCredentialsFile), []byte(payload), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := provisionCollab(dir, &wizardPlan{}, true); err == nil {
			t.Fatal("unsafe credentials accepted")
		}
	}
	if runtime.GOOS == "windows" {
		return
	}
	dir := t.TempDir()
	path := filepath.Join(dir, collabCredentialsFile)
	if err := os.WriteFile(path, []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := provisionCollab(dir, &wizardPlan{}, true); err == nil {
		t.Fatal("publicly readable credentials accepted")
	}
	linkDir := t.TempDir()
	if err := os.Symlink(path, filepath.Join(linkDir, collabCredentialsFile)); err != nil {
		t.Fatal(err)
	}
	if err := provisionCollab(linkDir, &wizardPlan{}, true); err == nil {
		t.Fatal("symlink credentials accepted")
	}
}
