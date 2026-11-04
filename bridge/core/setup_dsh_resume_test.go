package core

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestDSHResumeRecognizesPendingAndImportedRoles(t *testing.T) {
	for _, file := range []string{"", "wizard-members.json", "wizard-members.imported.json"} {
		t.Run("roster="+file, func(t *testing.T) {
			home := t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("CONEST_COLLAB_DATA", home)
			t.Setenv("PATH", "") // no CLI processes or live installation needed
			if file != "" {
				if err := os.WriteFile(filepath.Join(home, file), []byte(`{"members":[{"name":"Codex","cli":"codex"}]}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			want := file != ""
			st := GetDSHStatus(context.Background())
			b, _ := json.Marshal(st)
			var status map[string]any
			_ = json.Unmarshal(b, &status)
			if status["configured"] != want {
				t.Fatalf("configured = %v, want %v", status["configured"], want)
			}
			m := NewManagementServer(0, "test", nil)
			m.SetWizard(newMemStore(), home)
			w := httptest.NewRecorder()
			m.handleSetupState(w, httptest.NewRequest("GET", "/api/v1/setup/state", nil))
			var body struct {
				Data struct {
					Configured map[string]bool `json:"configured_platforms"`
				} `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Data.Configured["dsh"] != want {
				t.Fatalf("configured platforms = %v, want dsh=%v", body.Data.Configured, want)
			}
		})
	}
}
