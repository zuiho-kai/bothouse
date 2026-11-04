package main

import "testing"

func TestSessionKeyFromFallsBackToDSHAlias(t *testing.T) {
	env := map[string]string{"CC_SESSION": " discord:1 "}
	if got := sessionKeyFrom(func(k string) string { return env[k] }); got != "discord:1" {
		t.Fatalf("alias: got %q", got)
	}
	env["CC_SESSION_KEY"] = "discord:2"
	if got := sessionKeyFrom(func(k string) string { return env[k] }); got != "discord:2" {
		t.Fatalf("primary wins: got %q", got)
	}
}
