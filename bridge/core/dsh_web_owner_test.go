package core

// #1255 的三处阻塞各有一条用例在这里：①同一台机器上另一个 DSH 的端口不能被我采纳；②候选全失败
// 时，旧端口上不是我的服务不能被停；③一整轮（所有候选）共用同一个时限，慢主机拖不住请求。
// 三条都只在"删掉修复"后变红 —— 用例里保留被拒的那条路径，只有修复本身决定结果。

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// claimDSHWebPort says what stands behind a fake port in a test: true = a host of this bridge, false
// = another instance's (or an unrelated service). Production never fills dshWebPortClaims, so there
// dshWebPortOwnedNow reads the real process. A test that wants a foreign host claims its port false.
func claimDSHWebPort(t *testing.T, port string, ours bool) {
	t.Helper()
	dshWebPortClaims.Lock()
	dshWebPortClaims.m[port] = ours
	dshWebPortClaims.Unlock()
	t.Cleanup(func() {
		dshWebPortClaims.Lock()
		delete(dshWebPortClaims.m, port)
		dshWebPortClaims.Unlock()
	})
}

// 阻塞一：日志里那条公告指向另一个 DSH（同一台机器上的第二个实例/另一份数据目录），它的 token 在
// 自己身上当然签得进去。只凭 token 就写状态文件，会把面板指到别人的主机上；自愈必须拒绝，状态文件
// 一个字节都不动。
func TestDSHWebSelfHealRefusesAHostOfAnotherInstance(t *testing.T) {
	foreign := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	foreignPort := strings.TrimPrefix(foreign.srv.URL, "http://127.0.0.1:")
	claimDSHWebPort(t, foreignPort, false) // 另一个实例的 dsh web
	staleState(t, "http://127.0.0.1:1/?token=gone#channels", 0,
		"dsh web: "+foreign.srv.URL+"/?token=launch", // 它自己的 token，它自己认
	)
	before := readStateRaw(t)

	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (the host is not ours, so nothing is adopted)", s)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("state file was rewritten to a foreign host: %s", after)
	}
	if foreign.logins.Load() == 0 {
		t.Fatal("the probe never reached the foreign host, so this proves nothing about the refusal")
	}
	// 同一台机器上的另一个 DSH 也不能被停：它是别人的会话。
	res, err := http.Get(foreign.srv.URL + "/collab/")
	if err != nil {
		t.Fatalf("the other instance's host was stopped: %v", err)
	}
	res.Body.Close()
}

// 阻塞二：所有候选都失败，而旧端口上现在是一个不相干的服务（pid 复用、别人的进程）。以前只要
// pid != trackedPID 就把它的 pid 交给 stop——这里要求一个字都不许停，状态文件也不许写。
func TestTakeOverOrphanDSHWebNeverStopsAForeignHostOnTheOldPort(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	claimDSHWebPort(t, w.port, false) // 端口上不是我们的 dsh
	recorded := filepath.Join(w.releases, "v0.1.52", "dsh-web.log")
	w.writeLog(t, recorded, "dsh web: http://127.0.0.1:"+w.port+"/?token=older")
	w.writeLog(t, w.defaultLog(), "dsh web: http://127.0.0.1:"+w.port+"/?token=stale")
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:" + w.port + "/?token=gone#channels", Log: recorded})
	before := readStateRaw(t)

	paths := dshWebLogPaths(stateForTest(t))
	if web, ok, err := takeOverOrphanDSHWeb(paths, 0); ok || err != nil {
		t.Fatalf("takeover = %+v %v %v, want nothing adopted", web, ok, err)
	}
	w.mu.Lock()
	stopped := append([]int(nil), w.stopped...)
	w.mu.Unlock()
	if len(stopped) != 0 {
		t.Fatalf("stopped %v, want the foreign service left alone", stopped)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("state file was rewritten for a foreign host: %s", after)
	}
}

// hangingListener accepts a connection and never answers, like a host that is up but stuck.
func hangingListener(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	t.Cleanup(func() { close(done); _ = l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				<-done
				_ = c.Close()
			}(c)
		}
	}()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	return port
}

// 阻塞三：公告没有端口（--public-url），只能问一遍本机监听。每个监听都收下连接却不回答——以前
// 每个都要等满一次探活，8 个就把请求拖成 8 倍；现在整轮共用一个时限，总时长仍是一次的上限。
func TestDSHWebSelfHealRoundIsBoundedByOneDeadline(t *testing.T) {
	setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	oldTimeout, oldListeners := dshWebProbeTimeout, dshWebListenersFn
	dshWebProbeTimeout = 300 * time.Millisecond
	t.Cleanup(func() { dshWebProbeTimeout, dshWebListenersFn = oldTimeout, oldListeners })

	ports := make([]string, 0, 8)
	for i := 0; i < 8; i++ {
		ports = append(ports, hangingListener(t))
	}
	dshWebListenersFn = func(context.Context) []string { return ports }
	// 来源：8 个候选 × 300ms 单次上限 = 2.4s，共用时限下不到 0.3s；1.4s 的门槛只判"是否共用时限"。
	const wantUnder = 1400 * time.Millisecond

	staleState(t, "http://127.0.0.1:1/?token=gone#channels", 0,
		"dsh web: https://mac-mini.example.ts.net/?token=slow")
	start := time.Now()
	if _, _, ok := healDSHWebState(stateForTest(t)); ok {
		t.Fatal("a hanging listener was adopted")
	}
	if took := time.Since(start); took > wantUnder {
		t.Fatalf("the round took %s for 8 hanging candidates (one cap is %s): the deadline is not shared",
			took, dshWebProbeTimeout)
	}
}

var _ = json.Marshal
var _ = os.Getpid

// 命令行的读法与判定本身的用例：不依赖本机进程，直接喂 argv/env。
func TestDSHWebProcessUsesTheCommandLineAndTheDataDir(t *testing.T) {
	own := t.TempDir()
	t.Setenv("BOTHOUSE_DATA_DIR", own)
	t.Setenv("HOME", t.TempDir())
	cases := []struct {
		name string
		argv []string
		env  map[string]string
		host bool
	}{
		{"web profile", []string{"node", "/opt/homebrew/bin/dsh", "--profile", "web", "--no-open"}, nil, true},
		{"desktop profile via path", []string{"/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness", "/Users/x/.dsh/profiles/desktop"}, nil, true},
		{"another profile", []string{"node", "/opt/homebrew/bin/dsh", "--profile", "headless"}, nil, false},
		{"not a dsh at all", []string{"/bin/sleep", "60"}, nil, false},
	}
	for _, c := range cases {
		p := dshWebProcess{Argv: c.argv, EnvKnown: c.env != nil}
		for i, a := range c.argv {
			if a == "--profile" && i+1 < len(c.argv) {
				p.Profile = c.argv[i+1]
			}
		}
		if got := p.isDSHHost(); got != c.host {
			t.Errorf("%s: isDSHHost = %v, want %v", c.name, got, c.host)
		}
	}
}

// 数据目录不同就是别人的 DSH：同一个 profile、同一个端口、token 也认，但不是我的（阻塞一的核心）。
// 这里用真实监听 + 换掉 dshWebProcLookup 描述那个 pid，走完整判定，而不是只测一个分支。
func TestDSHWebPortOwnedRefusesAnotherDataDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("pidListeningOnPort on Windows reads the TCP table; the listener here is covered elsewhere")
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	if pidListeningOnPort(port) != os.Getpid() {
		t.Skip("lsof cannot see this listener")
	}
	own := t.TempDir()
	t.Setenv("BOTHOUSE_DATA_DIR", own)
	old := dshWebProcLookup
	t.Cleanup(func() { dshWebProcLookup = old })
	webArgv := []string{"node", "/opt/homebrew/bin/dsh", "--profile", "web"}

	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return webArgv, map[string]string{"BOTHOUSE_DATA_DIR": filepath.Join(t.TempDir(), "other")}, true, true
	}
	if pid, owned, why := dshWebPortOwned(context.Background(), port); owned {
		t.Fatalf("pid %d on another data dir was accepted as ours", pid)
	} else if !strings.Contains(why, "another data directory") {
		t.Fatalf("refused for the wrong reason: %s", why)
	}

	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return webArgv, map[string]string{"BOTHOUSE_DATA_DIR": own}, true, true
	}
	if pid, owned, why := dshWebPortOwned(context.Background(), port); !owned || pid != os.Getpid() {
		t.Fatalf("our own host was refused: pid %d owned %v (%s)", pid, owned, why)
	}

	// A dsh of another profile is never a web host, whatever its data dir.
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) {
		return []string{"node", "/opt/homebrew/bin/dsh", "--profile", "headless"},
			map[string]string{"BOTHOUSE_DATA_DIR": own}, true, true
	}
	if _, owned, why := dshWebPortOwned(context.Background(), port); owned {
		t.Fatalf("a headless dsh was accepted: %s", why)
	}

	// Without a readable command line nothing is claimed.
	dshWebProcLookup = func(context.Context, int) ([]string, map[string]string, bool, bool) { return nil, nil, false, false }
	if _, owned, why := dshWebPortOwned(context.Background(), port); owned {
		t.Fatalf("an unreadable process was accepted: %s", why)
	}
}

// 阻塞二的另一面：状态文件里记的 pid 还活着，但它已经不是 dsh（macOS 几秒内就把同一个号发给别人）。
// stopDSHWebForImport 以前直接 signal 这个 pid；现在必须什么都不做，让人还活着。
func TestStopDSHWebForImportLeavesANonDSHProcessAlive(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sleep")
	}
	cmd := exec.Command("/bin/sleep", "60") // argv 里既没有 dsh 也没有 --profile
	if err := cmd.Start(); err != nil {
		t.Skip("no sleep:", err)
	}
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	if err := stopDSHWebForImport(cmd.Process.Pid); err != nil {
		t.Fatalf("stopDSHWebForImport = %v, want nil (it must not even try)", err)
	}
	if !processAlive(cmd.Process.Pid) {
		t.Fatal("a process that is not a dsh web was killed")
	}
	// 同一个调用对自己的 host 仍然要真的停：不然这条修复会把「换角色后重启」整个弄坏。
	host := fakeOwnDSHHost(t, "/bin/sleep", "60")
	if err := stopDSHWebForImport(host.Process.Pid); err != nil {
		t.Fatalf("stopDSHWebForImport(own host) = %v", err)
	}
	if processAlive(host.Process.Pid) {
		t.Fatal("our own dsh web was not stopped")
	}
}
