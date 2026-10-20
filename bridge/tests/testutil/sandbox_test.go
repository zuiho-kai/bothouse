package testutil

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMain(m *testing.M) { os.Exit(RunSandboxed(m)) }

// 去掉 TestMain 里的 RunSandboxed，本测试在 cc-connect 拉起的 agent 里会红
// （HOME 是真实目录、CC_SESSION_KEY 有值、claude 解析到真实 CLI）。
func TestSandboxIsolatesHomeVarsAndCLIs(t *testing.T) {
	home := os.Getenv(SandboxMarker)
	if home == "" {
		t.Errorf("%s 未设置：TestMain 没有进沙箱", SandboxMarker)
	}
	for _, k := range sandboxFolderVars {
		if v := os.Getenv(k); !within(v, home) {
			t.Errorf("%s=%q 不在沙箱 %s 内", k, v, home)
		}
	}
	for _, k := range SandboxClearedVars {
		if v, ok := os.LookupEnv(k); ok {
			t.Errorf("%s 仍有值 %q", k, v)
		}
	}
	for _, name := range SandboxStandIns {
		p, err := exec.LookPath(name)
		if err != nil || filepath.Dir(p) != filepath.Join(home, "bin") {
			t.Errorf("%s 解析到 %q (%v)，应是沙箱假件", name, p, err)
			continue
		}
		if err := exec.Command(p).Run(); err == nil {
			t.Errorf("假件 %s 应该失败退出", name)
		}
	}
	if d, err := os.UserHomeDir(); err != nil || d != home {
		t.Errorf("os.UserHomeDir()=%q (%v)，想要 %q", d, err, home)
	}
}

func TestRemoveSandboxRefusesForeignDir(t *testing.T) {
	dir := t.TempDir()
	keep := filepath.Join(dir, "keep")
	if err := os.WriteFile(keep, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	removeSandbox(dir)
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("removeSandbox 删了不带前缀的目录: %v", err)
	}
}

// 父进程带着假的 OPENAI_API_KEY 启动一个全新的测试进程（不带沙箱标记），
// 子进程进沙箱后必须读到空值。把 OPENAI_API_KEY 从 SandboxClearedVars 去掉，本测试就红。
func TestSandboxClearsCredentialVars(t *testing.T) {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, SandboxMarker+"=") {
			env = append(env, kv)
		}
	}
	env = append(env, "OPENAI_API_KEY=sk-fake-from-parent", "CONEST_SANDBOX_CHILD_PROBE=1")
	cmd := exec.Command(os.Args[0], "-test.run=^TestSandboxChildSeesNoCredentials$", "-test.v")
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("子进程在沙箱里仍读到凭据: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "--- PASS: TestSandboxChildSeesNoCredentials") {
		t.Fatalf("子进程没有真正跑探针:\n%s", out)
	}
}

func TestSandboxChildSeesNoCredentials(t *testing.T) {
	if os.Getenv("CONEST_SANDBOX_CHILD_PROBE") != "1" {
		t.Skip("只在 TestSandboxClearsCredentialVars 拉起的子进程里跑")
	}
	if v := os.Getenv("OPENAI_API_KEY"); v != "" {
		t.Fatalf("OPENAI_API_KEY=%q，沙箱应清空", v)
	}
}

func TestLookPathRealTreatsStandInsAsMissing(t *testing.T) {
	if p, err := LookPathReal("kimi"); err == nil {
		t.Fatalf("LookPathReal(kimi)=%q，沙箱假件应按未安装处理", p)
	}
	if _, err := LookPathReal("sh"); err != nil {
		t.Fatalf("LookPathReal(sh) 应找到真实程序: %v", err)
	}
}
