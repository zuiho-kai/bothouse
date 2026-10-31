package qq

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"testing"
)

func TestOversizedUndecodablePreviewIsOmitted(t *testing.T) {
	data := bytes.Repeat([]byte("x"), shrinkMaxBytes+1)
	got, _ := shrinkImage(data, "image/webp")
	if len(got) != 0 {
		t.Fatalf("oversized undecodable image forwarded: %d bytes", len(got))
	}
}

// A big image (noise PNG well over shrinkMaxBytes) comes out a small JPEG with
// its longer edge capped; a small one is untouched.
func TestShrinkImage(t *testing.T) {
	const w, h = 3000, 2000 // 测试常量：大图尺寸
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	r := rand.New(rand.NewSource(1))
	for i := range img.Pix {
		img.Pix[i] = uint8(r.Intn(256))
	}
	var big bytes.Buffer
	if err := png.Encode(&big, img); err != nil {
		t.Fatal(err)
	}
	if big.Len() <= shrinkMaxBytes {
		t.Fatalf("fixture %d bytes not above threshold", big.Len())
	}
	out, mime := shrinkImage(big.Bytes(), "image/png")
	if mime != "image/jpeg" || len(out) >= big.Len() {
		t.Fatalf("mime=%s bytes=%d (from %d)", mime, len(out), big.Len())
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(out))
	if err != nil || cfg.Width != shrinkMaxSide || cfg.Height != shrinkMaxSide*h/w {
		t.Fatalf("decoded %+v err=%v", cfg, err)
	}

	small := image.NewRGBA(image.Rect(0, 0, 10, 10))
	small.Set(0, 0, color.Black)
	var sb bytes.Buffer
	_ = png.Encode(&sb, small)
	if got, m := shrinkImage(sb.Bytes(), "image/png"); m != "image/png" || !bytes.Equal(got, sb.Bytes()) {
		t.Fatal("small image changed")
	}
}
