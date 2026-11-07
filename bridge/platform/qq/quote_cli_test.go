package qq

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/agent/dsh"
	"github.com/chenhg5/cc-connect/core"
)

// Opt in with a built bothouse binary and an isolated data directory. External
// QQ is synthetic; the executable, Unix socket, API, engine and adapter are real.
func TestQuoteCLISendOverUnixSocket(t *testing.T) {
	bin, data := os.Getenv("QQ_QUOTE_CLI_BINARY"), os.Getenv("QQ_QUOTE_CLI_DATA")
	if bin == "" || data == "" {
		t.Skip("set QQ_QUOTE_CLI_BINARY and QQ_QUOTE_CLI_DATA for isolated executable check")
	}
	f := newFakeOneBot(t)
	f.on("send_group_msg", func(map[string]any) map[string]any { return map[string]any{"message_id": 505} })
	p, msgs := startTestPlatform(t, f)
	f.push(groupMessage(111, 2001, 103, textSegment("他人的原话")))
	_ = awaitMessage(t, msgs)
	a, err := dsh.New(map[string]any{"work_dir": t.TempDir(), "cc_data_dir": data})
	if err != nil {
		t.Fatal(err)
	}
	e := core.NewEngine("quote-test", a, []core.Platform{p}, "", core.LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	api, err := core.NewAPIServer(data)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine("quote-test", e)
	api.Start()
	t.Cleanup(api.Stop)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, bin, "send", "--data-dir", data, "--project", "quote-test", "--session", "qq:g:111", "--reply-to", "103", "--message", "引用这条")
	command.Dir = data
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("send executable: %v: %s; OneBot calls=%v", err, output, f.record())
	}
	segments, ok := f.paramsOf("send_group_msg", 0)["message"].([]any)
	if !ok || len(segments) != 2 {
		t.Fatalf("native segments=%v", segments)
	}
	reply := segments[0].(map[string]any)
	if reply["type"] != "reply" || segString(reply["data"].(map[string]any), "id") != "103" {
		t.Fatalf("native reply=%v", reply)
	}
	t.Log("built bothouse send -> isolated Unix API -> real Engine -> real QQ adapter -> native reply segment id=103; QQ service remains synthetic")
}
