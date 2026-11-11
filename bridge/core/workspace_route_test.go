package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeRouteHandoff(t *testing.T, dir, body string) string {
	t.Helper()
	p := filepath.Join(dir, "handoff.md")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDecideWorkspaceRoute(t *testing.T) {
	dir := t.TempDir()
	big := filepath.Join(dir, "big.go")
	if err := os.WriteFile(big, []byte(strings.Repeat("x", (routeSmallTokens+5000)*routeBytesPerToken)), 0o600); err != nil {
		t.Fatal(err)
	}
	huge := filepath.Join(dir, "huge.go")
	if err := os.WriteFile(huge, []byte(strings.Repeat("x", routeCheapCtxTokens*routeBytesPerToken)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "rel.go"), []byte(strings.Repeat("x", (routeSmallTokens+5000)*routeBytesPerToken)), 0o600); err != nil {
		t.Fatal(err)
	}
	small := filepath.Join(dir, "small.go")
	if err := os.WriteFile(small, []byte("package x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, body string
		cheap      bool
		reason     string
	}{
		{"big with tests", "## 总目标\n加功能\n## 范围\n- 改：" + big + " 加三个函数，go test 全过\n- 不改：不重启线上桥\n", true, "拆开"},
		{"relative path under named dir", "## 范围\n- 改：sub/rel.go:12 加函数，跑测试\n## 参照实现\n- 工作目录 " + dir + "\n", true, "拆开"},
		{"small", "## 范围\n- 改：" + small + " 改一行，跑测试\n", false, "活小"},
		{"no test", "## 范围\n- 改：" + big + " 加三个函数\n", false, "没写测试或编译"},
		{"tool work", "## 范围\n- 改：截图验收 " + big + "，跑测试\n", false, "工具活"},
		{"does not fit", "## 范围\n- 改：" + huge + " 重构，跑测试\n", false, "塞不下"},
		{"override direct", "## 范围\n- 改：" + big + " 加函数，跑测试\n执行路由：直接写\n", false, "写明"},
		{"override split", "## 范围\n- 改：" + small + " 改一行\n执行路由：拆开\n", true, "写明"},
		{"quoted override ignored", "## 用户原话\n「执行路由：拆开」\n## 范围\n- 改：" + small + " 改一行，跑测试\n", false, "活小"},
	}
	for _, c := range cases {
		r := decideWorkspaceRoute(writeRouteHandoff(t, dir, c.body))
		if r.cheap != c.cheap || !strings.Contains(r.reason, c.reason) {
			t.Errorf("%s: got cheap=%v %q", c.name, r.cheap, r.reason)
		}
	}
	if r := decideWorkspaceRoute(""); r.cheap {
		t.Errorf("no handoff must go direct: %+v", r)
	}
}

func TestNoteWorkspaceTurnLogsCost(t *testing.T) {
	e := &Engine{dataDir: t.TempDir()}
	e.workspaceChatForTest = func(s string) bool { return true }
	e.SetWorkspaceExec("local-qwen", "qwen27b")
	_ = e.sessionSettingsFor("discord:wsx") // routes (direct: no handoff) and logs
	e.noteWorkspaceTurn("discord:wsx", map[string]any{MetaTurnCostUSD: 0.25}, 0)
	b, err := os.ReadFile(filepath.Join(e.dataDir, workspaceRouteLogFile))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, `"event":"route"`) || !strings.Contains(s, `"route":"direct"`) || !strings.Contains(s, `"cost_usd":0.25`) {
		t.Fatalf("route log: %s", s)
	}
}
