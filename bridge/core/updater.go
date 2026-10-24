package core

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// conest: same as cmd/cc-connect/update.go — conest's own releases; no gitee mirror, so both point at GitHub.
const (
	githubReleasesAPI = "https://api.github.com/repos/zuiho-kai/bothouse/releases"
	giteeReleasesAPI  = githubReleasesAPI
	githubDownload    = "https://github.com/zuiho-kai/bothouse/releases/download"
	giteeDownload     = githubDownload
)

type ReleaseInfo struct {
	TagName    string `json:"tag_name"`
	Name       string `json:"name"`
	Body       string `json:"body"`
	Prerelease bool   `json:"prerelease"`
	CreatedAt  string `json:"created_at"`
	HTMLURL    string `json:"html_url"`
}

// CheckForUpdate queries GitHub/Gitee for newer releases.
// If preferGitee is true, tries Gitee first (faster in China); otherwise GitHub first.
func CheckForUpdate(currentVersion string, preferGitee bool) (*ReleaseInfo, error) {
	releases, err := fetchReleases(preferGitee)
	if err != nil {
		return nil, err
	}
	if len(releases) == 0 {
		return nil, nil
	}

	// Find the newest release by semver comparison
	var best *ReleaseInfo
	for i := range releases {
		r := &releases[i]
		if r.TagName == "" {
			continue
		}
		if best == nil || semverCompare(r.TagName, best.TagName) > 0 {
			best = r
		}
	}

	if best == nil {
		return nil, nil
	}

	cur := normalizeVersion(currentVersion)
	latest := normalizeVersion(best.TagName)
	if cur == latest || semverCompare(best.TagName, currentVersion) <= 0 {
		return nil, nil
	}

	return best, nil
}

func fetchReleases(preferGitee bool) ([]ReleaseInfo, error) {
	type source struct {
		name string
		url  string
	}
	sources := []source{
		{"github", githubReleasesAPI + "?per_page=20"},
		{"gitee", giteeReleasesAPI + "?per_page=20&direction=desc&sort=created"},
	}
	if preferGitee {
		sources[0], sources[1] = sources[1], sources[0]
	}

	releases, err := fetchReleasesFrom(sources[0].url)
	if err == nil && len(releases) > 0 {
		return releases, nil
	}
	slog.Debug("updater: primary source failed, trying fallback", "primary", sources[0].name, "error", err)

	releases, err = fetchReleasesFrom(sources[1].url)
	if err != nil {
		return nil, fmt.Errorf("check updates failed (both sources): %w", err)
	}
	return releases, nil
}

func fetchReleasesFrom(apiURL string) ([]ReleaseInfo, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "bothouse-updater")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned %d", resp.StatusCode)
	}

	var releases []ReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, err
	}
	return releases, nil
}

// Update failure kinds, so the web page can say why in plain words (errors.Is).
var (
	ErrUpdateDownload = errors.New("download failed")
	ErrUpdateChecksum = errors.New("checksum mismatch")
)

// SelfUpdate downloads and installs the given release version.
// If preferGitee is true, tries Gitee download first.
func SelfUpdate(tag string, preferGitee bool) error {
	bases := []string{githubDownload}
	if preferGitee {
		bases[0] = giteeDownload
	}
	data, filename, err := DownloadReleaseAsset(bases, tag, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	binary, err := ExtractReleaseBinary(data, filename)
	if err != nil {
		return fmt.Errorf("extract binary: %w", err)
	}
	return replaceBinary(binary)
}

// ReleaseAssetNames lists the platform download that .github/workflows/release.yml publishes.
// Every bothouse release (v0.1.2 onward) carries exactly bothouse-mac.dmg, bothouse-windows.exe,
// bothouse-linux-x64, bothouse-linux-arm64 and SHA256SUMS, so older per-arch or cc-connect-* names
// are not requested: they only produced 404s that hid the real download error.
func ReleaseAssetNames(tag, goos, goarch string) []string {
	name := fmt.Sprintf("bothouse-%s-%s", goos, goarch)
	switch goos {
	case "windows":
		name = "bothouse-windows.exe"
	case "darwin":
		name = "bothouse-mac.dmg"
	case "linux":
		if goarch == "amd64" {
			name = "bothouse-linux-x64"
		}
	}
	return []string{name}
}

// DownloadReleaseAsset verifies the exact downloaded name. A checksum failure is fatal:
// it must never silently downgrade to a different package. If every source fails, the
// error lists each attempted URL with its own cause.
func DownloadReleaseAsset(bases []string, tag, goos, goarch string) ([]byte, string, error) {
	var errs []error
	for _, filename := range ReleaseAssetNames(tag, goos, goarch) {
		for _, base := range bases {
			from := fmt.Sprintf("%s/%s/", base, tag)
			slog.Info("updater: downloading", "url", from+filename)
			data, err := downloadFile(from + filename)
			if err != nil {
				slog.Warn("updater: download failed", "url", from+filename, "error", err)
				errs = append(errs, fmt.Errorf("%s: %w", from+filename, err))
				continue
			}
			sums, err := downloadFile(from + "SHA256SUMS")
			if err != nil {
				return nil, "", fmt.Errorf("%w: SHA256SUMS: %w", ErrUpdateDownload, err)
			}
			if err := VerifyReleaseChecksum(data, sums, filename); err != nil {
				return nil, "", err
			}
			return data, filename, nil
		}
	}
	return nil, "", fmt.Errorf("%w from all sources: %w", ErrUpdateDownload, errors.Join(errs...))
}

// ExtractReleaseBinary accepts the release's native format and legacy archives.
func ExtractReleaseBinary(data []byte, filename string) ([]byte, error) {
	switch {
	case strings.HasSuffix(filename, ".zip"):
		return extractBinaryFromZip(data)
	case strings.HasSuffix(filename, ".tar.gz"):
		return extractBinaryFromTarGz(data)
	case strings.HasSuffix(filename, ".dmg"):
		if runtime.GOOS != "darwin" {
			return nil, fmt.Errorf("dmg extraction requires macOS")
		}
		dir, err := os.MkdirTemp("", "bothouse-update-*")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(dir)
		disk := filepath.Join(dir, "bothouse.dmg")
		mount := filepath.Join(dir, "volume")
		if err := os.WriteFile(disk, data, 0600); err != nil {
			return nil, err
		}
		if out, err := exec.Command("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, disk).CombinedOutput(); err != nil {
			return nil, fmt.Errorf("mount dmg: %w: %s", err, out)
		}
		binary, readErr := os.ReadFile(filepath.Join(mount, "Bothouse.app", "Contents", "MacOS", "bothouse"))
		if out, err := exec.Command("hdiutil", "detach", mount).CombinedOutput(); err != nil {
			return nil, fmt.Errorf("unmount dmg: %w: %s", err, out)
		}
		return binary, readErr
	default:
		return data, nil
	}
}

// downloadIdleTimeout fails a download only when no new bytes arrive for this long; there is
// no cap on total duration. Source: on a ~100KB/s link the 43MB bothouse-mac.dmg needs ~7 minutes,
// so the old fixed 5-minute client timeout always cut it off (handoff updater-timeout-1024).
// At 100KB/s a read returns data every fraction of a second; 60s of silence is a real stall.
var downloadIdleTimeout = 60 * time.Second

// errDownloadStalled marks a download aborted by downloadIdleTimeout.
var errDownloadStalled = errors.New("download stalled")

func downloadFile(url string) ([]byte, error) {
	idle := downloadIdleTimeout
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var stalled atomic.Bool
	// The timer also covers connect and response headers; every received chunk re-arms it.
	timer := time.AfterFunc(idle, func() {
		stalled.Store(true)
		cancel()
	})
	defer timer.Stop()
	wrap := func(err error) error {
		if stalled.Load() {
			return fmt.Errorf("%w: no data for %s", errDownloadStalled, idle)
		}
		return err
	}

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "bothouse-updater")

	resp, err := client.Do(req)
	if err != nil {
		return nil, wrap(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var buf bytes.Buffer
	chunk := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(chunk)
		if n > 0 {
			timer.Reset(idle)
			buf.Write(chunk[:n])
		}
		if err == io.EOF {
			return buf.Bytes(), nil
		}
		if err != nil {
			return nil, wrap(err)
		}
	}
}

func extractBinaryFromTarGz(data []byte) ([]byte, error) {
	r := bytes.NewReader(data)
	gr, err := gzip.NewReader(r)
	if err != nil {
		return nil, err
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		name := filepath.Base(hdr.Name)
		if (strings.HasPrefix(name, "bothouse") || strings.HasPrefix(name, "cc-connect")) && hdr.Typeflag == tar.TypeReg {
			return io.ReadAll(tr)
		}
	}
	return nil, fmt.Errorf("bothouse binary not found in archive")
}

func extractBinaryFromZip(data []byte) ([]byte, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	for _, f := range r.File {
		name := filepath.Base(f.Name)
		if (strings.HasPrefix(name, "bothouse") || strings.HasPrefix(name, "cc-connect")) && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("bothouse binary not found in zip archive")
}

func replaceBinary(newBinary []byte) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("resolve symlinks: %w", err)
	}

	dir := filepath.Dir(execPath)
	tmpFile, err := os.CreateTemp(dir, "bothouse-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(newBinary); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write new binary: %w", err)
	}
	tmpFile.Close()

	if err := os.Chmod(tmpPath, 0o755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod: %w", err)
	}

	RemoveBinaryBackups(execPath)
	oldPath := BinaryBackupPath(execPath)
	lastBinaryBackup = ""

	if err := os.Rename(execPath, oldPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("backup old binary: %w", err)
	}

	if err := os.Rename(tmpPath, execPath); err != nil {
		// Try to restore
		if restoreErr := os.Rename(oldPath, execPath); restoreErr != nil {
			slog.Error("updater: failed to restore old binary after install failed", "error", restoreErr)
		}
		return fmt.Errorf("install new binary: %w", err)
	}

	// Don't remove the backup now: the running process may still need it for os.Executable()
	// to work correctly after restart. RemoveBinaryBackups clears it on the next update.

	lastBinaryBackup = oldPath
	slog.Info("updater: binary replaced successfully", "path", execPath)
	return nil
}

// --- semver comparison ---

var semverRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$`)

type semver struct {
	major, minor, patch int
	pre                 string
	preNum              int
}

func parseSemver(v string) semver {
	m := semverRe.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return semver{}
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	pre := m[4]
	preNum := 0
	if idx := strings.LastIndex(pre, "."); idx >= 0 {
		preNum, _ = strconv.Atoi(pre[idx+1:])
	}
	return semver{major: major, minor: minor, patch: patch, pre: pre, preNum: preNum}
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	if !strings.HasPrefix(v, "v") {
		v = "v" + v
	}
	return v
}

// semverCompare returns >0 if a > b, <0 if a < b, 0 if equal.
func semverCompare(a, b string) int {
	sa := parseSemver(a)
	sb := parseSemver(b)

	if d := sa.major - sb.major; d != 0 {
		return d
	}
	if d := sa.minor - sb.minor; d != 0 {
		return d
	}
	if d := sa.patch - sb.patch; d != 0 {
		return d
	}
	// No pre-release > has pre-release (1.0.0 > 1.0.0-beta.1)
	if sa.pre == "" && sb.pre != "" {
		return 1
	}
	if sa.pre != "" && sb.pre == "" {
		return -1
	}
	// Both have pre-release: compare lexicographically, then by number
	if sa.pre != sb.pre {
		if d := strings.Compare(sa.pre, sb.pre); d != 0 {
			// "beta" prefix comparison; if same prefix, compare numbers
			aPre := strings.TrimRight(sa.pre, "0123456789.")
			bPre := strings.TrimRight(sb.pre, "0123456789.")
			if aPre == bPre {
				return sa.preNum - sb.preNum
			}
			return d
		}
	}
	return 0
}

// VerifyReleaseChecksum checks data against the "<sha256>  <name>" line for name in a
// checksums.txt (sha256sum format, as .github/workflows/release.yml writes it).
func VerifyReleaseChecksum(data, checksums []byte, name string) error {
	want := ""
	for _, line := range strings.Split(string(checksums), "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name {
			want = strings.ToLower(f[0])
		}
	}
	if want == "" {
		return fmt.Errorf("%w: %s is not listed in checksums.txt; not installing it", ErrUpdateChecksum, name)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != want {
		return fmt.Errorf("%w for %s (got %s, want %s); not installing it", ErrUpdateChecksum, name, got, want)
	}
	return nil
}
