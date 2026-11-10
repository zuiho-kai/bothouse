package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func petSpriteFixture(t *testing.T) map[string][]byte {
	t.Helper()
	return map[string][]byte{
		"manifest.json":        []byte(`{"name":"下载测试","animations":[]}`),
		"actions.json":         []byte(`{"animations":[{"id":"idle","category":"待机","sources":{"webp":"spritesheet/idle.png"},"spritesheet":{"frameWidth":2,"frameHeight":2,"columns":2,"frameCount":2,"fps":1}}]}`),
		"spritesheet/idle.png": generatedPetFrames(t),
	}
}

func petPost(handler http.Handler, path, ctype string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer pet-test-token")
	req.Header.Set("Content-Type", ctype)
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, req)
	return out
}

func TestPetShowcaseFetchChecksSHA256(t *testing.T) {
	files := petSpriteFixture(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/o/r/c0ffee/pets/demo/")
		if b, ok := files[name]; ok {
			w.Write(b)
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	old, oldJSON := petRawBase, petShowcaseJSON
	defer func() { petRawBase, petShowcaseJSON = old, oldJSON }()
	petRawBase = srv.URL
	sums := map[string]string{}
	for name, b := range files {
		sums[name] = petSHA256(b)
	}
	sc := map[string]any{"upstream": "o/r", "commit": "c0ffee", "packs": []any{map[string]any{"id": "demo", "dir": "pets/demo", "name": "Demo", "files": sums}}}
	petShowcaseJSON, _ = json.Marshal(sc)

	data := t.TempDir()
	handler := petTestHandler(t, data)
	out := petPost(handler, "/api/v1/plugins/pets/fetch", "application/json", []byte(`{"pack":"demo"}`))
	if out.Code != http.StatusAccepted {
		t.Fatalf("fetch: %d %s", out.Code, out.Body.String())
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if st := petFetchStatus(filepath.Join(data, "pets", "demo")); st != nil && st.State != "downloading" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	list := petRequest(handler, "/api/v1/plugins/pets", "pet-test-token")
	var body struct {
		Data PetPacksResponse `json:"data"`
	}
	json.Unmarshal(list.Body.Bytes(), &body)
	if len(body.Data.Showcase) != 1 || !body.Data.Showcase[0].Installed || body.Data.Showcase[0].Files != nil {
		t.Fatalf("showcase after fetch: %s", list.Body.String())
	}

	// A file that does not match its sha256 fails the whole pack; nothing is installed.
	files["actions.json"] = []byte(`{"animations":[]}`)
	sc["packs"].([]any)[0].(map[string]any)["id"] = "demo2"
	petShowcaseJSON, _ = json.Marshal(sc)
	out = petPost(handler, "/api/v1/plugins/pets/fetch", "application/json", []byte(`{"pack":"demo2"}`))
	if out.Code != http.StatusAccepted {
		t.Fatalf("fetch2: %d", out.Code)
	}
	for time.Now().Before(deadline.Add(5 * time.Second)) {
		if st := petFetchStatus(filepath.Join(data, "pets", "demo2")); st != nil && st.State != "downloading" {
			if st.State != "failed" || !strings.Contains(st.Error, "sha256") {
				t.Fatalf("tampered file: %+v", st)
			}
			if _, err := os.Stat(filepath.Join(data, "pets", "demo2")); err == nil {
				t.Fatal("tampered pack must not be installed")
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("fetch2 did not finish")
}

func TestPetShowcaseListDoesNotFetch(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer srv.Close()
	old := petRawBase
	petRawBase = srv.URL
	defer func() { petRawBase = old }()
	data := t.TempDir()
	handler := petTestHandler(t, data)
	out := petRequest(handler, "/api/v1/plugins/pets", "pet-test-token")
	var body struct {
		Data PetPacksResponse `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if out.Code != http.StatusOK || len(body.Data.Showcase) != 4 || len(body.Data.Installed) != 0 {
		t.Fatalf("catalog: %s", out.Body.String())
	}
	if calls.Load() != 0 {
		t.Fatal("listing fetched upstream assets")
	}
	if _, err := os.Stat(filepath.Join(data, "pets")); !os.IsNotExist(err) {
		t.Fatalf("listing created pack directory: %v", err)
	}
	for _, pack := range body.Data.Showcase {
		if pack.Files != nil || !strings.Contains(pack.Source, "cb205c271517336b500981a2cca050a1759bceaa") {
			t.Fatalf("source manifest leaked or unpinned: %+v", pack)
		}
	}
	out = petPost(handler, "/api/v1/plugins/pets/fetch", "application/json", []byte(`{"pack":"../other"}`))
	if out.Code != http.StatusNotFound {
		t.Fatalf("unknown pack: %d", out.Code)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/plugins/pets/fetch", strings.NewReader(`{"pack":"dsh1"}`))
	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, req)
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated fetch: %d", denied.Code)
	}
	if calls.Load() != 0 {
		t.Fatal("rejected request fetched upstream assets")
	}
}

func TestPetShowcaseDownloadHTTPFailureLeavesDefaultsAndHidesStage(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	old, oldJSON := petRawBase, petShowcaseJSON
	defer func() { petRawBase, petShowcaseJSON = old, oldJSON }()
	petRawBase = srv.URL
	petShowcaseJSON = []byte(`{"upstream":"o/r","commit":"test","packs":[{"id":"demo","dir":"pets/demo","files":{"manifest.json":"unused"}}]}`)
	data := t.TempDir()
	defaults := []byte(`{"bridge:deep":[{"plugin_id":"dsh-pet","enabled":true}]}`)
	bindingFile := filepath.Join(data, "role-plugin-bindings.json")
	if err := os.WriteFile(bindingFile, defaults, 0600); err != nil {
		t.Fatal(err)
	}
	handler := petTestHandler(t, data)
	out := petPost(handler, "/api/v1/plugins/pets/fetch", "application/json", []byte(`{"pack":"demo"}`))
	if out.Code != http.StatusAccepted {
		t.Fatalf("fetch: %d %s", out.Code, out.Body.String())
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		st := petFetchStatus(filepath.Join(data, "pets", "demo"))
		if st != nil && st.State != "downloading" {
			if st.State != "failed" || !strings.Contains(st.Error, "HTTP 404") {
				t.Fatalf("failure reason: %+v", st)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("download did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	list := petRequest(handler, "/api/v1/plugins/pets", "pet-test-token")
	var body struct {
		Data PetPacksResponse `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Installed) != 0 || body.Data.Showcase[0].Fetch.State != "failed" {
		t.Fatalf("partial pack listed: %s", list.Body.String())
	}
	if _, err := os.Stat(filepath.Join(data, "pets", "demo")); !os.IsNotExist(err) {
		t.Fatalf("failed download installed: %v", err)
	}
	got, err := os.ReadFile(bindingFile)
	if err != nil || !bytes.Equal(got, defaults) {
		t.Fatalf("default bindings changed: %s %v", got, err)
	}
}
