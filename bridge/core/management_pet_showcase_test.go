package core

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func petSpriteFixture(t *testing.T) map[string][]byte {
	t.Helper()
	return map[string][]byte{
		"manifest.json":        []byte(`{"name":"导入测试","animations":[]}`),
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

func TestPetImportFolderZipAndReasons(t *testing.T) {
	data := t.TempDir()
	handler := petTestHandler(t, data)

	// A folder picked in the browser: one part per file, named p:<relative path>.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for name, b := range petSpriteFixture(t) {
		fw, _ := mw.CreateFormFile("p:mypack/"+name, filepath.Base(name))
		fw.Write(b)
	}
	mw.Close()
	out := petPost(handler, "/api/v1/plugins/pets/import", mw.FormDataContentType(), buf.Bytes())
	if out.Code != 200 {
		t.Fatalf("folder import: %d %s", out.Code, out.Body.String())
	}
	if _, err := os.Stat(filepath.Join(data, "pets", "mypack", "spritesheet", "idle.png")); err != nil {
		t.Fatalf("folder import not saved: %v", err)
	}

	// A zip with a wrapping folder, named by the form.
	var zbuf bytes.Buffer
	zw := zip.NewWriter(&zbuf)
	for name, b := range petSpriteFixture(t) {
		w, _ := zw.Create("wrap/" + name)
		w.Write(b)
	}
	zw.Close()
	buf.Reset()
	mw = multipart.NewWriter(&buf)
	mw.WriteField("name", "我的 包")
	fw, _ := mw.CreateFormFile("zip", "x.zip")
	fw.Write(zbuf.Bytes())
	mw.Close()
	out = petPost(handler, "/api/v1/plugins/pets/import", mw.FormDataContentType(), buf.Bytes())
	if out.Code != 200 {
		t.Fatalf("zip import: %d %s", out.Code, out.Body.String())
	}
	if _, err := os.Stat(filepath.Join(data, "pets", "我的-包", "manifest.json")); err != nil {
		t.Fatalf("zip import not saved: %v", err)
	}

	// Not a pack: a Chinese reason, nothing saved.
	buf.Reset()
	mw = multipart.NewWriter(&buf)
	fw, _ = mw.CreateFormFile("p:junk/readme.txt", "readme.txt")
	fw.Write([]byte("hi"))
	mw.Close()
	out = petPost(handler, "/api/v1/plugins/pets/import", mw.FormDataContentType(), buf.Bytes())
	if out.Code != 400 || !strings.Contains(out.Body.String(), "认不出这个形象包") {
		t.Fatalf("bad pack: %d %s", out.Code, out.Body.String())
	}
	if _, err := os.Stat(filepath.Join(data, "pets", "junk")); err == nil {
		t.Fatal("bad pack must not be saved")
	}

	// Escaping zip entries are refused.
	zbuf.Reset()
	zw = zip.NewWriter(&zbuf)
	w, _ := zw.Create("../evil.txt")
	w.Write([]byte("x"))
	zw.Close()
	buf.Reset()
	mw = multipart.NewWriter(&buf)
	fw, _ = mw.CreateFormFile("zip", "evil.zip")
	fw.Write(zbuf.Bytes())
	mw.Close()
	out = petPost(handler, "/api/v1/plugins/pets/import", mw.FormDataContentType(), buf.Bytes())
	if out.Code != 400 {
		t.Fatalf("escaping zip: %d %s", out.Code, out.Body.String())
	}
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
		if _, err := os.Stat(filepath.Join(data, "pets", "demo", "spritesheet", "idle.png")); err == nil {
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
