package qq

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif" // decode: first frame of animated stickers
	"image/jpeg"
	_ "image/png"
	"log/slog"
)

// shrinkMaxBytes: images above this are re-encoded before reaching the agent.
// 来源：实测 2026-10-29 DeepSeek ACP（dsh-acp CANONICAL_BASE64 正则）对 8MB base64
// 爆栈「Maximum call stack size exceeded」、4MB 正常；2MB 原图约 2.7MB base64，留出余量。
const shrinkMaxBytes = 2 << 20

// shrinkMaxSide caps the longer edge. Source: existing adapter limit in 2db389cd.
const shrinkMaxSide = 1600

// shrinkJPEGQuality for the preview. Source: existing adapter quality in 2db389cd.
const shrinkJPEGQuality = 85

// shrinkImage keeps small images unchanged and produces a bounded JPEG preview
// for larger ones (first GIF frame). A nil result omits an unsafe preview;
// saveImages has already preserved the original when configured.
func shrinkImage(data []byte, mime string) ([]byte, string) {
	if len(data) <= shrinkMaxBytes {
		return data, mime
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		slog.Warn("qq: large image preview omitted (cannot decode)", "bytes", len(data), "mime", mime, "error", err)
		return nil, mime
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, mime
	}
	nw, nh := w, h
	if longer := max(w, h); longer > shrinkMaxSide {
		nw, nh = w*shrinkMaxSide/longer, h*shrinkMaxSide/longer
		nw, nh = max(nw, 1), max(nh, 1)
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	// White under transparent pixels: JPEG has no alpha.
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	for y := 0; y < nh; y++ {
		sy := b.Min.Y + y*h/nh
		for x := 0; x < nw; x++ {
			sx := b.Min.X + x*w/nw
			dst.Set(x, y, blendOver(dst.RGBAAt(x, y), src.At(sx, sy)))
		}
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: shrinkJPEGQuality}); err != nil {
		slog.Warn("qq: shrink image failed", "error", err)
		return nil, mime
	}
	if out.Len() > shrinkMaxBytes {
		slog.Warn("qq: image preview still exceeds limit", "bytes", out.Len())
		return nil, mime
	}
	slog.Info("qq: shrank large image", "from_bytes", len(data), "to_bytes", out.Len(), "w", nw, "h", nh)
	return out.Bytes(), "image/jpeg"
}

// blendOver composites c over the opaque background bg.
func blendOver(bg color.RGBA, c color.Color) color.RGBA {
	r, g, b, a := c.RGBA()
	if a == 0xffff {
		return color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), 0xff}
	}
	inv := 0xffff - a
	mix := func(fg uint32, back uint8) uint8 { return uint8((fg + uint32(back)*0x101*inv/0xffff) >> 8) }
	return color.RGBA{mix(r, bg.R), mix(g, bg.G), mix(b, bg.B), 0xff}
}
