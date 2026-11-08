package core

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writePetFixture(t *testing.T, root, name string, data []byte) {
	t.Helper()
	file := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func generatedPetFrames(t *testing.T) []byte {
	t.Helper()
	sheet := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			sheet.Set(x, y, color.NRGBA{R: uint8(x * 50), G: uint8(y * 100), A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, sheet); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func generatedPetWebM(t *testing.T) []byte {
	t.Helper()
	// Locally generated black frame: ffmpeg lavfi color 16x16, 1 fps, 1 VP9 frame.
	// Kept as bytes in a test, never a downloaded or third-party media asset.
	b, err := base64.StdEncoding.DecodeString("GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAH1EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggHf7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDJXQYxMYXZmNjMuMS4xMDJEiYhAj0AAAAAAABZUrmvXrgEAAAAAAABO14EBc8WIwvWxnhdV1uicgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4Q7msoA4JCwgRC6gRCagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/5zc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAyc3PZY8CLY8WIwvWxnhdV1uhnyKRFo4dFTkNPREVSRIeXTGF2YzYzLjEuMTAyIGxpYnZweC12cDlnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1peeBAKOggQAAgIJJg0IAAPAA9gA4JBwYSgAAMGAAABC///1IjAAcU7trkbuPs4EAt4r3gQHxggG18IED")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func petTestHandler(t *testing.T, dataDir string) http.Handler {
	t.Helper()
	m := NewManagementServer(0, "pet-test-token", nil)
	m.SetWizard(nil, dataDir)
	return m.buildHandler(http.NewServeMux())
}

func petRequest(handler http.Handler, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, req)
	return out
}

func TestPetPacksFormatsAndErrors(t *testing.T) {
	data := t.TempDir()
	root := filepath.Join(data, "pets")
	// The full actions table has two actions, while the small manifest has only idle.
	manifest := `{"name":"Generated test pack","idleAnimationId":"idle","animations":[{"id":"idle","file":"sheet.png","frameWidth":2,"frameHeight":2,"columns":2,"frameCount":2,"fps":1}]}`
	writePetFixture(t, root, "sprite/manifest.json", []byte(manifest))
	writePetFixture(t, root, "sprite/sheet.png", generatedPetFrames(t))
	writePetFixture(t, root, "sprite/actions.json", []byte(`{"animations":[{"id":"idle","sources":{"webp":"sheet.png"},"spritesheet":{"frameWidth":2,"frameHeight":2,"columns":2,"frameCount":2,"fps":1}},{"id":"working","file":"sheet.png","frameWidth":2,"frameHeight":2,"columns":2,"frameCount":2,"fps":1}]}`))
	writePetFixture(t, root, "video/assets/config.jsonc", []byte("{ // generated config\n\"animations\":{\"idle\":[\"idle\"],\"categories\":[{\"id\":\"label-is-not-a-file\",\"actions\":[\"coding\"]}]},}"))
	for _, name := range []string{"idle", "coding"} {
		writePetFixture(t, root, "video/assets/webm/"+name+".webm", generatedPetWebM(t))
	}
	writePetFixture(t, root, "kind/pet/fish-config.json", []byte(`{"animations":{"idle":["rest"]}}`))
	writePetFixture(t, root, "kind/pet/fish-animation/rest.webm", generatedPetWebM(t))
	writePetFixture(t, root, "broken/manifest.json", []byte("{"))
	writePetFixture(t, root, "broken-actions/manifest.json", []byte(manifest))
	writePetFixture(t, root, "broken-actions/actions.json", []byte("{"))
	writePetFixture(t, root, "missing-media/manifest.json", []byte(manifest))
	handler := petTestHandler(t, data)
	out := petRequest(handler, "/api/v1/plugins/pets", "pet-test-token")
	if out.Code != 200 {
		t.Fatalf("list: %d %s", out.Code, out.Body.String())
	}
	var body struct {
		Data PetPacksResponse `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	packs := map[string]PetPackInfo{}
	for _, pack := range body.Data.Installed {
		packs[pack.ID] = pack
	}
	if len(packs) != 6 {
		t.Fatalf("bad packages were hidden: %+v", packs)
	}
	sprite := packs["sprite"]
	if sprite.Error != "" || sprite.Format != "webp-sprite" || sprite.ActionCount != 2 || sprite.Actions[1].FrameWidth != 2 || sprite.Actions[1].File != "sheet.png" {
		t.Fatalf("normalized sprite: %+v", sprite)
	}
	for _, id := range []string{"video", "kind"} {
		if packs[id].Error != "" || packs[id].Format != "webm" || packs[id].ActionCount == 0 {
			t.Fatalf("video actions: %+v", packs[id])
		}
	}
	if packs["kind"].Actions[0].File != "pet/fish-animation/rest.webm" {
		t.Fatal(packs["kind"])
	}
	for _, id := range []string{"broken", "broken-actions", "missing-media"} {
		if packs[id].Error == "" || len(packs[id].Actions) > 0 {
			t.Fatalf("missing bad pack diagnostic: %+v", packs[id])
		}
	}
	if body.Data.BaseDir != root || sprite.LocalPath != filepath.Join(root, "sprite") {
		t.Fatal("ignored product data root")
	}
}

func TestPetAssetRouteAuthAndContainment(t *testing.T) {
	data := t.TempDir()
	root := filepath.Join(data, "pets")
	pixels := generatedPetFrames(t)
	writePetFixture(t, root, "pack/frame.png", pixels)
	writePetFixture(t, root, "pack/not-media.html", []byte("<html>private</html>"))
	writePetFixture(t, root, "pack/disguised.webp", []byte("<html>private</html>"))
	outside := t.TempDir()
	writePetFixture(t, outside, "secret.png", pixels)
	for _, link := range []struct{ name, target string }{
		{"pack/file-link.png", filepath.Join(outside, "secret.png")},
		{"pack/dir-link", outside},
		{"pack-root-link", outside},
	} {
		if err := os.Symlink(link.target, filepath.Join(root, link.name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("frame.png", filepath.Join(root, "pack/internal.png")); err != nil {
		t.Fatal(err)
	}
	handler := petTestHandler(t, data)
	asset := func(pack, file, token string) *httptest.ResponseRecorder {
		return petRequest(handler, "/api/v1/plugins/pets/asset?"+url.Values{"pack": {pack}, "file": {file}, "token": {token}}.Encode(), "")
	}
	if got := asset("pack", "frame.png", ""); got.Code != 401 {
		t.Fatalf("asset bypassed auth: %d", got.Code)
	}
	if got := petRequest(handler, "/api/v1/plugins/pets", ""); got.Code != 401 {
		t.Fatalf("list bypassed auth: %d", got.Code)
	}
	got := asset("pack", "frame.png", "pet-test-token")
	if got.Code != 200 || !bytes.Equal(got.Body.Bytes(), pixels) || got.Header().Get("Content-Type") != "image/png" || got.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(got.Header().Get("Cache-Control"), "private") {
		t.Fatalf("valid asset: %d %s", got.Code, got.Body.String())
	}
	for _, file := range []string{"../frame.png", "/etc/passwd", "not-media.html", "disguised.webp", "file-link.png", "dir-link/secret.png"} {
		if got := asset("pack", file, "pet-test-token"); got.Code != 403 {
			t.Errorf("%s: %d", file, got.Code)
		}
	}
	if got := asset("pack-root-link", "secret.png", "pet-test-token"); got.Code != 403 {
		t.Errorf("package root link escaped: %d", got.Code)
	}
	if got := asset("pack", "internal.png", "pet-test-token"); got.Code != 200 {
		t.Errorf("in-pack link blocked: %d", got.Code)
	}
	if got := asset("pack", "missing.png", "pet-test-token"); got.Code != 404 {
		t.Errorf("missing asset: %d", got.Code)
	}
}

func TestPetPacksMissingRootIsEmpty(t *testing.T) {
	handler := petTestHandler(t, t.TempDir())
	got := petRequest(handler, "/api/v1/plugins/pets", "pet-test-token")
	if got.Code != 200 || !strings.Contains(got.Body.String(), `"installed":[]`) {
		t.Fatalf("missing root: %d %s", got.Code, got.Body.String())
	}
	m := NewManagementServer(0, "pet-test-token", nil)
	got = petRequest(m.buildHandler(http.NewServeMux()), "/api/v1/plugins/pets", "pet-test-token")
	if got.Code != 503 {
		t.Fatalf("unconfigured product data root silently fell back: %d", got.Code)
	}
}
