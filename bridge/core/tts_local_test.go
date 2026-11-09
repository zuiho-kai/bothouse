package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalTTSSendsVoiceAndReturnsMP3(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("ID3fake"))
	}))
	defer srv.Close()

	l := NewLocalTTS(srv.URL+"/v1", 0, nil)
	audio, format, err := l.Synthesize(context.Background(), "你好", TTSSynthesisOpts{Voice: "maomao"})
	if err != nil {
		t.Fatal(err)
	}
	if format != "mp3" || string(audio) != "ID3fake" {
		t.Fatalf("format=%s audio=%q", format, audio)
	}
	if got["voice"] != "maomao" || got["input"] != "你好" {
		t.Fatalf("request = %v", got)
	}
}

func TestLocalTTSRequiresVoiceAndSurfacesServerError(t *testing.T) {
	if _, _, err := NewLocalTTS("http://127.0.0.1:1/v1", 0, nil).Synthesize(context.Background(), "x", TTSSynthesisOpts{}); err == nil {
		t.Fatal("want error for empty voice")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"unknown voice 'x'"}`, http.StatusBadRequest)
	}))
	defer srv.Close()
	if _, _, err := NewLocalTTS(srv.URL, 0, nil).Synthesize(context.Background(), "x", TTSSynthesisOpts{Voice: "x"}); err == nil {
		t.Fatal("want error for 400")
	}
}
