package core

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func withIdleTimeout(t *testing.T, d time.Duration) {
	t.Helper()
	old := downloadIdleTimeout
	downloadIdleTimeout = d
	t.Cleanup(func() { downloadIdleTimeout = old })
}

// A slow but steady download that takes several idle windows in total must finish.
func TestDownloadFileSlowButSteadyNotCut(t *testing.T) {
	withIdleTimeout(t, 200*time.Millisecond)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for i := 0; i < 20; i++ { // 20 x 50ms = 1s total, 5x the idle window
			w.Write([]byte("x"))
			w.(http.Flusher).Flush()
			time.Sleep(50 * time.Millisecond)
		}
	}))
	defer server.Close()
	start := time.Now()
	data, err := downloadFile(server.URL + "/slow")
	if err != nil {
		t.Fatalf("slow download cut off after %s: %v", time.Since(start), err)
	}
	if len(data) != 20 {
		t.Fatalf("got %d bytes, want 20", len(data))
	}
}

// A download that stops sending bytes fails after the idle timeout, not much later.
func TestDownloadFileStalledFails(t *testing.T) {
	withIdleTimeout(t, 200*time.Millisecond)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("partial"))
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	defer close(release)
	start := time.Now()
	_, err := downloadFile(server.URL + "/stall")
	if !errors.Is(err, errDownloadStalled) {
		t.Fatalf("err = %v, want stalled", err)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Fatalf("stall detected after %s", took)
	}
}

// When every source fails, the error names each URL and its own cause.
func TestDownloadReleaseAssetReportsEverySource(t *testing.T) {
	withIdleTimeout(t, 200*time.Millisecond)
	stalled := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("p"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer stalled.Close()
	missing := httptest.NewServer(http.NotFoundHandler())
	defer missing.Close()
	_, _, err := DownloadReleaseAsset([]string{stalled.URL, missing.URL}, "v0.1.1", "linux", "arm64")
	if !errors.Is(err, ErrUpdateDownload) || !errors.Is(err, errDownloadStalled) {
		t.Fatalf("err = %v, want download+stalled", err)
	}
	msg := err.Error()
	for _, want := range []string{stalled.URL + "/v0.1.1/bothouse-linux-arm64", missing.URL + "/v0.1.1/bothouse-linux-arm64", "HTTP 404", "no data for"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("error %q missing %q", msg, want)
		}
	}
}

// A first source that fails falls through to a working second source.
func TestDownloadReleaseAssetFallsThroughToNextSource(t *testing.T) {
	missing := httptest.NewServer(http.NotFoundHandler())
	defer missing.Close()
	payload := "native executable"
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch strings.TrimPrefix(r.URL.Path, "/v0.1.1/") {
		case "bothouse-linux-arm64":
			fmt.Fprint(w, payload)
		case "SHA256SUMS":
			fmt.Fprintf(w, "%x  bothouse-linux-arm64\n", sha256.Sum256([]byte(payload)))
		default:
			http.NotFound(w, r)
		}
	}))
	defer good.Close()
	data, name, err := DownloadReleaseAsset([]string{missing.URL, good.URL}, "v0.1.1", "linux", "arm64")
	if err != nil || name != "bothouse-linux-arm64" || string(data) != payload {
		t.Fatalf("%q %q %v", data, name, err)
	}
}
