package core

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
