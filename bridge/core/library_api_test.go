package core

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func libData(out map[string]any) map[string]any {
	d, _ := out["data"].(map[string]any)
	return d
}

func libReq(t *testing.T, ts *httptest.Server, method, path, ctype string, body []byte) (int, map[string]any, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer tok")
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out, raw
}

func libMultipart(t *testing.T, field string, data []byte, extra map[string]string) (string, []byte) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range extra {
		_ = mw.WriteField(k, v)
	}
	fw, _ := mw.CreateFormFile(field, "x")
	_, _ = fw.Write(data)
	_ = mw.Close()
	return mw.FormDataContentType(), buf.Bytes()
}

func TestLibraryAPIRoundTrip(t *testing.T) {
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(newMemStore(), t.TempDir())
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer ts.Close()

	if resp, _ := http.Get(ts.URL + "/api/v1/library"); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("library without token: %d", resp.StatusCode)
	}
	code, out, _ := libReq(t, ts, "GET", "/api/v1/library?lang=zh", "", nil)
	if ps, _ := libData(out)["personas"].([]any); code != 200 || len(ps) != 12 {
		t.Fatalf("list: %d %v", code, out)
	}

	b, _ := json.Marshal(map[string]any{"name": "Test Girl", "intro": "i", "text": "# x"})
	code, out, _ = libReq(t, ts, "POST", "/api/v1/library/personas", "application/json", b)
	slug, _ := libData(out)["slug"].(string)
	if code != 200 || slug == "" {
		t.Fatalf("create: %d %v", code, out)
	}
	b, _ = json.Marshal(map[string]any{"name": "Test Girl", "text": "# y"})
	if code, out, _ = libReq(t, ts, "PUT", "/api/v1/library/personas/"+slug, "application/json", b); code != 200 {
		t.Fatalf("edit: %d %v", code, out)
	}
	code, out, _ = libReq(t, ts, "DELETE", "/api/v1/library/personas/"+slug, "", nil)
	if code != 200 || libData(out)["result"] != "deleted" {
		t.Fatalf("delete: %d %v", code, out)
	}
	if code, out, _ = libReq(t, ts, "POST", "/api/v1/library/personas/"+slug+"/undo", "", nil); code != 200 {
		t.Fatalf("undo: %d %v", code, out)
	}
	code, out, _ = libReq(t, ts, "DELETE", "/api/v1/library/personas/ju", "", nil)
	if code != 200 || libData(out)["result"] != "hidden" {
		t.Fatalf("delete builtin: %d %v", code, out)
	}

	var img bytes.Buffer
	_ = png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	ct, body := libMultipart(t, "file", img.Bytes(), map[string]string{"slug": "mypic"})
	if code, out, _ = libReq(t, ts, "POST", "/api/v1/library/avatars", ct, body); code != 200 {
		t.Fatalf("upload: %d %v", code, out)
	}
	resp, _ := http.Get(ts.URL + "/api/v1/library/avatar-image/mypic")
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("avatar-image without token: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}

	b, _ = json.Marshal(map[string]any{"manifest": map[string]any{"id": "testpack", "name": "T", "version": "1.0.0", "license": "CC0"}})
	code, _, zb := libReq(t, ts, "POST", "/api/v1/library/packs/export", "application/json", b)
	if code != 200 {
		t.Fatalf("export: %d %s", code, zb)
	}
	ct, body = libMultipart(t, "file", zb, nil)
	code, out, _ = libReq(t, ts, "POST", "/api/v1/library/packs/preview", ct, body)
	if code != 200 {
		t.Fatalf("preview: %d %v", code, out)
	}
	b, _ = json.Marshal(map[string]any{"staging": libData(out)["staging"]})
	if code, out, _ = libReq(t, ts, "POST", "/api/v1/library/packs/install", "application/json", b); code != 200 {
		t.Fatalf("install: %d %v", code, out)
	}
	for _, step := range []struct{ method, path string }{{"POST", "/disable"}, {"POST", "/enable"}, {"DELETE", ""}} {
		if code, out, _ = libReq(t, ts, step.method, "/api/v1/library/packs/testpack"+step.path, "", nil); code != 200 {
			t.Fatalf("pack %s%s: %d %v", step.method, step.path, code, out)
		}
	}
}

func TestCloudWebAvatarParam(t *testing.T) {
	dir := t.TempDir()
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	if err := SaveLibraryAvatar(dir, "mypic", img.Bytes()); err != nil {
		t.Fatal(err)
	}
	for slug, want := range map[string]string{"orange": "orange", "mypic": "http://h:9820/api/v1/library/avatar-image/mypic", "nope": "", "": ""} {
		if got := cloudWebAvatar(dir, "h:9820", slug); got != want {
			t.Errorf("cloudWebAvatar(%q) = %q, want %q", slug, got, want)
		}
	}
}

func TestApplyDiscordAvatars(t *testing.T) {
	dir := t.TempDir()
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	_ = SaveLibraryAvatar(dir, "mypic", img.Bytes())
	calls := 0
	fail := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPatch && r.URL.Path == "/users/@me" {
			calls++
			if fail {
				w.WriteHeader(http.StatusTooManyRequests)
				return
			}
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	old := discordAPIBase
	discordAPIBase = srv.URL
	t.Cleanup(func() { discordAPIBase = old; srv.Close() })

	roles := []plannedRole{{wizardIdentity: wizardIdentity{token: "tok"}, project: "a"}, {wizardIdentity: wizardIdentity{token: "tok"}, project: "b"}}
	team := []SetupTeamEntry{{Project: "a", Avatar: "mypic"}, {Project: "b", Avatar: "mypic"}}
	res := &WizardResult{}
	applyDiscordAvatars(t.Context(), dir, "zh", roles, team, []SetupTeamEntry{{Project: "b", Avatar: "mypic"}}, res)
	if calls != 1 || len(res.Warnings) != 0 || team[0].Avatar != "mypic" {
		t.Fatalf("unchanged avatar must not be patched: calls=%d warnings=%v", calls, res.Warnings)
	}
	fail = true
	team = []SetupTeamEntry{{Project: "a", Avatar: "mypic"}}
	applyDiscordAvatars(t.Context(), dir, "zh", roles, team, []SetupTeamEntry{{Project: "a", Avatar: "orange"}}, res)
	if calls != 2 || len(res.Warnings) != 1 || team[0].Avatar != "orange" || res.Warnings[0].Blocking {
		t.Fatalf("failed patch: one try, a non-blocking warning, old avatar kept: calls=%d %v %v", calls, res.Warnings, team)
	}
}

// A pack with personas only previews with "avatars": [] (the UI reads the list; null crashed it).
func TestPreviewPackPersonasOnlyHasEmptyAvatarList(t *testing.T) {
	var zb bytes.Buffer
	zw := zip.NewWriter(&zb)
	for name, body := range map[string]string{
		"manifest.json":         `{"id":"onlyp","name":"P","version":"1.0.0","license":"CC0"}`,
		"personas/librarian.md": "---\nname: Librarian\nintro: A quiet librarian girl.\n---\nYou are a quiet librarian girl.\n",
	} {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	zw.Close()
	pv, err := PreviewPack(t.TempDir(), "en", zb.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(pv)
	if !strings.Contains(string(b), `"avatars":[]`) || len(pv.Personas) != 1 {
		t.Fatalf("preview = %s", b)
	}
}
