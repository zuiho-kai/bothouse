package core

import (
	"net/http"
	"strings"
)

// SniffImageMime returns the image type the bytes really are. Platforms often label a
// PNG screenshot as image/jpeg (file name .jpg); strict agents (DSH over ACP) reject a
// declared type that does not match the bytes, so the bytes win. The declared type is
// kept only when the bytes are not a recognisable image.
func SniffImageMime(declared string, data []byte) string {
	if len(data) > 0 {
		if mt := http.DetectContentType(data); strings.HasPrefix(mt, "image/") {
			return mt
		}
	}
	return strings.ToLower(strings.TrimSpace(declared))
}

// sniffImageMimes returns images with MimeType set from their bytes. It copies the
// slice when a type changes, so a caller's message is never mutated.
func sniffImageMimes(images []ImageAttachment) []ImageAttachment {
	var out []ImageAttachment
	for i, img := range images {
		mt := SniffImageMime(img.MimeType, img.Data)
		if mt == img.MimeType {
			continue
		}
		if out == nil {
			out = append([]ImageAttachment(nil), images...)
		}
		out[i].MimeType = mt
	}
	if out == nil {
		return images
	}
	return out
}
