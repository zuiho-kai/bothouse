package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type handoffCLIAgent struct{}

func (*handoffCLIAgent) Name() string { return "stub" }
func (*handoffCLIAgent) StartSession(_ context.Context, _ string) (core.AgentSession, error) {
	return &handoffCLISession{}, nil
}
func (*handoffCLIAgent) ListSessions(_ context.Context) ([]core.AgentSessionInfo, error) {
	return nil, nil
}
func (*handoffCLIAgent) Stop() error { return nil }

type handoffCLISession struct{}

func (*handoffCLISession) Send(_ string, _ string, _ []core.ImageAttachment, _ []core.FileAttachment) error {
	return nil
}
func (*handoffCLISession) RespondPermission(_ string, _ core.PermissionResult) error { return nil }
func (*handoffCLISession) Events() <-chan core.Event                                 { return make(chan core.Event) }
func (*handoffCLISession) CurrentSessionID() string                                  { return "stub" }
func (*handoffCLISession) Alive() bool                                               { return true }
func (*handoffCLISession) Close() error                                              { return nil }

type handoffCLIPlatform struct{}

func (*handoffCLIPlatform) Name() string                             { return "discord" }
func (*handoffCLIPlatform) Start(core.MessageHandler) error          { return nil }
func (*handoffCLIPlatform) Reply(context.Context, any, string) error { return nil }
func (*handoffCLIPlatform) Send(context.Context, any, string) error  { return nil }
func (*handoffCLIPlatform) Stop() error                              { return nil }

// TestHandoffCLISwitchSocket drives the real CLI command over the real Unix
// socket API, not just the handler in-process.
func TestHandoffCLISwitchSocket(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "bhh-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"lead-a","name":"Lead A"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	a := core.NewEngine("lead-a", &handoffCLIAgent{}, []core.Platform{&handoffCLIPlatform{}}, "", core.LangChinese)
	a.SetDataDir(dir)
	a.SetTeam("", "Lead A", false)
	d := core.NewEngine("lead-d", &handoffCLIAgent{}, []core.Platform{&handoffCLIPlatform{}}, "", core.LangChinese)
	d.SetDataDir(dir)
	d.SetTeam("", "Lead D", false)
	s, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.RegisterEngine("lead-a", a)
	s.RegisterEngine("lead-d", d)
	s.Start()
	defer s.Stop()
	time.Sleep(20 * time.Millisecond)

	var out bytes.Buffer
	if err := handoffCommand([]string{"switch", "--data-dir", dir, "--project", "lead-a", "--to", "lead-d"}, &out); err != nil {
		t.Fatalf("CLI switch: %v\n%s", err, out.String())
	}
	var resp struct {
		OK      bool `json:"ok"`
		Changed bool `json:"changed"`
	}
	if err := json.Unmarshal(out.Bytes(), &resp); err != nil || !resp.OK || !resp.Changed {
		t.Fatalf("switch response: %v %s", err, out.String())
	}
	st, err := core.LeadHandoffStatusFor(dir)
	if err != nil || st.CurrentLead != "lead-d" || st.Handoff == nil || st.Handoff.To != "lead-d" {
		t.Fatalf("switch did not persist: %+v %v", st, err)
	}
	out.Reset()
	if err := handoffCommand([]string{"status", "--data-dir", dir}, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "当前主角色：Lead D（lead-d）") || !strings.Contains(out.String(), "交接进行中") {
		t.Fatalf("status after switch:\n%s", out.String())
	}
}
