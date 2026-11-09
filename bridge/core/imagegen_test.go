package core

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// 1x1 transparent PNG — small enough to inline, real enough for http.DetectContentType.
const testPNGB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

// stubImageAPI answers POST /images/generations the way an OpenAI-compatible endpoint does.
func stubImageAPI(t *testing.T, answer func(w http.ResponseWriter, r *http.Request) bool) (*httptest.Server, *int32) {
	t.Helper()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/images/generations" {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(&calls, 1)
		if answer != nil && answer(w, r) {
			return
		}
		var body struct {
			Model  string `json:"model"`
			Prompt string `json:"prompt"`
			N      int    `json:"n"`
			Size   string `json:"size"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"bad json"}`, http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, `{"error":{"message":"invalid api key"}}`, http.StatusUnauthorized)
			return
		}
		if strings.TrimSpace(body.Prompt) == "" || body.Model == "" || body.N != 1 {
			http.Error(w, `{"error":"prompt/model/n missing"}`, http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+testPNGB64+`"}]}`)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func testImageGenerator(t *testing.T, baseURL string) *ImageGenerator {
	t.Helper()
	return NewImageGenerator(ImageGenConfig{
		Enabled:  true,
		Provider: "openai",
		APIKey:   "test-key",
		BaseURL:  baseURL,
		Model:    "gpt-image-1",
		OutDir:   t.TempDir(),
	})
}

func TestImageGen_GenerateWritesPictureAndReportsPath(t *testing.T) {
	srv, calls := stubImageAPI(t, nil)
	g := testImageGenerator(t, srv.URL)

	res, err := g.Generate(context.Background(), "一只戴眼镜的橘猫")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if atomic.LoadInt32(calls) != 1 {
		t.Fatalf("expected 1 provider call, got %d", *calls)
	}
	if res.Mime != "image/png" {
		t.Fatalf("expected image/png, got %q", res.Mime)
	}
	if res.URL != "/api/v1/image-gen/file/"+res.Name {
		t.Fatalf("unexpected url %q", res.URL)
	}
	if filepath.Dir(res.File) != g.OutDir() {
		t.Fatalf("picture written outside out_dir: %s (dir %s)", res.File, g.OutDir())
	}
	b, err := os.ReadFile(res.File)
	if err != nil {
		t.Fatalf("read written picture: %v", err)
	}
	if len(b) == 0 || res.Bytes != len(b) {
		t.Fatalf("bytes %d does not match file size %d", res.Bytes, len(b))
	}
	if res.Model != "gpt-image-1" {
		t.Fatalf("expected model in result, got %q", res.Model)
	}
}

func TestImageGen_DownloadsURLAnswerToo(t *testing.T) {
	var picture []byte
	picture, err := base64.StdEncoding.DecodeString(testPNGB64)
	if err != nil {
		t.Fatal(err)
	}
	pic := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(picture)
	}))
	t.Cleanup(pic.Close)

	srv, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		_, _ = io.WriteString(w, `{"data":[{"url":"`+pic.URL+`/gen/1.png"}]}`)
		return true
	})
	g := testImageGenerator(t, srv.URL)

	res, err := g.Generate(context.Background(), "海边日落")
	if err != nil {
		t.Fatalf("generate from url answer: %v", err)
	}
	if res.Mime != "image/png" || res.Bytes != len(picture) {
		t.Fatalf("unexpected result: mime=%s bytes=%d", res.Mime, res.Bytes)
	}
}

func TestImageGen_DisabledAndUnconfigured(t *testing.T) {
	off := NewImageGenerator(ImageGenConfig{Enabled: false, OutDir: t.TempDir()})
	if _, err := off.Generate(context.Background(), "x"); !errors.Is(err, ErrImageGenDisabled) {
		t.Fatalf("expected ErrImageGenDisabled, got %v", err)
	}

	noKey := NewImageGenerator(ImageGenConfig{Enabled: true, OutDir: t.TempDir()})
	_, err := noKey.Generate(context.Background(), "x")
	if !errors.Is(err, ErrImageGenDisabled) || !strings.Contains(err.Error(), "api_key") {
		t.Fatalf("expected an api_key message, got %v", err)
	}

	badProvider := NewImageGenerator(ImageGenConfig{Enabled: true, Provider: "midjourney", APIKey: "k", OutDir: t.TempDir()})
	if _, err := badProvider.Generate(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported provider error, got %v", err)
	}
}

// A second click while one picture is still drawing must be refused, not queued: each
// queued request would buy another picture.
func TestImageGen_SecondRequestWhileDrawingIsRefused(t *testing.T) {
	release := make(chan struct{})
	srv, calls := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		<-release
		return false
	})
	g := testImageGenerator(t, srv.URL)

	first := make(chan error, 1)
	go func() {
		_, err := g.Generate(context.Background(), "第一张")
		first <- err
	}()
	// Wait until the first request has actually reached the provider.
	deadline := time.Now().Add(2 * time.Second)
	for atomic.LoadInt32(calls) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if atomic.LoadInt32(calls) == 0 {
		t.Fatal("first request never reached the provider")
	}

	if _, err := g.Generate(context.Background(), "第二张"); !errors.Is(err, ErrImageGenBusy) {
		t.Fatalf("expected ErrImageGenBusy, got %v", err)
	}
	close(release)
	if err := <-first; err != nil {
		t.Fatalf("first generate: %v", err)
	}
	if got := atomic.LoadInt32(calls); got != 1 {
		t.Fatalf("provider should have been called once, got %d", got)
	}
}

func TestImageGen_ProviderErrorKeepsTheReason(t *testing.T) {
	srv, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		http.Error(w, `{"error":{"message":"quota exceeded for this key"}}`, http.StatusTooManyRequests)
		return true
	})
	g := testImageGenerator(t, srv.URL)
	_, err := g.Generate(context.Background(), "x")
	if err == nil || !strings.Contains(err.Error(), "429") || !strings.Contains(err.Error(), "quota exceeded") {
		t.Fatalf("expected status and provider reason in error, got %v", err)
	}
}

func TestImageGen_RejectsNonPictureBody(t *testing.T) {
	srv, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		_, _ = io.WriteString(w, `{"data":[{"b64_json":"`+base64.StdEncoding.EncodeToString([]byte("<html>not a picture</html>"))+`"}]}`)
		return true
	})
	g := testImageGenerator(t, srv.URL)
	if _, err := g.Generate(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "not a picture") {
		t.Fatalf("expected rejection of non-picture body, got %v", err)
	}
}

func writePicture(t *testing.T, path string) {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(testPNGB64)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

// List must show only pictures, newest first, and Open must refuse names that try to
// walk out of out_dir — the public bytes route depends on that.
//
// Each case below is a way the pre-rework Open let something through; they are together
// because they share one fixture, and each fails on the old guard alone:
//   - "notes.png" holding text: the old code believed the extension and served the bytes
//     as image/png (this test asserted that wrong answer before, which is why it could not
//     catch the symlink case).
//   - "link.png" -> outside secret: os.ReadFile follows it, so the secret came out.
func TestImageGen_ListAndOpenStayInsideOutDir(t *testing.T) {
	out := t.TempDir()
	g := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: out})
	writePicture(t, filepath.Join(out, "gen-a.png"))
	writePicture(t, filepath.Join(out, "gen-b.png"))
	if err := os.WriteFile(filepath.Join(out, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A .png name whose bytes are not a picture.
	if err := os.WriteFile(filepath.Join(out, "notes.png"), []byte("just text"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A symlink inside out_dir pointing at a file outside it.
	outsideDir := t.TempDir()
	outside := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(outside, []byte("TOP-SECRET-OUTSIDE"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(out, "link.png")); err != nil {
		t.Skipf("this filesystem does not support symlinks: %v", err)
	}
	// A symlink to a *real picture* held outside out_dir. The content sniff would accept it,
	// so only the link/realpath guard can refuse this one — otherwise the route serves a
	// picture that lives anywhere on this machine.
	outsidePic := filepath.Join(outsideDir, "outside.png")
	writePicture(t, outsidePic)
	if err := os.Symlink(outsidePic, filepath.Join(out, "picture-link.png")); err != nil {
		t.Skipf("this filesystem does not support symlinks: %v", err)
	}

	got := g.List(10)
	if len(got) != 2 {
		t.Fatalf("expected the 2 real pictures, got %d: %v", len(got), got)
	}
	if !strings.HasPrefix(got[0].URL, "/api/v1/image-gen/file/") {
		t.Fatalf("unexpected url %q", got[0].URL)
	}
	for _, bad := range []string{"../config.toml", "sub/gen-a.png", "", "notes.txt", "notes.png", "link.png", "picture-link.png", "gen-a.png/../gen-b.png"} {
		if _, _, err := g.Open(bad); err == nil {
			t.Fatalf("Open(%q) should have failed", bad)
		}
	}
	if b, mime, err := g.Open("gen-a.png"); err != nil || mime != "image/png" || len(b) == 0 {
		t.Fatalf("Open(gen-a.png) = %q, %v", mime, err)
	}
}

// An answer over the cap must say so; it used to be truncated into "unexpected end of JSON
// input", which points at the wrong thing entirely.
func TestImageGen_OversizedAnswerSaysSo(t *testing.T) {
	big := strings.Repeat("x", int(imageGenMaxBytes)+8)
	srv, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + big + `"}]}`))
		return true
	})
	g := testImageGenerator(t, srv.URL)
	_, err := g.Generate(context.Background(), "太大的图")
	if err == nil || !strings.Contains(err.Error(), "MiB") {
		t.Fatalf("oversized answer: err=%v, want it to name the size limit", err)
	}
}

// out_dir outside data_dir must be refused at construction: the bytes route is unauthenticated,
// so a wide out_dir turns it into "read any picture on this machine by name".
func TestImageGen_RefusesOutDirOutsideDataDir(t *testing.T) {
	dataDir := t.TempDir()
	outside := t.TempDir()
	g := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: outside, DataDir: dataDir})
	if err := g.OutDirError(); err == nil {
		t.Fatalf("out_dir %s outside data_dir %s was accepted", outside, dataDir)
	}
	if _, err := g.Generate(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "data_dir") {
		t.Fatalf("Generate should refuse a wide out_dir, got %v", err)
	}
	if _, _, err := g.Open("anything.png"); err == nil {
		t.Fatalf("Open should refuse while out_dir is refused")
	}
	// List must not enumerate a directory this generator was told not to use.
	writePicture(t, filepath.Join(filepath.Dir(g.OutDir()), "foreign.png"))
	if got := g.List(10); len(got) != 0 {
		t.Fatalf("List listed %d pictures from a refused out_dir: %v", len(got), got)
	}

	// The default sits under data_dir and is accepted.
	ok := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", DataDir: dataDir})
	if err := ok.OutDirError(); err != nil {
		t.Fatalf("default out_dir under data_dir refused: %v", err)
	}
	if want := filepath.Join(dataDir, "images"); ok.OutDir() != want {
		t.Fatalf("default out_dir = %q, want %q", ok.OutDir(), want)
	}
	// A subdirectory of data_dir is fine too.
	sub := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: filepath.Join(dataDir, "drawings"), DataDir: dataDir})
	if err := sub.OutDirError(); err != nil {
		t.Fatalf("subdirectory of data_dir refused: %v", err)
	}
	// A sibling that merely shares the prefix ("/x/data2" vs "/x/data") must not pass.
	sibling := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: dataDir + "2", DataDir: dataDir})
	if err := sibling.OutDirError(); err == nil {
		t.Fatalf("a sibling directory sharing the prefix was accepted")
	}
}

// A symlinked out_dir itself must be judged by where it really points.
func TestImageGen_OutDirSymlinkIsResolved(t *testing.T) {
	dataDir := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(dataDir, "images")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("this filesystem does not support symlinks: %v", err)
	}
	g := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: link, DataDir: dataDir})
	if err := g.OutDirError(); err == nil {
		t.Fatalf("an out_dir symlinked out of data_dir was accepted")
	}
}

// Two pictures finished in the same second used to get the same name and the second quietly
// overwrote the first; the name now carries a random suffix and never reuses a taken name.
func TestImageGen_NamesDoNotCollide(t *testing.T) {
	srv, _ := stubImageAPI(t, nil)
	g := testImageGenerator(t, srv.URL)
	seen := map[string]bool{}
	for i := 0; i < 5; i++ {
		res, err := g.Generate(context.Background(), "同一秒里连着画")
		if err != nil {
			t.Fatalf("generate %d: %v", i, err)
		}
		if seen[res.Name] {
			t.Fatalf("name %q was reused", res.Name)
		}
		seen[res.Name] = true
	}
	entries, err := os.ReadDir(g.OutDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 5 {
		t.Fatalf("expected 5 files on disk, got %d", len(entries))
	}
}

// The public bytes route is the one that needs proving at the HTTP layer, with the same
// fixtures the unit test uses: a link out, a text file named .png, and a name that walks.
func TestMgmt_ImageGenFileRouteRefusesEscapes(t *testing.T) {
	out := t.TempDir()
	writePicture(t, filepath.Join(out, "gen-ok.png"))
	if err := os.WriteFile(filepath.Join(out, "notes.png"), []byte("just text"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("TOP-SECRET-OUTSIDE-1032"), 0o600); err != nil {
		t.Fatal(err)
	}
	linked := true
	if err := os.Symlink(outside, filepath.Join(out, "link.png")); err != nil {
		linked = false
	}
	// Same trick at the HTTP layer: a link to a real picture outside out_dir.
	outsidePic := filepath.Join(filepath.Dir(outside), "outside.png")
	writePicture(t, outsidePic)
	if err := os.Symlink(outsidePic, filepath.Join(out, "picture-link.png")); err != nil {
		linked = false
	}
	g := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: out})
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetImageGenerator(g)

	cases := map[string]int{
		"gen-ok.png":             http.StatusOK,
		"notes.png":              http.StatusNotFound,
		"..%2fconfig.toml":       http.StatusNotFound,
		"sub%2fgen-ok.png":       http.StatusNotFound,
		"missing.png":            http.StatusNotFound,
		"gen-ok.png%00.txt":      http.StatusNotFound,
		"..%2f..%2fetc%2fpasswd": http.StatusNotFound,
	}
	if linked {
		cases["link.png"] = http.StatusNotFound
		cases["picture-link.png"] = http.StatusNotFound
	}
	for name, want := range cases {
		resp, err := http.Get(ts.URL + "/api/v1/image-gen/file/" + name)
		if err != nil {
			t.Fatalf("GET %s: %v", name, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("GET %s = %d, want %d (body %q)", name, resp.StatusCode, want, string(body))
		}
		if want == http.StatusOK {
			if ct := resp.Header.Get("Content-Type"); ct != "image/png" {
				t.Fatalf("GET %s Content-Type = %q, want image/png", name, ct)
			}
			continue
		}
		if strings.Contains(string(body), "TOP-SECRET") {
			t.Fatalf("GET %s leaked the outside file", name)
		}
	}
}

// postWithStatus posts and keeps the HTTP status: the page branches on 400/409/502/503, and
// asserting only the envelope let a flipped code pass (review 1032, 06:33).
func postWithStatus(t *testing.T, url, token string, body any) (mgmtResponse, int) {
	t.Helper()
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		t.Fatalf("encode body: %v", err)
	}
	req, _ := http.NewRequest("POST", url, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	var r mgmtResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		t.Fatalf("decode POST response: %v", err)
	}
	return r, resp.StatusCode
}

// The status codes the page branches on: 503 when off, 400 for an empty prompt, 409 while
// another picture is still drawing, 502 when the provider fails. Each was unasserted before,
// so flipping one kept the suite green (review 1032, 06:33).
func TestMgmt_ImageGenStatusCodes(t *testing.T) {
	// 503: no generator wired.
	_, bare, _ := testManagementServer(t, "tok")
	off, code := postWithStatus(t, bare.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "x"})
	if off.OK || code != http.StatusServiceUnavailable || !strings.Contains(off.Error, "not configured") {
		t.Fatalf("no generator: ok=%v code=%d error=%q, want 503 not configured", off.OK, code, off.Error)
	}

	// 400: an empty prompt is the caller's mistake, not the provider's.
	srv, calls := stubImageAPI(t, nil)
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetImageGenerator(testImageGenerator(t, srv.URL))
	empty, code := postWithStatus(t, ts.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "   "})
	if empty.OK || code != http.StatusBadRequest || !strings.Contains(empty.Error, "prompt") {
		t.Fatalf("empty prompt: ok=%v code=%d error=%q, want 400 naming the prompt", empty.OK, code, empty.Error)
	}
	if got := atomic.LoadInt32(calls); got != 0 {
		t.Fatalf("an empty prompt reached the provider %d times; it costs money", got)
	}

	// 409: one picture at a time. Hold the first inside the provider, then ask again.
	release := make(chan struct{})
	slow, slowCalls := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		<-release
		return false
	})
	slowMgmt, slowTS, _ := testManagementServer(t, "tok")
	slowMgmt.SetImageGenerator(testImageGenerator(t, slow.URL))
	type answer struct {
		res  mgmtResponse
		code int
	}
	firstDone := make(chan answer, 1)
	go func() {
		res, code := postWithStatus(t, slowTS.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "第一张"})
		firstDone <- answer{res, code}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for atomic.LoadInt32(slowCalls) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if atomic.LoadInt32(slowCalls) == 0 {
		t.Fatal("the first draw never reached the provider")
	}
	busy, code := postWithStatus(t, slowTS.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "第二张"})
	close(release)
	if first := <-firstDone; !first.res.OK || first.code != http.StatusOK {
		t.Fatalf("first draw failed: %s (code %d)", first.res.Error, first.code)
	}
	if busy.OK || code != http.StatusConflict || !strings.Contains(busy.Error, "still being generated") {
		t.Fatalf("second draw: ok=%v code=%d error=%q, want 409 busy", busy.OK, code, busy.Error)
	}

	// 502: the provider answered with an error; the reason must survive to the page.
	bad, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		http.Error(w, `{"error":{"message":"quota exceeded"}}`, http.StatusTooManyRequests)
		return true
	})
	badMgmt, badTS, _ := testManagementServer(t, "tok")
	badMgmt.SetImageGenerator(testImageGenerator(t, bad.URL))
	failed, code := postWithStatus(t, badTS.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "x"})
	if failed.OK || code != http.StatusBadGateway || !strings.Contains(failed.Error, "429") || !strings.Contains(failed.Error, "quota exceeded") {
		t.Fatalf("provider failure: ok=%v code=%d error=%q, want 502 carrying 429 and the reason", failed.OK, code, failed.Error)
	}
}

// No token means anyone on the network can draw with the owner's key: spending must be
// refused while reading the status stays available.
func TestMgmt_ImageGenSpendNeedsAToken(t *testing.T) {
	srv, calls := stubImageAPI(t, nil)
	// testManagementServer with an empty token: authenticate() lets every request through.
	mgmt, ts, _ := testManagementServer(t, "")
	mgmt.SetImageGenerator(testImageGenerator(t, srv.URL))

	noToken, code := postWithStatus(t, ts.URL+"/api/v1/image-gen", "", map[string]string{"prompt": "unauth spend test"})
	if noToken.OK || code != http.StatusForbidden || !strings.Contains(noToken.Error, "token") {
		t.Fatalf("untokened draw: ok=%v code=%d error=%q, want 403 naming the token", noToken.OK, code, noToken.Error)
	}
	if got := atomic.LoadInt32(calls); got != 0 {
		t.Fatalf("an untokened request reached the provider %d times; it spends the owner's money", got)
	}
	// Reading the status is not spending, so it stays open.
	if r := mgmtGet(t, ts.URL+"/api/v1/image-gen", ""); !r.OK {
		t.Fatalf("status without a token should still answer, got %q", r.Error)
	}
}

// A refused out_dir must be visible in the status call, not discovered at draw time.
func TestMgmt_ImageGenReportsRefusedOutDir(t *testing.T) {
	dataDir := t.TempDir()
	outside := t.TempDir()
	g := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: outside, DataDir: dataDir})
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetImageGenerator(g)

	r := mgmtGet(t, ts.URL+"/api/v1/image-gen", "tok")
	var st struct {
		Status  string `json:"status"`
		CanDraw bool   `json:"can_draw"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(r.Data, &st); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if st.Status != "error" || st.CanDraw || !strings.Contains(st.Message, "data_dir") {
		t.Fatalf("status = %+v, want error naming data_dir", st)
	}
	var withPics struct {
		Pictures []ImageGenResult `json:"pictures"`
	}
	if err := json.Unmarshal(r.Data, &withPics); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if len(withPics.Pictures) != 0 {
		t.Fatalf("a refused out_dir still listed %d pictures", len(withPics.Pictures))
	}
	post, code := postWithStatus(t, ts.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "x"})
	if post.OK || code != http.StatusServiceUnavailable || !strings.Contains(post.Error, "data_dir") {
		t.Fatalf("draw with a refused out_dir: ok=%v code=%d error=%q, want 503 naming data_dir", post.OK, code, post.Error)
	}
}

func TestMgmt_ImageGenNotConfigured(t *testing.T) {
	_, ts, _ := testManagementServer(t, "tok")

	r := mgmtGet(t, ts.URL+"/api/v1/image-gen", "tok")
	if !r.OK {
		t.Fatalf("status should succeed even without [image_gen], got: %s", r.Error)
	}
	var st struct {
		Status   string `json:"status"`
		CanDraw  bool   `json:"can_draw"`
		Pictures []any  `json:"pictures"`
	}
	if err := json.Unmarshal(r.Data, &st); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if st.Status != "not_configured" || st.CanDraw {
		t.Fatalf("unexpected status: %+v", st)
	}

	post := mgmtPost(t, ts.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "x"})
	if post.OK || !strings.Contains(post.Error, "not configured") {
		t.Fatalf("expected 503 not configured, got ok=%v error=%q", post.OK, post.Error)
	}

	resp, err := http.Get(ts.URL + "/api/v1/image-gen/file/gen-a.png")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unconfigured file route should 404, got %d", resp.StatusCode)
	}
}

func TestMgmt_ImageGenDrawsAndServesPicture(t *testing.T) {
	srv, _ := stubImageAPI(t, nil)
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetImageGenerator(testImageGenerator(t, srv.URL))

	st := mgmtGet(t, ts.URL+"/api/v1/image-gen", "tok")
	var stBody struct {
		Status    string           `json:"status"`
		CanDraw   bool             `json:"can_draw"`
		APIKeySet bool             `json:"api_key_set"`
		Model     string           `json:"model"`
		Pictures  []ImageGenResult `json:"pictures"`
	}
	if err := json.Unmarshal(st.Data, &stBody); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if stBody.Status != "ready" || !stBody.CanDraw || !stBody.APIKeySet || stBody.Model != "gpt-image-1" {
		t.Fatalf("unexpected status: %+v", stBody)
	}
	if strings.Contains(string(st.Data), "test-key") {
		t.Fatalf("status leaked the api key: %s", st.Data)
	}

	r := mgmtPost(t, ts.URL+"/api/v1/image-gen", "tok", map[string]string{"prompt": "一只猫"})
	if !r.OK {
		t.Fatalf("generate failed: %s", r.Error)
	}
	var res ImageGenResult
	if err := json.Unmarshal(r.Data, &res); err != nil {
		t.Fatalf("decode result: %v", err)
	}

	// The bytes route is public on purpose (<img> cannot send a Bearer header), so it must
	// serve exactly the picture that was just written, and nothing else.
	noToken, err := http.Get(ts.URL + res.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer noToken.Body.Close()
	body, _ := io.ReadAll(noToken.Body)
	if noToken.StatusCode != http.StatusOK {
		t.Fatalf("picture without token: %d", noToken.StatusCode)
	}
	if noToken.Header.Get("Content-Type") != "image/png" || noToken.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unexpected headers: %v", noToken.Header)
	}
	if len(body) == 0 || res.Bytes != len(body) {
		t.Fatalf("served %d bytes, result said %d", len(body), res.Bytes)
	}

	traversal, err := http.Get(ts.URL + "/api/v1/image-gen/file/..%2fconfig.toml")
	if err != nil {
		t.Fatal(err)
	}
	traversal.Body.Close()
	if traversal.StatusCode != http.StatusNotFound {
		t.Fatalf("traversal should 404, got %d", traversal.StatusCode)
	}

	// A second GET lists the picture the POST wrote.
	again := mgmtGet(t, ts.URL+"/api/v1/image-gen", "tok")
	if err := json.Unmarshal(again.Data, &stBody); err != nil {
		t.Fatalf("decode second status: %v", err)
	}
	if len(stBody.Pictures) != 1 || stBody.Pictures[0].Name != res.Name {
		t.Fatalf("expected the new picture in the list, got %+v", stBody.Pictures)
	}
}

// The status echo used to return [image_gen.openai] base_url verbatim. A relay URL that
// carries a key in its userinfo or query string therefore handed the key to anyone who
// could read the management API (review 466). The endpoint must stay visible, the secret
// must not.
func TestImageGen_StatusRedactsBaseURLCredentials(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	g := NewImageGenerator(ImageGenConfig{
		Enabled: true, Provider: "openai", APIKey: "test-key",
		BaseURL: "https://relay-user:sk-userinfo-secret@relay.example/v1?token=sk-query-secret&size=1024x1024",
		Model:   "gpt-image-1", OutDir: t.TempDir(),
	})
	mgmt.SetImageGenerator(g)

	r := mgmtGet(t, ts.URL+"/api/v1/image-gen", "tok")
	body := string(r.Data)
	for _, secret := range []string{"sk-userinfo-secret", "sk-query-secret"} {
		if strings.Contains(body, secret) {
			t.Fatalf("status echoed %q: %s", secret, body)
		}
	}
	var st struct {
		BaseURL string `json:"base_url"`
	}
	if err := json.Unmarshal(r.Data, &st); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !strings.Contains(st.BaseURL, "relay.example/v1") {
		t.Fatalf("base_url lost the endpoint itself: %q", st.BaseURL)
	}
	if !strings.Contains(st.BaseURL, "size=1024x1024") {
		t.Fatalf("base_url dropped an ordinary query parameter: %q", st.BaseURL)
	}

	// An ordinary endpoint comes back exactly as configured: the panel shows it, and a
	// value with nothing to hide must not grow "***" out of nowhere.
	plain, plainTS, _ := testManagementServer(t, "tok")
	plain.SetImageGenerator(testImageGenerator(t, "https://api.openai.com/v1"))
	pr := mgmtGet(t, plainTS.URL+"/api/v1/image-gen", "tok")
	var pst struct {
		BaseURL string `json:"base_url"`
	}
	if err := json.Unmarshal(pr.Data, &pst); err != nil {
		t.Fatalf("decode plain status: %v", err)
	}
	if pst.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("ordinary base_url changed: %q", pst.BaseURL)
	}
}

// A provider call that fails at the transport leaves a *url.Error quoting the request URL.
// Go masks a userinfo password but keeps the user name and the whole query string, so the
// key survived into the 502 text and the log (review 466).
func TestImageGen_RequestErrorsHideURLCredentials(t *testing.T) {
	// Nothing listens on port 1: the dial fails before any request leaves the machine.
	g := NewImageGenerator(ImageGenConfig{
		Enabled: true, Provider: "openai", APIKey: "test-key",
		BaseURL: "https://relay-user:sk-userinfo-secret@127.0.0.1:1/v1?token=sk-query-secret",
		Model:   "gpt-image-1", OutDir: t.TempDir(),
	})
	_, err := g.Generate(context.Background(), "x")
	if err == nil {
		t.Fatal("expected the dial to fail on port 1")
	}
	for _, secret := range []string{"sk-userinfo-secret", "sk-query-secret"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("request error leaked %q: %v", secret, err)
		}
	}
	if !strings.Contains(err.Error(), "***") {
		t.Fatalf("request error should show a masked URL, got: %v", err)
	}
}

// Masking must not turn the error into an opaque string: a cancelled draw still has to be
// recognisable as a cancellation, because that is what the caller acts on.
func TestImageGen_RequestErrorKeepsTheCause(t *testing.T) {
	g := NewImageGenerator(ImageGenConfig{
		Enabled: true, Provider: "openai", APIKey: "test-key",
		BaseURL: "https://relay.example/v1?token=sk-query-secret", Model: "gpt-image-1", OutDir: t.TempDir(),
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := g.Generate(ctx, "x")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("masked request error lost context.Canceled: %v", err)
	}
	if strings.Contains(err.Error(), "sk-query-secret") {
		t.Fatalf("cancelled request leaked the query key: %v", err)
	}
}

// Provider error bodies are forwarded to the page because they explain a bad key, model or
// quota. A relay that quotes the request URL in that body was quoting the key with it.
func TestImageGen_ProviderErrorBodyRedactsURLCredentials(t *testing.T) {
	srv, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		http.Error(w, `{"error":{"message":"bad request to https://relay.example/v1/images/generations?token=sk-body-secret&model=gpt-image-1"}}`, http.StatusBadRequest)
		return true
	})
	g := NewImageGenerator(ImageGenConfig{
		Enabled: true, Provider: "openai", APIKey: "test-key",
		BaseURL: srv.URL, Model: "gpt-image-1", OutDir: t.TempDir(),
	})
	_, err := g.Generate(context.Background(), "x")
	if err == nil {
		t.Fatal("expected the provider error to surface")
	}
	if strings.Contains(err.Error(), "sk-body-secret") {
		t.Fatalf("provider error leaked the query key: %v", err)
	}
	if !strings.Contains(err.Error(), "bad request") || !strings.Contains(err.Error(), "model=gpt-image-1") {
		t.Fatalf("provider error lost the reason it exists for: %v", err)
	}
}

// The download step takes a URL from the provider's answer, and a signed link carries its
// own key. Its transport error must not print that key either.
func TestImageGen_DownloadErrorsHideURLCredentials(t *testing.T) {
	srv, _ := stubImageAPI(t, func(w http.ResponseWriter, r *http.Request) bool {
		_, _ = io.WriteString(w, `{"data":[{"url":"http://127.0.0.1:1/pic.png?sig=sk-signed-secret&expires=1"}]}`)
		return true
	})
	g := NewImageGenerator(ImageGenConfig{
		Enabled: true, Provider: "openai", APIKey: "test-key",
		BaseURL: srv.URL, Model: "gpt-image-1", OutDir: t.TempDir(),
	})
	_, err := g.Generate(context.Background(), "x")
	if err == nil {
		t.Fatal("expected the download to fail on port 1")
	}
	if strings.Contains(err.Error(), "sk-signed-secret") {
		t.Fatalf("download error leaked the signed link's key: %v", err)
	}
}

func TestRedactURLSecrets(t *testing.T) {
	cases := []struct{ in, want string }{
		{"https://api.openai.com/v1", "https://api.openai.com/v1"},
		{"https://api.openai.com/v1?size=1024x1024", "https://api.openai.com/v1?size=1024x1024"},
		{"https://user:sk-pass@relay.example/v1", "https://***@relay.example/v1"},
		{"https://sk-bare@relay.example/v1", "https://***@relay.example/v1"},
		{"https://relay.example/v1?token=sk-q&size=1024x1024", "https://relay.example/v1?token=***&size=1024x1024"},
		{"https://relay.example/v1?x-api-key=sk-k", "https://relay.example/v1?x-api-key=***"},
		{"http://127.0.0.1:8080?x=1", "http://127.0.0.1:8080?x=1"},
		{`Post "https://user:sk-p@relay/v1?token=sk-q": EOF`, `Post "https://***@relay/v1?token=***": EOF`},
	}
	for _, c := range cases {
		if got := redactURLSecrets(c.in); got != c.want {
			t.Fatalf("redactURLSecrets(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
