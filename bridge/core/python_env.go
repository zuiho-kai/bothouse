package core

// The Python bothouse runs its own Python programs with: the gate (gate_proc.go), the role wikis
// (rolewiki.go) and the lead scripts on a role's PATH (ProductPythonBinDir). One place finds it, so all of
// them use the same interpreter. 来源：contrib/gate/gate.py 文件头 requires-python = ">=3.12"。
//
// Order (方案第2版 K3，~/.claude/reviews/k597-K3.md):
//  1. a Python ≥3.12 already on PATH;
//  2. uv already on PATH: a Python it manages, else `uv python install 3.12` into <data_dir>/tools/python;
//  3. uv downloaded (its standalone binary, sha256 checked) into <data_dir>/tools/uv, then the same as 2.
//
// Only when that fails too is the user told to install Python (warnGatePython). A clean Mac has
// /usr/bin/python3 3.9 with the Command Line Tools and only a stub without them, which opens an install
// dialog when run: the stub is never run (isMacCLTStub).

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// uvVersion is the uv bothouse downloads when there is none; pinned so the download and its .sha256
// are always the same files. 来源：本机 uv --version（2026-10-26）0.12.24，GitHub release 有各平台独立二进制。
var (
	uvVersion      = "0.12.24"
	uvDownloadBase = "https://github.com/astral-sh/uv/releases/download/"
)

// productPythonRetry: after a failed download / install, how long before trying again. The gate looks every
// gateRecheck (60s); downloading every minute on a machine with no network would be pointless.
var productPythonRetry = 10 * time.Minute

// productPythonTimeout bounds one `uv python install` (a ~20 MB download); downloadFile has its own idle timeout.
var productPythonTimeout = 5 * time.Minute

var (
	productPythonMu     sync.Mutex
	productPythonCache  = map[string]string{} // data dir → interpreter that passed the version check
	productPythonFailed = map[string]productPythonFailure{}
	productPythonLast   string // last interpreter found, for callers without a data dir (wikiPython)
)

type productPythonFailure struct {
	at  time.Time
	err error
}

// ErrPythonTooOld: a Python is on PATH but older than 3.12, and none could be fetched.
var ErrPythonTooOld = errors.New("python on PATH is older than 3.12")

// ProductPython returns the Python ≥3.12 bothouse runs the gate, the wiki programs and the lead scripts with,
// fetching one into <dataDir>/tools when the machine has none (see the order at the top of this file). The
// first call may take a minute (downloads); later calls are cached. Errors wrap ErrPythonTooOld when the
// only Python found is too old.
func ProductPython(dataDir string) (string, error) {
	productPythonMu.Lock()
	defer productPythonMu.Unlock()
	if p, ok := productPythonCache[dataDir]; ok {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		delete(productPythonCache, dataDir)
	}
	f, failed := productPythonFailed[dataDir]
	cooling := failed && time.Since(f.at) < productPythonRetry
	p, err := resolveProductPython(dataDir)
	if err != nil {
		if !cooling { // once per failure, not on every cached retry inside the cool-down
			slog.Warn("python: no Python >= 3.12 for gate / role wikis; memory and board injection stay off until it is there",
				"error", err, "retry_in", productPythonRetry)
		}
		return "", err
	}
	slog.Info("python: using interpreter for gate / role wikis", "path", p)
	productPythonCache[dataDir] = p
	productPythonLast = p
	delete(productPythonFailed, dataDir)
	return p, nil
}

// ProductPythonBinDir returns a directory holding `python3` = ProductPython, for a role's PATH: the lead
// scripts (contrib/lead) run `python3` by name. On Windows it is the interpreter's own directory.
func ProductPythonBinDir(dataDir string) (string, error) {
	py, err := ProductPython(dataDir)
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		return filepath.Dir(py), nil
	}
	dir := filepath.Join(AgentToolsDir(dataDir), "bin")
	link := filepath.Join(dir, "python3")
	if cur, err := os.Readlink(link); err == nil && cur == py {
		return dir, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tmp := link + ".tmp"
	_ = os.Remove(tmp)
	if err := os.Symlink(py, tmp); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, link); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return dir, nil
}

// lastProductPython: the interpreter ProductPython found last in this process ("" = none yet).
func lastProductPython() string {
	productPythonMu.Lock()
	defer productPythonMu.Unlock()
	return productPythonLast
}

func resolveProductPython(dataDir string) (string, error) {
	if p := pathPython312(); p != "" {
		return p, nil
	}
	tooOld := func(err error) error {
		if _, e := FindPython(); e == nil {
			return fmt.Errorf("%w; %v", ErrPythonTooOld, err)
		}
		return err
	}
	if f, ok := productPythonFailed[dataDir]; ok && time.Since(f.at) < productPythonRetry {
		return "", f.err
	}
	p, err := uvPython(dataDir)
	if err != nil {
		err = tooOld(err)
		productPythonFailed[dataDir] = productPythonFailure{time.Now(), err}
		return "", err
	}
	return p, nil
}

// pathPython312 is the first Python ≥3.12 on PATH ("" = none). Swappable in tests.
var pathPython312 = func() string {
	seen := map[string]bool{}
	for _, name := range []string{"python3.14", "python3.13", "python3.12", "python3", "python"} {
		p, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
		if seen[p] || isPythonStub(p) {
			continue
		}
		seen[p] = true
		if python312(p) {
			return p
		}
	}
	return ""
}

// isPythonStub: an interpreter that is not one: the Microsoft Store stub (opens the store) and, on a Mac
// without the Command Line Tools, /usr/bin/python3 (opens the "install the tools" dialog).
func isPythonStub(p string) bool {
	if runtime.GOOS == "windows" && strings.Contains(strings.ToLower(p), `\windowsapps\`) {
		return true
	}
	return isMacCLTStub(p)
}

// isMacCLTStub: on macOS, /usr/bin/<tool> for a tool the Command Line Tools provide (python3, git) is a stub
// that opens an install dialog until the tools are installed. `xcode-select -p` tells without running it.
func isMacCLTStub(p string) bool {
	if runtime.GOOS != "darwin" || filepath.Dir(p) != "/usr/bin" {
		return false
	}
	return !macCLTInstalled()
}

// macCLTInstalled is swappable in tests.
var macCLTInstalled = func() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "/usr/bin/xcode-select", "-p").Run() == nil
}

// python312 reports whether p runs and is ≥3.12, cached per path.
func python312(p string) bool {
	if ok, cached := gatePythonOK.Load(p); cached {
		return ok.(bool)
	}
	// 10s：首次运行的 python 可能要编译缓存，足够；只是一次版本检查
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	cmd := exec.CommandContext(ctx, p, "-c", gatePythonCheck)
	hideWindow(cmd)
	ok := cmd.Run() == nil
	cancel()
	gatePythonOK.Store(p, ok)
	return ok
}

// uvPython: a Python ≥3.12 through uv (PATH, else the one in <dataDir>/tools/uv, else downloaded there).
func uvPython(dataDir string) (string, error) {
	uv := FindUV()
	if uv == "" {
		own := filepath.Join(AgentToolsDir(dataDir), "uv", uvExe())
		if _, err := os.Stat(own); err != nil {
			if err := downloadUV(own); err != nil {
				return "", fmt.Errorf("no Python 3.12+ and no uv on PATH; downloading uv %s failed: %w", uvVersion, err)
			}
		}
		uv = own
	}
	// only-managed: uv never runs the interpreters on PATH (so never the macOS stub); 3.12+ on PATH was
	// already looked for above.
	base := []string{"UV_PYTHON_PREFERENCE=only-managed", "UV_NO_CONFIG=1"}
	own := append(base, "UV_PYTHON_INSTALL_DIR="+filepath.Join(AgentToolsDir(dataDir), "python"))
	if p := uvFind(uv, dataDir, base); p != "" { // one uv already installed for this user
		return p, nil
	}
	if p := uvFind(uv, dataDir, own); p != "" { // one bothouse installed before
		return p, nil
	}
	if out, err := uvRun(productPythonTimeout, uv, dataDir, own, "python", "install", "3.12"); err != nil {
		return "", fmt.Errorf("uv python install 3.12: %w: %s", err, lastLines(out, 400))
	}
	if p := uvFind(uv, dataDir, own); p != "" {
		return p, nil
	}
	return "", errors.New("uv installed Python 3.12 but `uv python find` does not see it")
}

func uvFind(uv, dir string, env []string) string {
	out, err := uvRun(30*time.Second, uv, dir, env, "python", "find", "--no-project", ">=3.12")
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(out)
	if i := strings.LastIndexByte(p, '\n'); i >= 0 {
		p = strings.TrimSpace(p[i+1:])
	}
	if p == "" || !python312(p) {
		return ""
	}
	return p
}

// uvRun is swappable in tests.
var uvRun = func(timeout time.Duration, uv, dir string, env []string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, uv, args...)
	if st, err := os.Stat(dir); err == nil && st.IsDir() {
		cmd.Dir = dir
	}
	cmd.Env = MergeEnv(os.Environ(), env)
	hideWindow(cmd)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	return out.String(), err
}

func lastLines(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		s = s[len(s)-n:]
	}
	return s
}

func uvExe() string {
	if runtime.GOOS == "windows" {
		return "uv.exe"
	}
	return "uv"
}

// uvAsset: the uv release file for this machine ("" = none).
func uvAsset(goos, goarch string) string {
	arch := map[string]string{"amd64": "x86_64", "arm64": "aarch64"}[goarch]
	if arch == "" {
		return ""
	}
	switch goos {
	case "darwin":
		return "uv-" + arch + "-apple-darwin.tar.gz"
	case "linux":
		return "uv-" + arch + "-unknown-linux-gnu.tar.gz"
	case "windows":
		return "uv-" + arch + "-pc-windows-msvc.zip"
	}
	return ""
}

// fetchUV is swappable in tests: the release file and its .sha256.
var fetchUV = func(url string) ([]byte, error) { return downloadFile(url) }

// downloadUV puts uv's standalone binary at dst, checked against the release's .sha256.
func downloadUV(dst string) error {
	asset := uvAsset(runtime.GOOS, runtime.GOARCH)
	if asset == "" {
		return fmt.Errorf("no uv build for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	url := uvDownloadBase + uvVersion + "/" + asset
	data, err := fetchUV(url)
	if err != nil {
		return fmt.Errorf("%s: %w", url, err)
	}
	sum, err := fetchUV(url + ".sha256")
	if err != nil {
		return fmt.Errorf("%s.sha256: %w", url, err)
	}
	if err := VerifyReleaseChecksum(data, sum, asset); err != nil {
		return err
	}
	bin, err := extractNamed(data, asset, uvExe())
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(dst, bin, 0o755)
}

// extractNamed returns the file called name (base name) from a .tar.gz or .zip.
func extractNamed(data []byte, archive, name string) ([]byte, error) {
	if strings.HasSuffix(archive, ".zip") {
		r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, err
		}
		for _, f := range r.File {
			if filepath.Base(f.Name) == name && !f.FileInfo().IsDir() {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
		return nil, fmt.Errorf("%s not found in %s", name, archive)
	}
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer gr.Close()
	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil, fmt.Errorf("%s not found in %s", name, archive)
		}
		if err != nil {
			return nil, err
		}
		if filepath.Base(hdr.Name) == name && hdr.Typeflag == tar.TypeReg {
			return io.ReadAll(tr)
		}
	}
}
