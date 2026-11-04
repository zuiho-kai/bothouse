package core

import (
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

// List must show only pictures, newest first, and Open must refuse names that try to
// walk out of out_dir — the public bytes route depends on that.
func TestImageGen_ListAndOpenStayInsideOutDir(t *testing.T) {
	out := t.TempDir()
	g := NewImageGenerator(ImageGenConfig{Enabled: true, APIKey: "k", OutDir: out})
	for _, name := range []string{"gen-a.png", "gen-b.png", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(out, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := g.List(10)
	if len(got) != 2 {
		t.Fatalf("expected 2 pictures, got %d: %v", len(got), got)
	}
	if !strings.HasPrefix(got[0].URL, "/api/v1/image-gen/file/") {
		t.Fatalf("unexpected url %q", got[0].URL)
	}
	for _, bad := range []string{"../config.toml", "sub/gen-a.png", "", "notes.txt"} {
		if _, _, err := g.Open(bad); err == nil {
			t.Fatalf("Open(%q) should have failed", bad)
		}
	}
	if _, mime, err := g.Open("gen-a.png"); err != nil || mime != "text/plain; charset=utf-8" {
		t.Fatalf("Open(gen-a.png) = %q, %v", mime, err)
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
		Status    string          `json:"status"`
		CanDraw   bool            `json:"can_draw"`
		APIKeySet bool            `json:"api_key_set"`
		Model     string          `json:"model"`
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