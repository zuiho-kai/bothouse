package qqbot

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestAttachmentDownloadSizeLimit(t *testing.T) {
	for _, tc := range []struct {
		name, contentType string
		size              int
		chunked           bool
		want              bool
	}{
		{"image over limit", "image/png", maxAttachmentSize + 1, false, false},
		{"file over limit", "application/pdf", maxAttachmentSize + 1, false, false},
		{"chunked image over limit", "image/png", maxAttachmentSize + 1, true, false},
		{"chunked file over limit", "application/pdf", maxAttachmentSize + 1, true, false},
		{"image exactly at limit", "image/png", maxAttachmentSize, false, true},
		{"file exactly at limit", "application/pdf", maxAttachmentSize, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := bytes.Repeat([]byte{0x7f}, tc.size)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.chunked {
					w.(http.Flusher).Flush() // Force a response without Content-Length.
				} else {
					w.Header().Set("Content-Length", strconv.Itoa(tc.size))
				}
				_, _ = io.Copy(w, bytes.NewReader(data))
			}))
			defer server.Close()
			attachments := []attachment{{ContentType: tc.contentType, URL: server.URL, Filename: "fixture"}}
			var received [][]byte
			if tc.contentType == "image/png" {
				for _, image := range downloadAttachmentImages(attachments) {
					received = append(received, image.Data)
				}
			} else {
				for _, file := range downloadAttachmentFiles(attachments) {
					received = append(received, file.Data)
				}
			}
			if !tc.want {
				if len(received) != 0 {
					t.Fatalf("oversized attachment forwarded as %d truncated bytes", len(received[0]))
				}
				return
			}
			if len(received) != 1 || !bytes.Equal(received[0], data) {
				t.Fatal("attachment at the limit was dropped or changed")
			}
		})
	}
}
