package core

import "testing"

// #1922: PNG bytes with a .jpg name and image/jpeg label go to the agent as image/png.
func TestSniffImageMimesPNGNamedJPEG(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	in := []ImageAttachment{{MimeType: "image/jpeg", FileName: "img_0.jpg", Data: png}}
	out := sniffImageMimes(in)
	if out[0].MimeType != "image/png" {
		t.Fatalf("MimeType = %q, want image/png", out[0].MimeType)
	}
	if in[0].MimeType != "image/jpeg" {
		t.Fatalf("caller's message was mutated: %q", in[0].MimeType)
	}
}
