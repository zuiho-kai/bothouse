package core

// PR #1594 审查 A：Windows 上桥记下的 pid 是 cmd.exe（npm 的 dsh.cmd 外壳），真正监听端口的是它的
// node.exe 子进程。两个 pid 对不上，于是桥既不停也不接管自己起的 host，每次重启多起一个。这里用测试
// 进程自己当监听者、它的父进程当「记下的外壳」，环境读不到（和 Windows 一样），只换掉命令行查询。

import (
	"context"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

func launcherFixture(t *testing.T) (port string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("BOTHOUSE_DATA_DIR", t.TempDir())
	t.Setenv("CC_DATA_DIR", "")
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	_, port, _ = net.SplitHostPort(l.Addr().String())
	if pidListeningOnPort(port) != os.Getpid() {
		t.Skip("the platform cannot identify this listener")
	}
	if dshWebParentPID(context.Background(), os.Getpid()) != os.Getppid() {
		t.Skip("the platform cannot read this process's parent")
	}
	old := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old })
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"node", `C:\Users\u\AppData\Roaming\npm\node_modules\dsh\bin\dsh.js`, "--profile", "web"},
			nil, false, true
	}
	return port
}

// 记录的 pid 是监听者的父进程（外壳）：按端口接管和按记录的 pid 停，两半都要认。
func TestDSHWebOwnedWhenTheRecordedPIDLaunchedTheListener(t *testing.T) {
	port := launcherFixture(t)
	shell := os.Getppid()
	staleState(t, "http://127.0.0.1:"+port+"/?token=t#channels", shell)

	if pid, owned, why := dshWebPortOwned(context.Background(), port); !owned || pid != os.Getpid() {
		t.Fatalf("listener whose parent is the recorded pid refused: pid=%d owned=%v why=%q", pid, owned, why)
	}
	t.Log("adopt half: listener whose parent is the recorded launcher pid: accepted")
	// 只判归属，不调 stop：这里的「外壳」是 go test 自己。
	if owned, why := dshWebPIDOwned(shell); !owned {
		t.Fatalf("recorded launcher pid whose child listens on the recorded port refused: %s", why)
	}
	t.Log("stop half: recorded launcher pid whose child listens on the recorded port: accepted")
}

// 反方向不能变宽：记录的 pid 跟监听者没有父子关系，或者监听者读得到环境且数据目录不是我们的，都不认。
func TestDSHWebLauncherRuleDoesNotWidenOwnership(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sleep")
	}
	port := launcherFixture(t)
	cmd := exec.Command("/bin/sleep", "60")
	if err := cmd.Start(); err != nil {
		t.Skip("no sleep:", err)
	}
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	stranger := cmd.Process.Pid

	staleState(t, "http://127.0.0.1:"+port+"/?token=t#channels", stranger)
	if _, owned, why := dshWebPortOwned(context.Background(), port); owned {
		t.Fatalf("listener accepted on a record naming an unrelated pid: %s", why)
	}
	if owned, why := dshWebPIDOwned(stranger); owned {
		t.Fatalf("unrelated recorded pid accepted: %s", why)
	}
	if err := stopDSHWebForImport(stranger); err != nil || !processAlive(stranger) {
		t.Fatalf("an unrelated recorded pid was stopped (err=%v)", err)
	}

	// 父子关系对，但监听者的环境读得到、数据目录是别人的：仍然不认。
	staleState(t, "http://127.0.0.1:"+port+"/?token=t#channels", os.Getppid())
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"dsh", "--profile", "web"}, map[string]string{"BOTHOUSE_DATA_DIR": t.TempDir()}, true, true
	}
	if owned, why := dshWebPIDOwned(os.Getppid()); owned || !strings.Contains(why, "another data directory") {
		t.Fatalf("launcher of a host on another data directory: owned=%v why=%q", owned, why)
	}
}
