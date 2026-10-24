package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// conest: updates come from conest's own releases (.github/workflows/release.yml), not upstream
// chenhg5/cc-connect — upstream binaries have no setup wizard / gate. There is no gitee mirror,
// so the "gitee" lookup asks GitHub too.
const (
	githubRepo   = "zuiho-kai/bothouse"
	githubAPI    = "https://api.github.com/repos/" + githubRepo + "/releases/latest"
	githubAllAPI = "https://api.github.com/repos/" + githubRepo + "/releases"
	downloadBase = "https://github.com/" + githubRepo + "/releases/download"
	giteeAPI     = githubAPI
)

// cachedLatestVersion 缓存最新版本信息，避免频繁请求API
var cachedLatestVersion struct {
	version   string
	timestamp time.Time
	mu        sync.RWMutex
}

// versionCheckTTL 缓存有效期（1小时）
const versionCheckTTL = time.Hour

type githubRelease struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Prerelease bool   `json:"prerelease"`
}

// fetchLatestStableReleaseAsync 异步获取最新稳定版本（非pre-release）
// 优先使用Gitee，如果失败则回退到GitHub
func fetchLatestStableReleaseAsync() {
	go func() {
		var release *githubRelease
		var err error
		if isPrereleaseVersion(version) {
			release, err = fetchLatestPreRelease()
		} else {
			release, err = fetchLatestStableFromGitee()
		}
		if err != nil || release == nil || release.TagName == "" {
			// Gitee失败，尝试GitHub
			release, err = fetchLatestStableRelease()
			if err != nil || release == nil {
				return
			}
		}
		// 缓存结果
		cachedLatestVersion.mu.Lock()
		cachedLatestVersion.version = release.TagName
		cachedLatestVersion.timestamp = time.Now()
		cachedLatestVersion.mu.Unlock()
	}()
}

// fetchLatestStableFromGitee 从Gitee获取最新稳定版本
func fetchLatestStableFromGitee() (*githubRelease, error) {
	client := &http.Client{Timeout: 3 * time.Second}
	req, _ := http.NewRequest("GET", giteeAPI, nil)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("gitee API returned HTTP %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	// Gitee的latest通常就是稳定版，但检查Prerelease以防万一
	if release.Prerelease {
		return nil, nil
	}
	return &release, nil
}

// checkUpdateAsync 启动异步版本检查（不阻塞）
func checkUpdateAsync() {
	// dev版本不检查
	if version == "dev" || version == "" {
		return
	}
	fetchLatestStableReleaseAsync()
}

// isPrereleaseVersion: v0.1.0-rc1 style (semver pre-release suffix). "dev" builds are not.
func isPrereleaseVersion(v string) bool {
	_, pre, ok := strings.Cut(strings.TrimPrefix(v, "v"), "-")
	return ok && pre != "" && !strings.HasPrefix(v, "dev")
}

// verifyDownloaded checks a downloaded release file against the release's checksums.txt.
func verifyDownloaded(path, checksumsURL, name string) error {
	sumsFile, err := downloadToTemp(checksumsURL)
	if err != nil {
		return fmt.Errorf("download checksums.txt: %w", err)
	}
	defer os.Remove(sumsFile)
	sums, err := os.ReadFile(sumsFile)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return core.VerifyReleaseChecksum(data, sums, name)
}

// getUpdateHintIfAvailable returns an update hint only from cache (never blocks on network).
// Call checkUpdateAsync() early to populate the cache in the background.
func getUpdateHintIfAvailable() string {
	if version == "dev" || version == "" {
		return ""
	}

	cachedLatestVersion.mu.RLock()
	cachedVer := cachedLatestVersion.version
	cachedTime := cachedLatestVersion.timestamp
	cachedLatestVersion.mu.RUnlock()

	if cachedVer == "" || time.Since(cachedTime) > versionCheckTTL {
		// Cache miss or expired — trigger async refresh, don't block
		fetchLatestStableReleaseAsync()
		return ""
	}

	if isNewer(cachedVer, version) {
		return fmt.Sprintf("\n📦 Update available: %s → %s  (run: bothouse update)\n", version, cachedVer)
	}
	return ""
}

// updateSocketPath picks the api socket of the instance this CLI belongs to: the data dir the
// daemon would use for the same --config / HOME (resolveConfigPath, then the config's data_dir,
// as main.go and setup_wizard.go do). It deliberately ignores CC_DATA_DIR: that variable is
// injected into agent shells by a running instance, so honouring it would let a command run
// with a separate HOME update that other, unrelated instance.
func updateSocketPath(configFlag string) string {
	configPath := resolveConfigPath(configFlag)
	if cfg, err := config.LoadForSetup(configPath); err == nil && cfg.DataDir != "" {
		return filepath.Join(cfg.DataDir, "run", "api.sock")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(ccconnect.DataDir(home), "run", "api.sock")
	}
	return filepath.Join(".bothouse", "run", "api.sock")
}

func runUpdate(args []string) {
	// a pre-release build (v0.1.0-rc1) follows pre-releases: there may be no stable release at all
	pre := isPrereleaseVersion(version)
	configFlag := rootConfigPath
	for i := 0; i < len(args); i++ {
		switch arg := args[i]; {
		case arg == "--pre" || arg == "--beta":
			pre = true
		case arg == "--config" && i+1 < len(args):
			i++
			configFlag = args[i]
		case strings.HasPrefix(arg, "--config="):
			configFlag = strings.TrimPrefix(arg, "--config=")
		}
	}

	fmt.Printf("bothouse %s\n", version)
	if pre {
		fmt.Println("Checking for updates (including pre-releases)...")
	} else {
		fmt.Println("Checking for updates...")
	}

	release, err := fetchRelease(pre)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error checking updates: %v\n", err)
		os.Exit(1)
	}

	latest := release.TagName
	if !isNewer(latest, version) {
		fmt.Printf("Already up to date (%s >= %s).\n", version, latest)
		return
	}

	label := latest
	if release.Prerelease {
		label += " (pre-release)"
	}
	fmt.Printf("New version available: %s → %s\n", version, label)

	viaRunning := false
	// bothouse is running: let it install the update itself, so the CLI gets the same
	// self-check as the web button (restart, and put the old version back if the new one does not come up).
	if sock := updateSocketPath(configFlag); fileExistsCmd(sock) {
		err := updateViaRunning(sock, latest)
		viaRunning = err == nil
		if errors.Is(err, errNoRunningUpdate) {
			// Leftover socket (bothouse was killed / crashed) or an older bothouse without /update:
			// install directly below, as before this self-check existed.
			fmt.Fprintf(os.Stderr, "Running bothouse cannot install the update (%v); installing directly.\n", err)
		} else if err != nil {
			fmt.Fprintf(os.Stderr, "Update failed: %v\n", err)
			os.Exit(1)
		}
	}
	if viaRunning {
		if execPath, err := os.Executable(); err == nil {
			syncNpmPackageVersion(core.BinaryFromBackupPath(execPath), strings.TrimPrefix(latest, "v"))
		}
		fmt.Printf("Updated to %s, bothouse is restarting. If the new version does not start, it goes back to %s by itself.\n", latest, version)
		return
	}

	tmpFile, err := downloadUpdateAsset(downloadBase, latest)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Update failed: %v\n", err)
		os.Exit(1)
	}

	defer os.Remove(tmpFile)

	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot locate current binary: %v\n", err)
		os.Exit(1)
	}

	if err := replaceExecutable(execPath, tmpFile); err != nil {
		fmt.Fprintf(os.Stderr, "Update failed: %v\n", err)
		os.Exit(1)
	}

	syncNpmPackageVersion(execPath, strings.TrimPrefix(latest, "v"))

	fmt.Printf("Updated to %s\n", latest)
	fmt.Println("Restart bothouse to use the new version.")
}

// fetchRelease returns the latest release. If pre=true, includes pre-releases.
func fetchRelease(pre bool) (*githubRelease, error) {
	if pre {
		return fetchLatestPreRelease()
	}
	return fetchLatestStableRelease()
}

// fetchLatestPreRelease fetches the newest release (including pre-releases) from GitHub.
func fetchLatestPreRelease() (*githubRelease, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest("GET", githubAllAPI+"?per_page=10", nil)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("parse releases: %w", err)
	}

	if len(releases) == 0 {
		return nil, fmt.Errorf("no releases found")
	}

	// Return the first (newest) release, which may be a pre-release
	return &releases[0], nil
}

// fetchLatestStableRelease fetches the latest stable release (no pre-releases).
func fetchLatestStableRelease() (*githubRelease, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest("GET", githubAPI, nil)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			var release githubRelease
			if err := json.NewDecoder(resp.Body).Decode(&release); err == nil {
				return &release, nil
			}
		}
	}

	// Fallback: follow redirect from /releases/latest to extract tag
	latestURL := "https://github.com/" + githubRepo + "/releases/latest"
	noRedirect := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp2, err := noRedirect.Get(latestURL)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp2.Body.Close()

	loc := resp2.Header.Get("Location")
	if loc == "" {
		return nil, fmt.Errorf("no release found")
	}
	parts := strings.Split(loc, "/tag/")
	if len(parts) != 2 {
		return nil, fmt.Errorf("unexpected redirect: %s", loc)
	}
	return &githubRelease{TagName: parts[1], HTMLURL: loc}, nil
}

func binaryAssetName(tag string) string {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	name := fmt.Sprintf("cc-connect-%s-%s-%s", tag, goos, goarch)
	if goos == "windows" {
		name += ".exe"
	}
	return name
}

// Both update entry points use the same names, checksum policy and fallback order.
func downloadUpdateAsset(base, tag string) (string, error) {
	data, name, err := core.DownloadReleaseAsset([]string{base}, tag, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return "", err
	}
	data, err = core.ExtractReleaseBinary(data, name)
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp("", "bothouse-update-*")
	if err != nil {
		return "", err
	}
	path := f.Name()
	if _, err = f.Write(data); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	if err = f.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// extractBinaryFromArchive extracts the cc-connect binary from a .tar.gz or .zip archive.
func extractBinaryFromArchive(archivePath, archiveName string) (string, error) {
	if strings.HasSuffix(archiveName, ".zip") {
		return extractFromZip(archivePath)
	}
	return extractFromTarGz(archivePath)
}

func extractFromTarGz(archivePath string) (string, error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("tar: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		if strings.HasPrefix(hdr.Name, "bothouse") || strings.HasPrefix(hdr.Name, "cc-connect") {
			tmp, err := os.CreateTemp("", "bothouse-update-*")
			if err != nil {
				return "", err
			}
			if _, err := io.Copy(tmp, tr); err != nil {
				tmp.Close()
				os.Remove(tmp.Name())
				return "", fmt.Errorf("extract: %w", err)
			}
			tmp.Close()
			return tmp.Name(), nil
		}
	}
	return "", fmt.Errorf("binary not found in archive")
}

func extractFromZip(archivePath string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", fmt.Errorf("zip: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		if !strings.HasPrefix(f.Name, "bothouse") && !strings.HasPrefix(f.Name, "cc-connect") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		tmp, err := os.CreateTemp("", "bothouse-update-*")
		if err != nil {
			rc.Close()
			return "", err
		}
		if _, err := io.Copy(tmp, rc); err != nil {
			tmp.Close()
			rc.Close()
			os.Remove(tmp.Name())
			return "", fmt.Errorf("extract: %w", err)
		}
		rc.Close()
		tmp.Close()
		return tmp.Name(), nil
	}
	return "", fmt.Errorf("binary not found in archive")
}

func downloadToTemp(url string) (string, error) {
	client := &http.Client{
		Timeout: 5 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "bothouse-update-*")
	if err != nil {
		return "", err
	}

	size, err := io.Copy(tmp, resp.Body)
	if err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", fmt.Errorf("write: %w", err)
	}
	tmp.Close()

	fmt.Printf("Downloaded %.1f MB\n", float64(size)/1024/1024)
	return tmp.Name(), nil
}

func replaceExecutable(target, src string) error {
	if err := os.Chmod(src, 0o755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// On Windows, rename over a running exe is not possible directly.
	// Move old binary aside (a fresh name each time: an earlier backup may still be running),
	// then move new one in.
	core.RemoveBinaryBackups(target)
	backup := core.BinaryBackupPath(target)

	if err := os.Rename(target, backup); err != nil {
		return fmt.Errorf("backup old binary: %w", err)
	}

	if err := copyFile(src, target); err != nil {
		// Attempt to restore
		if restoreErr := os.Rename(backup, target); restoreErr != nil {
			slog.Warn("update: failed to restore old binary after copy error", "error", restoreErr)
		}
		return fmt.Errorf("install new binary: %w", err)
	}

	if err := os.Chmod(target, 0o755); err != nil {
		return fmt.Errorf("chmod new binary: %w", err)
	}

	os.Remove(backup)
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func checkUpdate() {
	// a pre-release build (v0.1.0-rc1) follows pre-releases: there may be no stable release at all
	pre := isPrereleaseVersion(version)
	for _, arg := range os.Args[2:] {
		if arg == "--pre" || arg == "--beta" {
			pre = true
		}
	}

	release, err := fetchRelease(pre)
	if err != nil {
		return
	}
	if isNewer(release.TagName, version) {
		hint := "bothouse update"
		if release.Prerelease {
			hint = "bothouse update --pre"
		}
		fmt.Fprintf(os.Stderr, "Update available: %s → %s (run: %s)\n", version, release.TagName, hint)
	}
}

// isNewer returns true if latest represents a newer release than current.
// Handles semver tags (v1.2.3), pre-release tags (v1.2.3-beta.1, v1.2.3-rc.1),
// and dev builds (v1.2.3-10-gHASH).
func isNewer(latest, current string) bool {
	if latest == "" || current == "" {
		return false
	}
	if strings.HasPrefix(current, "dev") {
		return true
	}

	l := strings.TrimPrefix(latest, "v")
	c := strings.TrimPrefix(current, "v")

	lBase, lPre, _ := strings.Cut(l, "-")
	cBase, cPre, _ := strings.Cut(c, "-")

	lParts := strings.Split(lBase, ".")
	cParts := strings.Split(cBase, ".")

	for i := 0; i < len(lParts) || i < len(cParts); i++ {
		var lv, cv int
		if i < len(lParts) {
			_, _ = fmt.Sscanf(lParts[i], "%d", &lv)
		}
		if i < len(cParts) {
			_, _ = fmt.Sscanf(cParts[i], "%d", &cv)
		}
		if lv > cv {
			return true
		}
		if lv < cv {
			return false
		}
	}

	// Same base version — compare pre-release suffix
	// No pre-release beats a pre-release (1.2.0 > 1.2.0-beta.1)
	if cPre != "" && lPre == "" {
		return true
	}
	if cPre == "" && lPre != "" {
		return false
	}
	// Both have pre-release: split on "." and compare each segment
	// numerically where possible so beta.10 > beta.2.
	if lPre != "" && cPre != "" {
		return comparePreRelease(lPre, cPre) > 0
	}

	return false
}

// comparePreRelease compares two pre-release strings segment by segment.
// Numeric segments are compared as integers; non-numeric segments are
// compared lexicographically. Returns >0 if a is greater, <0 if b is
// greater, 0 if equal.
func comparePreRelease(a, b string) int {
	aParts := strings.Split(a, ".")
	bParts := strings.Split(b, ".")

	max := len(aParts)
	if len(bParts) > max {
		max = len(bParts)
	}
	for i := 0; i < max; i++ {
		var ap, bp string
		if i < len(aParts) {
			ap = aParts[i]
		}
		if i < len(bParts) {
			bp = bParts[i]
		}

		var an, bn int
		aN, _ := fmt.Sscanf(ap, "%d", &an)
		bN, _ := fmt.Sscanf(bp, "%d", &bn)
		aIsNum := aN == 1 && fmt.Sprintf("%d", an) == ap
		bIsNum := bN == 1 && fmt.Sprintf("%d", bn) == bp

		if aIsNum && bIsNum {
			if an != bn {
				return an - bn
			}
			continue
		}
		// Non-numeric: lexicographic
		if ap < bp {
			return -1
		}
		if ap > bp {
			return 1
		}
	}
	return 0
}

// syncNpmPackageVersion detects if the binary lives inside an npm package
// (node_modules/cc-connect/bin/) and updates the package.json version to
// match the newly installed binary. Without this, the npm wrapper's run.js
// would see a version mismatch and re-download the old version on next run.
func syncNpmPackageVersion(execPath, newVer string) {
	binDir := filepath.Dir(execPath)
	if filepath.Base(binDir) != "bin" {
		return
	}
	pkgDir := filepath.Dir(binDir)
	pkgJSON := filepath.Join(pkgDir, "package.json")

	data, err := os.ReadFile(pkgJSON)
	if err != nil {
		return
	}

	var pkg map[string]any
	if err := json.Unmarshal(data, &pkg); err != nil {
		return
	}

	name, _ := pkg["name"].(string)
	if name != "cc-connect" && name != "bothouse" {
		return
	}

	oldVer, _ := pkg["version"].(string)
	// Normalize both sides by stripping optional "v" prefix before comparing.
	// package.json may store "v1.0.0" while newVer is already stripped to "1.0.0".
	oldNorm := strings.TrimPrefix(oldVer, "v")
	newNorm := strings.TrimPrefix(newVer, "v")
	if oldNorm == newNorm {
		return
	}

	pkg["version"] = newVer
	out, err := json.MarshalIndent(pkg, "", "  ")
	if err != nil {
		return
	}
	out = append(out, '\n')
	if err := os.WriteFile(pkgJSON, out, 0o644); err != nil {
		slog.Warn("update: failed to sync npm package.json version", "error", err)
		fmt.Println("⚠️  Note: npm package version not synced. If the next run re-downloads an old version,")
		fmt.Println("   please run: npm update -g bothouse")
	} else {
		slog.Debug("update: synced npm package.json version", "old", oldVer, "new", newVer)
	}
}

// errNoRunningUpdate: the running bothouse cannot take the update (socket dead, or a version
// without /update); the CLI then installs directly.
var errNoRunningUpdate = errors.New("no running bothouse to install the update")

// updateViaRunning asks the running bothouse (local API socket, POST /update) to install tag
// through its guarded update. Swappable in tests.
var updateViaRunning = func(sockPath, tag string) error {
	payload, _ := json.Marshal(map[string]string{"tag": tag})
	resp, err := apiPost(sockPath, "/update", payload)
	if err != nil {
		// Nobody listening on the socket (stale file left by a crash or kill -9).
		return fmt.Errorf("%w: contact running bothouse: %v", errNoRunningUpdate, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("%w: running bothouse has no /update (older version)", errNoRunningUpdate)
	}
	var body struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("running bothouse: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if json.Unmarshal(raw, &body) != nil {
		return fmt.Errorf("running bothouse: bad reply %q", raw)
	}
	if body.Status != "restarting" {
		return fmt.Errorf("running bothouse: %s", body.Error)
	}
	return nil
}
