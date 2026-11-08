package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPetPacksListAndServeAsset(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("BOTHOUSE_PETS_DIR", tempDir)

	// Create a dummy installed pack "test-pack"
	packDir := filepath.Join(tempDir, "test-pack")
	spritesheetDir := filepath.Join(packDir, "spritesheet")
	if err := os.MkdirAll(spritesheetDir, 0o755); err != nil {
		t.Fatalf("failed to create pack dir: %v", err)
	}

	manifestJSON := `{
		"schemaVersion": 1,
		"id": "test-pack",
		"name": "测试动作包",
		"canvasWidth": 640,
		"canvasHeight": 360,
		"animations": [
			{
				"id": "idle",
				"name": "待机动作",
				"sources": { "webp": "spritesheet/idle.webp" },
				"spritesheet": { "frameWidth": 640, "frameHeight": 360, "columns": 8, "rows": 15, "frameCount": 120, "fps": 12 }
			}
		]
	}`
	if err := os.WriteFile(filepath.Join(packDir, "manifest.json"), []byte(manifestJSON), 0o644); err != nil {
		t.Fatalf("failed to write manifest: %v", err)
	}

	dummyImageContent := []byte("RIFFdummyWEBPVP8X")
	if err := os.WriteFile(filepath.Join(spritesheetDir, "idle.webp"), dummyImageContent, 0o644); err != nil {
		t.Fatalf("failed to write dummy webp: %v", err)
	}

	server := &ManagementServer{}

	// 1. Test handlePetPacks (GET /api/v1/plugins/pets)
	reqList := httptest.NewRequest(http.MethodGet, "/api/v1/plugins/pets", nil)
	recList := httptest.NewRecorder()
	server.handlePetPacks(recList, reqList)

	if recList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", recList.Code, recList.Body.String())
	}

	var resp struct {
		OK   bool             `json:"ok"`
		Data PetPacksResponse `json:"data"`
	}
	if err := json.Unmarshal(recList.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response JSON: %v", err)
	}

	if len(resp.Data.Installed) != 1 {
		t.Fatalf("expected 1 installed pack, got %d", len(resp.Data.Installed))
	}
	if resp.Data.Installed[0].ID != "test-pack" || resp.Data.Installed[0].Name != "测试动作包" {
		t.Errorf("unexpected pack info: %+v", resp.Data.Installed[0])
	}
	if resp.Data.Installed[0].ActionCount != 1 {
		t.Errorf("expected 1 action, got %d", resp.Data.Installed[0].ActionCount)
	}

	// 2. Test handlePetAsset (GET /api/v1/plugins/pets/asset?pack=test-pack&file=spritesheet/idle.webp)
	reqAsset := httptest.NewRequest(http.MethodGet, "/api/v1/plugins/pets/asset?pack=test-pack&file=spritesheet/idle.webp", nil)
	recAsset := httptest.NewRecorder()
	server.handlePetAsset(recAsset, reqAsset)

	if recAsset.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for asset, got %d: %s", recAsset.Code, recAsset.Body.String())
	}
	if ct := recAsset.Header().Get("Content-Type"); ct != "image/webp" {
		t.Errorf("expected Content-Type image/webp, got %s", ct)
	}
	if recAsset.Body.String() != string(dummyImageContent) {
		t.Errorf("asset body mismatch")
	}

	// 3. Test path traversal rejection (GET with ..)
	reqTraversal := httptest.NewRequest(http.MethodGet, "/api/v1/plugins/pets/asset?pack=test-pack&file=../manifest.json", nil)
	recTraversal := httptest.NewRecorder()
	server.handlePetAsset(recTraversal, reqTraversal)

	if recTraversal.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for traversal, got %d", recTraversal.Code)
	}

	// 4. Test missing asset returns 404
	reqMissing := httptest.NewRequest(http.MethodGet, "/api/v1/plugins/pets/asset?pack=test-pack&file=spritesheet/notfound.webp", nil)
	recMissing := httptest.NewRecorder()
	server.handlePetAsset(recMissing, reqMissing)

	if recMissing.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found, got %d", recMissing.Code)
	}
}
