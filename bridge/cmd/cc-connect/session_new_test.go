package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestSessionNewRequestNeedsSessionEnv(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

	if _, _, err := sessionNewRequest([]string{"--after-turn"}, env(nil)); err == nil {
		t.Fatal("missing CC_PROJECT/CC_SESSION_KEY must fail")
	}
	if _, _, err := sessionNewRequest([]string{"--after-turn"}, env(map[string]string{"CC_PROJECT": "p"})); err == nil {
		t.Fatal("missing CC_SESSION_KEY must fail")
	}
	full := env(map[string]string{"CC_PROJECT": "p", "CC_SESSION_KEY": "discord:1", "CC_DATA_DIR": "/d"})
	if _, _, err := sessionNewRequest(nil, full); err == nil {
		t.Fatal("--after-turn is required")
	}
	if _, _, err := sessionNewRequest([]string{"--after-turn", "extra"}, full); err == nil {
		t.Fatal("stray argument must fail")
	}
	body, sock, err := sessionNewRequest([]string{"--after-turn"}, full)
	if err != nil {
		t.Fatal(err)
	}
	if sock != filepath.Join("/d", "run", "api.sock") {
		t.Fatalf("sock = %q", sock)
	}
	var req map[string]any
	_ = json.Unmarshal(body, &req)
	if req["project"] != "p" || req["session_key"] != "discord:1" || req["after_turn"] != true {
		t.Fatalf("request = %v", req)
	}
}
