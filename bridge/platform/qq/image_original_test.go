package qq

import (
	"bytes"
	"image"
	"image/color/palette"
	"image/gif"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReceiveLargeGIFKeepsOriginalAndShrinksModelPreview(t *testing.T) {
	anim := &gif.GIF{LoopCount: 0}
	random := rand.New(rand.NewSource(1))
	for i := 0; i < 2; i++ {
		frame := image.NewPaletted(image.Rect(0, 0, 1100, 1100), palette.Plan9)
		_, _ = random.Read(frame.Pix)
		anim.Image = append(anim.Image, frame)
		anim.Delay = append(anim.Delay, 10)
	}
	var encoded bytes.Buffer
	if err := gif.EncodeAll(&encoded, anim); err != nil {
		t.Fatal(err)
	}
	original := encoded.Bytes()
	if len(original) <= shrinkMaxBytes {
		t.Fatal("fixture must exercise shrinking")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/gif")
		_, _ = w.Write(original)
	}))
	defer server.Close()
	f := newFakeOneBot(t)
	p, msgs := startTestPlatform(t, f)
	dir := t.TempDir()
	p.saveImagesDir = dir
	f.push(privateMessage(20001, 78, map[string]any{"type": "image", "data": map[string]any{"url": server.URL + "/animated.gif"}}))
	m := awaitMessage(t, msgs)
	path := filepath.Join(dir, "78-1.gif")
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, original) {
		t.Fatal("saved sticker is not the original GIF")
	}
	decoded, err := gif.DecodeAll(bytes.NewReader(saved))
	if err != nil || len(decoded.Image) != 2 {
		t.Fatalf("animation lost: %v", err)
	}
	if !strings.Contains(m.ExtraContent, path) {
		t.Fatal("original path absent from prompt")
	}
	if len(m.Images) != 1 || m.Images[0].MimeType != "image/jpeg" {
		t.Fatal("expected model JPEG preview")
	}
	if bytes.Equal(m.Images[0].Data, original) {
		t.Fatal("model preview was not shrunk")
	}
}
