package core

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// stubPythonEnv: no Python ≥3.12 on PATH, no uv on PATH, a fake uv download and fake uv commands.
func stubPythonEnv(t *testing.T) (dataDir string, calls *[]string) {
	t.Helper()
	oldPath, oldRun, oldFetch := pathPython312, uvRun, fetchUV
	t.Cleanup(func() {
		pathPython312, uvRun, fetchUV = oldPath, oldRun, oldFetch
		productPythonMu.Lock()
		productPythonCache, productPythonFailed, productPythonLast = map[string]string{}, map[string]productPythonFailure{}, ""
		productPythonMu.Unlock()
	})
	t.Setenv("PATH", t.TempDir()) // no uv here
	pathPython312 = func() string { return "" }
	dataDir = t.TempDir()
	var c []string
	calls = &c
	return dataDir, calls
}

func fakeUVArchive(t *testing.T, asset string) (data, sum []byte) {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	body := []byte("#!/bin/sh\n")
	_ = tw.WriteHeader(&tar.Header{Name: "uv-x/" + uvExe(), Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg})
	_, _ = tw.Write(body)
	_ = tw.Close()
	_ = gz.Close()
	h := sha256.Sum256(buf.Bytes())
	return buf.Bytes(), []byte(hex.EncodeToString(h[:]) + "  " + asset + "\n")
}

func TestProductPythonDownloadsUVThenInstalls312(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake archive is a tar.gz")
	}
	dataDir, calls := stubPythonEnv(t)
	asset := uvAsset(runtime.GOOS, runtime.GOARCH)
	data, sum := fakeUVArchive(t, asset)
	fetchUV = func(url string) ([]byte, error) {
		*calls = append(*calls, "fetch "+filepath.Base(url))
		if strings.HasSuffix(url, ".sha256") {
			return sum, nil
		}
		return data, nil
	}
	py := filepath.Join(dataDir, "tools", "python", "cpython-3.12", "bin", "python3.12")
	installed := false
	uvRun = func(_ time.Duration, uv, _ string, env []string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		*calls = append(*calls, filepath.Base(uv)+" "+joined)
		if uv != filepath.Join(dataDir, "tools", "uv", uvExe()) {
			t.Errorf("ran %s, want the downloaded uv", uv)
		}
		if !strings.Contains(strings.Join(env, " "), "UV_PYTHON_PREFERENCE=only-managed") {
			t.Errorf("uv may run the interpreters on PATH (the macOS stub): env %v", env)
		}
		ownDir := strings.Contains(strings.Join(env, " "), "UV_PYTHON_INSTALL_DIR="+filepath.Join(dataDir, "tools", "python"))
		switch {
		case args[1] == "install":
			if !ownDir {
				t.Errorf("install outside the data dir: %v", env)
			}
			installed = true
			_ = os.MkdirAll(filepath.Dir(py), 0o755)
			_ = os.WriteFile(py, []byte("#!/bin/sh\n"), 0o755)
			return "", nil
		case args[1] == "find" && installed && ownDir:
			return py + "\n", nil
		}
		return "", errors.New("no python found")
	}
	gatePythonOK.Store(py, true)
	t.Cleanup(func() { gatePythonOK.Delete(py) })

	got, err := ProductPython(dataDir)
	if err != nil || got != py {
		t.Fatalf("ProductPython = %q, %v; calls %v", got, err, *calls)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "tools", "uv", uvExe())); err != nil {
		t.Fatalf("uv not saved: %v", err)
	}
	if n := len(*calls); n == 0 || !strings.HasPrefix((*calls)[0], "fetch "+asset) {
		t.Fatalf("calls: %v", *calls)
	}
	// cached: a second call runs nothing
	before := len(*calls)
	if got, _ := ProductPython(dataDir); got != py || len(*calls) != before {
		t.Fatalf("second call %q ran %v", got, (*calls)[before:])
	}
	// the same interpreter for the lead scripts' PATH
	dir, err := ProductPythonBinDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if l, _ := os.Readlink(filepath.Join(dir, "python3")); l != py {
		t.Fatalf("python3 link -> %q, want %q", l, py)
	}
	if lastProductPython() != py || wikiPython() != py {
		t.Fatalf("wiki python %q, want %q", wikiPython(), py)
	}
}

func TestProductPythonBadChecksumFailsAndWaits(t *testing.T) {
	dataDir, calls := stubPythonEnv(t)
	asset := uvAsset(runtime.GOOS, runtime.GOARCH)
	fetchUV = func(url string) ([]byte, error) {
		*calls = append(*calls, url)
		if strings.HasSuffix(url, ".sha256") {
			return []byte(strings.Repeat("0", 64) + "  " + asset + "\n"), nil
		}
		return []byte("not uv"), nil
	}
	uvRun = func(time.Duration, string, string, []string, ...string) (string, error) {
		t.Error("ran uv after a failed download")
		return "", errors.New("x")
	}
	if _, err := ProductPython(dataDir); err == nil {
		t.Fatal("want an error")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "tools", "uv", uvExe())); err == nil {
		t.Fatal("a uv with a bad checksum was saved")
	}
	n := len(*calls)
	if _, err := ProductPython(dataDir); err == nil || len(*calls) != n {
		t.Fatalf("retried the download right away: %v", (*calls)[n:])
	}
}

func TestProductPythonPrefersPathPython(t *testing.T) {
	dataDir, _ := stubPythonEnv(t)
	pathPython312 = func() string { return "/opt/py/bin/python3.12" }
	fetchUV = func(string) ([]byte, error) { t.Error("downloaded with a Python on PATH"); return nil, errors.New("x") }
	if p, err := ProductPython(dataDir); err != nil || p != "/opt/py/bin/python3.12" {
		t.Fatalf("%q %v", p, err)
	}
}

func TestMacCLTStubIsNotRun(t *testing.T) {
	old := macCLTInstalled
	t.Cleanup(func() { macCLTInstalled = old })
	macCLTInstalled = func() bool { return false }
	want := runtime.GOOS == "darwin"
	if got := isPythonStub("/usr/bin/python3"); got != want {
		t.Fatalf("/usr/bin/python3 without CLT: stub=%v, want %v", got, want)
	}
	if isPythonStub("/opt/homebrew/bin/python3") {
		t.Fatal("a real python taken for the stub")
	}
	macCLTInstalled = func() bool { return true }
	if isPythonStub("/usr/bin/python3") {
		t.Fatal("/usr/bin/python3 with CLT is a real 3.9")
	}
}

func TestUVAsset(t *testing.T) {
	for _, c := range [][3]string{
		{"darwin", "arm64", "uv-aarch64-apple-darwin.tar.gz"},
		{"darwin", "amd64", "uv-x86_64-apple-darwin.tar.gz"},
		{"linux", "amd64", "uv-x86_64-unknown-linux-gnu.tar.gz"},
		{"windows", "amd64", "uv-x86_64-pc-windows-msvc.zip"},
		{"linux", "386", ""},
	} {
		if got := uvAsset(c[0], c[1]); got != c[2] {
			t.Errorf("%s/%s = %q, want %q", c[0], c[1], got, c[2])
		}
	}
}
