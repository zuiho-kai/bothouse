package qq

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReceiveMediaRejectsHTTPErrorBodies(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusInternalServerError, http.StatusPartialContent} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/valid" {
					w.Header().Set("Content-Type", "image/png")
					_, _ = w.Write([]byte("valid-image"))
					return
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte("error-page-or-partial-media"))
			}))
			defer media.Close()
			data, _, err := downloadFile(media.URL + "/failed")
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("HTTP %d", status)) || len(data) != 0 {
				t.Errorf("download returned %q, %v; want no bytes and HTTP %d error", data, err, status)
			}
			for _, kind := range []string{"image", "record"} {
				t.Run(kind, func(t *testing.T) {
					f := newFakeOneBot(t)
					_, msgs := startTestPlatform(t, f)
					event := privateMessage(2001, 101, textSegment("look"))
					event["message"] = fmt.Sprintf("look[CQ:%s,file=sample.mp3,url=%s/failed][CQ:image,url=%s/valid]", kind, media.URL, media.URL)
					f.push(event)
					m := awaitMessage(t, msgs)
					if m.Content != "look" || m.Audio != nil || len(m.Images) != 1 || string(m.Images[0].Data) != "valid-image" || m.Images[0].MimeType != "image/png" {
						t.Fatalf("failed media leaked or valid sibling lost: content=%q images=%+v audio=%+v", m.Content, m.Images, m.Audio)
					}
				})
			}
		})
	}
}

func TestReceiveMediaAcceptsSuccessfulRedirect(t *testing.T) {
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/valid", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("voice-bytes"))
	}))
	defer media.Close()
	for _, path := range []string{"/valid", "/redirect"} {
		t.Run(path, func(t *testing.T) {
			data, mime, err := downloadFile(media.URL + path)
			if err != nil || string(data) != "voice-bytes" || mime != "audio/mpeg" {
				t.Fatalf("download = %q, %q, %v", data, mime, err)
			}
			f := newFakeOneBot(t)
			_, msgs := startTestPlatform(t, f)
			event := privateMessage(2001, 102)
			event["message"] = fmt.Sprintf("[CQ:record,file=sample.mp3,url=%s%s]", media.URL, path)
			f.push(event)
			m := awaitMessage(t, msgs)
			if m.Audio == nil || string(m.Audio.Data) != "voice-bytes" || m.Audio.Format != "mp3" {
				t.Fatalf("audio = %+v, want intact mp3", m.Audio)
			}
		})
	}
}
