package testutil

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// 测试沙箱：让一个包的测试只看见临时 HOME，碰不到运行者的真实目录、
// 真实 agent CLI、真实凭据和正在跑的 cc-connect 会话。思路参考 yetone/magpie 的
// internal/testenv（只读参考，这里按 bridge 的实际变量重写）。
//
// 用法（包的 TestMain）：
//
//	func TestMain(m *testing.M) { os.Exit(testutil.RunSandboxed(m)) }
//
// 已有 TestMain 要包一层时用 Sandboxed(func() int { ... })。
// 单个测试要换 HOME 时用 SetHome，不要只设 HOME（Windows 上 Go 读 USERPROFILE）。
// 测试判断“本机有没有某个 CLI”时用 LookPathReal，沙箱假件算没有。

const (
	sandboxPrefix = "conest-test-home-"
	// SandboxMarker 记下临时 HOME。测试里再次启动自身二进制（helper 进程）时
	// 子进程继承它，沿用父进程的沙箱，不再新建。
	SandboxMarker = "CONEST_TEST_SANDBOX"
	// ProviderIntegrationVar 是仓库已有的真实 provider 集成测试开关
	// （agent/claudecode、agent/codex 的 skipIfNoConfig）。只有用
	// RunSandboxedOrProviderIntegration 的包会因它让路，其余包照样隔离。
	ProviderIntegrationVar = "CC_RUN_PROVIDER_INTEGRATION"
	// standInMarker 写在每个假件里，LookPathReal 据此认出假件。
	standInMarker = "conest-test-stand-in"
	// 假件开头，IsStandIn 按它比对。
	standInHeader    = "#!/bin/sh\n# " + standInMarker + "\n"
	standInHeaderBat = "@rem " + standInMarker + "\r\n"
)

// sandboxFolderVars 指向临时 HOME 内。
var sandboxFolderVars = []string{
	"HOME", "USERPROFILE",
	"XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
	"APPDATA", "LOCALAPPDATA",
}

// SandboxClearedVars 是 bridge 代码会读的、指向真实目录、正在运行的会话或真实
// 凭据的变量（来源：在 bridge/ 下 grep Getenv/LookupEnv 与 agent/ 下的
// "*_API_KEY"/"*_TOKEN"/"*_BASE_URL" 字面量，2026-10-20）。
// 在 cc-connect 拉起的 agent 里跑测试时 CC_PROJECT/CC_SESSION_KEY/CC_DATA_DIR
// 都有值，不清掉的话 send/relay/cron 类代码会找到真实会话的 socket。
var SandboxClearedVars = []string{
	// 运行中的 cc-connect 会话与配置位置
	"CC_PROJECT", "CC_SESSION_KEY", "CC_DATA_DIR",
	"CC_CONFIG_PATH", "CC_CONNECT_CONFIG", "CC_LOG_FILE", "CC_TEST_CONFIG",
	"BOTHOUSE_TRAY", "BOTHOUSE_NO_TRAY", "CC_SUPERVISED",
	// agent 目录与二进制位置
	"DSH_HOME", "BOTHOUSE_DSH_DIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "KIMI_BIN",
	"CONEST_MEDIA_BIN_DIR", "CONEST_MEDIA_NAS_ROOT", // 媒体库脚本目录与 NAS（core/media.go）
	// 模型/agent 凭据与接入点
	"OPENAI_API_KEY", "OPENAI_BASE_URL",
	"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
	"ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_BEDROCK_PROXY_BASE_URL",
	"ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_FOUNDRY_PROXY_BASE_URL",
	"ANTHROPIC_VERTEX_BASE_URL", "ANTHROPIC_VERTEX_PROXY_BASE_URL",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"GEMINI_API_KEY", "GOOGLE_API_KEY",
	"CURSOR_API_KEY", "KIMI_API_KEY", "WINDSURF_API_KEY", "SHENGSUANYUN_API_KEY",
	"COPILOT_PROVIDER_API_KEY", "COPILOT_PROVIDER_BASE_URL", "COPILOT_PROVIDER_BEARER_TOKEN",
	"MODEL_DISCOVERY_TOKEN", "CC_CONNECT_AGY_PERMISSION_TOKEN",
	// 平台凭据
	"TUITUI_APP_ID", "TUITUI_APP_SECRET", "MATRIX_CROSS_SIGNING_PASSWORD",
}

// SandboxStandIns 是测试绝不能真跑的程序：各 agent 适配器的默认 CLI 名
// （core.ParseCmdOpts 的默认值，加 devin/reasonix/cursor-agent），以及持有
// 登录凭据的系统钥匙串工具。PATH 最前面放同名的、一跑就失败的假件；
// 测试仍可在它之前放自己的假件。
var SandboxStandIns = []string{
	"claude", "codex", "gemini", "agy", "agent", "cursor-agent", "copilot",
	"iflow", "kimi", "opencode", "pi", "qodercli", "devin", "reasonix", "dsh",
	"security", "secret-tool",
}

// RunSandboxed 在临时 HOME 里跑测试并返回退出码。沙箱建不起来时不跑任何测试。
func RunSandboxed(m *testing.M) int { return Sandboxed(m.Run) }

// RunSandboxedOrProviderIntegration 同 RunSandboxed，但显式设了
// CC_RUN_PROVIDER_INTEGRATION=1 时让路：只给那些要读真实配置、真实 CLI 和
// 真实凭据的集成测试包用。
func RunSandboxedOrProviderIntegration(m *testing.M) int {
	if os.Getenv(ProviderIntegrationVar) == "1" {
		fmt.Fprintf(os.Stderr, "testutil: %s=1, 本包不隔离 HOME（真实 provider 集成测试）\n", ProviderIntegrationVar)
		return m.Run()
	}
	return Sandboxed(m.Run)
}

// Sandboxed 在临时 HOME 里调用 run 并返回它的退出码，供已有 TestMain 包一层。
func Sandboxed(run func() int) int {
	if home := os.Getenv(SandboxMarker); home != "" {
		if err := checkSandboxChild(home); err != nil {
			fmt.Fprintln(os.Stderr, "testutil:", err)
			return 1
		}
		return run()
	}
	home, err := Isolate()
	if err != nil {
		fmt.Fprintln(os.Stderr, "testutil: 沙箱失败，不跑测试:", err)
		return 1
	}
	defer removeSandbox(home)
	return run()
}

// LookPathReal 像 exec.LookPath，但解析到沙箱假件时当作没找到。
// 只看“本机有没有某个 CLI”就决定跑不跑的测试用它，在沙箱里会正确跳过。
// 选标记而不是去掉假件：去掉假件会让这类测试摸到用户真实安装的 CLI。
func LookPathReal(name string) (string, error) {
	p, err := exec.LookPath(name)
	if err != nil {
		return "", err
	}
	if IsStandIn(p) {
		return "", fmt.Errorf("%s 解析到沙箱假件 %s，按未安装处理", name, p)
	}
	return p, nil
}

// IsStandIn 判断 path 是否是 WriteStandIns 写出的假件：只读文件开头与假件头一样长
// 的字节比较，不把真实 CLI（可能上百 MB）整个读进来。
func IsStandIn(path string) bool {
	for _, head := range []string{standInHeader, standInHeaderBat} {
		f, err := os.Open(path)
		if err != nil {
			return false
		}
		buf := make([]byte, len(head))
		_, err = io.ReadFull(f, buf)
		f.Close()
		if err == nil && string(buf) == head {
			return true
		}
	}
	return false
}

// Isolate 新建临时 HOME，把目录变量指进去，清掉 SandboxClearedVars，
// 把假 CLI 放到 PATH 最前，并核对 Go 解析出的 home/config/cache 目录和
// 每个假 CLI 都落在临时 HOME 内；任何一项不满足就报错。
func Isolate() (string, error) {
	home, err := os.MkdirTemp("", sandboxPrefix)
	if err != nil {
		return "", err
	}
	// macOS 的 TMPDIR 经 /var → /private/var 符号链接；统一成真实路径再比较。
	if real, err := filepath.EvalSymlinks(home); err == nil {
		home = real
	}
	set := map[string]string{
		"HOME":            home,
		"USERPROFILE":     home,
		"XDG_CONFIG_HOME": filepath.Join(home, ".config"),
		"XDG_CACHE_HOME":  filepath.Join(home, ".cache"),
		"XDG_DATA_HOME":   filepath.Join(home, ".local", "share"),
		"XDG_STATE_HOME":  filepath.Join(home, ".local", "state"),
		"APPDATA":         filepath.Join(home, "AppData", "Roaming"),
		"LOCALAPPDATA":    filepath.Join(home, "AppData", "Local"),
		SandboxMarker:     home,
	}
	for k, v := range set {
		if err := os.Setenv(k, v); err != nil {
			return "", err
		}
	}
	for _, k := range SandboxClearedVars {
		if err := os.Unsetenv(k); err != nil {
			return "", err
		}
	}
	bin := filepath.Join(home, "bin")
	if err := os.Mkdir(bin, 0o755); err != nil {
		return "", err
	}
	if err := WriteStandIns(bin, SandboxStandIns); err != nil {
		return "", err
	}
	if err := os.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH")); err != nil {
		return "", err
	}
	for _, name := range SandboxStandIns {
		p, err := exec.LookPath(name)
		if err != nil || !within(p, home) {
			return "", fmt.Errorf("%s 解析到 %q，不是 %s 里的假件 (%v)", name, p, bin, err)
		}
	}
	for name, dir := range map[string]func() (string, error){
		"home": os.UserHomeDir, "config": os.UserConfigDir, "cache": os.UserCacheDir,
	} {
		p, err := dir()
		if err != nil || !within(p, home) {
			return "", fmt.Errorf("%s 目录 %q 不在测试 HOME %s 内 (%v)", name, p, home, err)
		}
	}
	return home, nil
}

// WriteStandIns 在 bin 下为每个名字写一个退出码 1 的假程序（Windows 另写 .bat，
// 因为 PATHEXT 会跳过无扩展名文件）。
func WriteStandIns(bin string, names []string) error {
	for _, name := range names {
		p := filepath.Join(bin, name)
		if err := os.WriteFile(p, []byte(standInHeader+"exit 1\n"), 0o755); err != nil {
			return err
		}
		if runtime.GOOS == "windows" {
			if err := os.WriteFile(p+".bat", []byte(standInHeaderBat+"@exit /b 1\r\n"), 0o755); err != nil {
				return err
			}
		}
	}
	return nil
}

// SetHome 把 dir 设为单个测试的 HOME（同时设 USERPROFILE）。
func SetHome(t testing.TB, dir string) {
	t.Helper()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
}

// checkSandboxChild 校验被测试再次拉起的子进程仍在临时目录里。
func checkSandboxChild(home string) error {
	tmp := os.TempDir()
	if real, err := filepath.EvalSymlinks(tmp); err == nil {
		tmp = real
	}
	if !within(home, tmp) {
		return fmt.Errorf("%s=%q 不在临时目录 %s 内", SandboxMarker, home, tmp)
	}
	return nil
}

func within(path, dir string) bool {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		path = real
	}
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// removeSandbox 只删 Isolate 建的那个目录：位于临时目录、名字带前缀。
func removeSandbox(home string) {
	tmp := os.TempDir()
	if real, err := filepath.EvalSymlinks(tmp); err == nil {
		tmp = real
	}
	if filepath.IsAbs(home) && filepath.Dir(home) == filepath.Clean(tmp) && strings.HasPrefix(filepath.Base(home), sandboxPrefix) {
		_ = os.RemoveAll(home)
		return
	}
	fmt.Fprintln(os.Stderr, "testutil:", errors.New("拒绝删除不像沙箱的目录: "+home))
}
