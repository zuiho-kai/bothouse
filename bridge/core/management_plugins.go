package core

// 插件 (#150 第 b 项): one page that shows what this DSH profile really has installed and lets the
// owner add, switch on and switch off a bundle without leaving the panel.
//
// There is one source of truth and it is DSH's own profile files: `package.json` names the
// dependencies and the selected bundles, `cordis.patch.yml` carries the disabled overrides. DSH's
// own Plugins page (pluginManager) reads and writes exactly the same files, so the two pages never
// disagree — they are two windows on one profile, not two registries. Installing runs the same
// command a user would type (`dsh plugin --profile web add`), never a private pnpm invocation.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// pluginInstallTimeout bounds `dsh plugin add`: the run downloads dependencies from npm.
// 来源：沿用 InstallDSHPlugin 的 5 分钟（core/setup_dsh_platform.go:234），同一个安装动作同一个上限。
const pluginInstallTimeout = 5 * time.Minute

// DSHPluginRow is one plugin row a bundle's patch inserts (the thing DSH calls a plugin).
type DSHPluginRow struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Disabled bool   `json:"disabled"`
}

// DSHPlugin is one dependency of the profile.
type DSHPlugin struct {
	Name        string `json:"name"`
	Version     string `json:"version,omitempty"`
	Description string `json:"description,omitempty"`
	// Source is the dependency spec as written in package.json (a version range or a link: path).
	Source string `json:"source,omitempty"`
	// Layer: the package declares dsh.bundle, so selecting it adds a profile layer. A dependency
	// without it is installed but never loaded as a plugin (DSH prints a warning for those).
	Layer bool `json:"layer"`
	// ClientOnly: the package declares dsh.client but no dsh.bundle (the Discord shell the install
	// script puts into this profile is one). DSH renders it as a client UI, so it is neither a
	// profile layer nor a plain dependency: the page gives it its own label and no switch (#1376).
	ClientOnly bool `json:"client_only"`
	// Enabled: the profile selects this bundle (package.json dsh.profile.bundles).
	Enabled bool `json:"enabled"`
	// Shipped: the package resolves from the DSH installation rather than this profile. Those are
	// the surface layers DSH itself ships; switching them off would remove the UI, so the page
	// shows them but does not offer the switch.
	Shipped bool           `json:"shipped"`
	Rows    []DSHPluginRow `json:"rows,omitempty"`
	// Error says why this row could not be read: "files-missing" for a broken link or a
	// half-finished install, "invalid-json" for a damaged package.json, otherwise the raw parse
	// error. The page turns the two codes into its own language.
	Error string `json:"error,omitempty"`
}

// DSHPluginsState is GET /api/v1/plugins.
type DSHPluginsState struct {
	Profile    string      `json:"profile"`
	ProfileDir string      `json:"profile_dir"`
	Plugins    []DSHPlugin `json:"plugins"`
	// CanInstall is false when dsh is not on PATH: the page says so instead of offering a button
	// that cannot work.
	CanInstall bool `json:"can_install"`
	// WritesAllowed is false when the management API has no token: an unauthenticated server
	// cannot tell an owner from anyone else on the machine, so it lists but does not install or
	// switch. The page explains instead of offering a button that will be refused.
	WritesAllowed bool `json:"writes_allowed"`
	// AllowNonRegistry mirrors config.toml [plugins] allow_non_registry; Registry is the registry
	// the page shows as the source.
	AllowNonRegistry bool   `json:"allow_non_registry"`
	Registry         string `json:"registry"`
}

type pluginManifest struct {
	Dependencies map[string]string `json:"dependencies"`
	DSH          struct {
		Profile struct {
			Bundles []string `json:"bundles"`
		} `json:"profile"`
	} `json:"dsh"`
}

func dshProfileDir() string {
	return filepath.Join(dshHome(), "profiles", DSHProfile)
}

// readPluginManifest reads the profile manifest; a profile that was never initialized has none.
func readPluginManifest(dir string) (pluginManifest, []byte, error) {
	var m pluginManifest
	raw, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if os.IsNotExist(err) {
		return m, nil, nil
	}
	if err != nil {
		return m, nil, err
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, raw, fmt.Errorf("profile package.json is not valid JSON: %w", err)
	}
	return m, raw, nil
}

// disabledRowIDs is the effective `disabled` value per patch id: the profile patch applies after the
// bundle layers, and HOME applies after the profile, so the last entry wins.
func disabledRowIDs(dir string) map[string]bool {
	disabled := map[string]bool{}
	for _, path := range []string{
		filepath.Join(dir, "cordis.patch.yml"),
		filepath.Join(dshHome(), "cordis.patch.yml"),
	} {
		doc, err := readDSHPatch(path)
		if err != nil {
			continue // an unreadable overlay is DSH's problem to report; the page keeps its rows
		}
		for _, entry := range dshModuleEntries(doc.Content[0]) {
			id, flag := mapGet(entry, "id"), mapGet(entry, "disabled")
			if id == nil || flag == nil || flag.Tag != "!!bool" {
				continue
			}
			var off bool
			if flag.Decode(&off) == nil {
				disabled[id.Value] = off
			}
		}
	}
	return disabled
}

// bundleRows lists the rows a bundle inserts. Id-targeted entries in a bundle patch are overrides of
// rows someone else declared, not new plugins, so only `insert:` items count here.
func bundleRows(packageDir string, patch dshBundlePatch, disabled map[string]bool) ([]DSHPluginRow, error) {
	var rows []DSHPluginRow
	for _, rel := range patch {
		doc, err := readDSHPatch(filepath.Join(packageDir, rel))
		if err != nil {
			return rows, err
		}
		for _, entry := range doc.Content[0].Content {
			inserted := mapGet(entry, "insert")
			if inserted == nil || inserted.Kind != yaml.SequenceNode {
				continue
			}
			for _, item := range inserted.Content {
				id, name := mapGet(item, "id"), mapGet(item, "name")
				if id == nil || name == nil {
					continue
				}
				row := DSHPluginRow{ID: id.Value, Name: name.Value}
				if flag := mapGet(item, "disabled"); flag != nil && flag.Tag == "!!bool" {
					var off bool
					if flag.Decode(&off) == nil {
						row.Disabled = off
					}
				}
				// A later id-targeted patch overrides a field an insert declared, so the patch
				// layer is applied last and wins.
				// 来源：dsh-app-boot applyEntryPatches (lib/index.js:72-105)：insert 先 push，
				// 后续 patch 对同一 id 执行 target[key]=value。
				if off, ok := disabled[id.Value]; ok {
					row.Disabled = off
				}
				rows = append(rows, row)
			}
		}
	}
	return rows, nil
}

// listDSHPlugins reads the profile and describes every dependency it names.
func listDSHPlugins() DSHPluginsState {
	dir := dshProfileDir()
	// A profile with no dependencies is an empty list, not null: the page counts it.
	state := DSHPluginsState{Profile: DSHProfile, ProfileDir: dir, Plugins: []DSHPlugin{}}
	_, err := LookDSH()
	state.CanInstall = err == nil

	manifest, _, err := readPluginManifest(dir)
	if err != nil {
		state.Plugins = []DSHPlugin{{Name: dir, Error: err.Error()}}
		return state
	}
	selected := map[string]bool{}
	for _, name := range manifest.DSH.Profile.Bundles {
		selected[name] = true
	}
	disabled := disabledRowIDs(dir)
	installRoot := ""
	if anchor := dshInstallAnchor(); anchor != "" {
		installRoot = filepath.Dir(anchor)
	}

	names := make([]string, 0, len(manifest.Dependencies))
	for name := range manifest.Dependencies {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		p := DSHPlugin{Name: name, Source: manifest.Dependencies[name], Enabled: selected[name]}
		pkgDir := resolveDSHBundle(name, dshInstallAnchor(), dir)
		p.Shipped = installRoot != "" && strings.HasPrefix(pkgDir, installRoot+string(filepath.Separator))
		var pkg struct {
			Version     string `json:"version"`
			Description string `json:"description"`
			DSH         struct {
				Bundle struct {
					Patch dshBundlePatch `json:"patch"`
				} `json:"bundle"`
				// Client is the client UI block (`dsh.client.inject` / `dsh.client.platform`). Its
				// presence, without a bundle patch, is what makes this a client UI package (#1376).
				Client struct {
					Platform string `json:"platform"`
				} `json:"client"`
			} `json:"dsh"`
		}
		raw, err := os.ReadFile(filepath.Join(pkgDir, "package.json"))
		switch {
		case err != nil:
			p.Error = "files-missing"
		default:
			if err := json.Unmarshal(raw, &pkg); err != nil {
				p.Error = "invalid-json"
				break
			}
			p.Version, p.Description = pkg.Version, pkg.Description
			p.Layer = len(pkg.DSH.Bundle.Patch) > 0
			// 来源：安装脚本装进 profile 的 client-ui 包（bridge/core/dsh_bundle/packages/*/package.json，
			// dsh.client.inject + dsh.client.platform，无 dsh.bundle）；#1376 把它们跟纯依赖分开。
			p.ClientOnly = !p.Layer && pkg.DSH.Client.Platform != ""
			if p.Layer {
				rows, err := bundleRows(pkgDir, pkg.DSH.Bundle.Patch, disabled)
				if err != nil {
					p.Error = err.Error()
				}
				p.Rows = rows
			}
		}
		state.Plugins = append(state.Plugins, p)
	}
	return state
}

// ── HTTP ──────────────────────────────────────────────────────

func (m *ManagementServer) handlePlugins(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	mgmtJSON(w, http.StatusOK, m.pluginState())
}

// pluginState is the list plus what this server allows: every response that carries a state uses
// it, so the page keeps knowing whether it may write after an install finishes.
func (m *ManagementServer) pluginState() DSHPluginsState {
	state := listDSHPlugins()
	policy := m.pluginPolicy()
	state.WritesAllowed = m.token != ""
	state.AllowNonRegistry = policy.AllowNonRegistry
	state.Registry = policy.registryURL()
	return state
}

// requirePluginWrites refuses an install or a switch when the API has no token. The precedent is
// management_authorization.go: an unauthenticated management server cannot attest an owner, and
// these routes make this machine load code.
func (m *ManagementServer) requirePluginWrites(w http.ResponseWriter) bool {
	if m.token == "" {
		mgmtError(w, http.StatusForbidden, "管理 API 没设 token：这台机器上谁都能开这个端口。装插件、开关插件都要先设 management token。")
		return false
	}
	return true
}

// handlePluginsInstall runs `dsh plugin --profile web add <spec>` and streams its output: the run
// takes minutes on a cold npm cache, so the page reads progress instead of waiting on one response.
func (m *ManagementServer) handlePluginsInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if !m.requirePluginWrites(w) {
		return
	}
	var req struct {
		Spec string `json:"spec"`
		// ConfirmSource is the page's non-registry checkbox, sent back verbatim: with the switch on,
		// an API call alone must not be enough, or the checkbox would be page decoration.
		ConfirmSource string `json:"confirm_source"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	parsed, err := parsePluginSpec(req.Spec)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	if parsed.Kind != pluginKindRegistry && !m.pluginPolicy().AllowNonRegistry {
		mgmtError(w, http.StatusForbidden, "这个来源不是 npm registry："+nonRegistryHint)
		return
	}
	if parsed.Kind != pluginKindRegistry && req.ConfirmSource != pluginNonRegistryConfirm {
		mgmtError(w, http.StatusBadRequest, nonRegistryConfirmHint)
		return
	}
	dshBin, err := LookDSH()
	if err != nil {
		mgmtError(w, http.StatusConflict, "这台电脑还没装 DSH：先 npm i -g @deepseek-ai/dsh@latest")
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	flusher, _ := w.(http.Flusher)
	send := func(v any) {
		_ = enc.Encode(v)
		if flusher != nil {
			flusher.Flush()
		}
	}

	// Non-registry specs are not package names. Record dependencies so the result can identify
	// the package added or changed by DSH, without mistaking an unrelated bundle for success.
	before := map[string]string{}
	for _, p := range listDSHPlugins().Plugins {
		before[p.Name] = p.Source
	}

	ctx, cancel := context.WithTimeout(r.Context(), pluginInstallTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, dshBin, "plugin", "--profile", DSHProfile, "add", parsed.Raw)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		send(map[string]any{"error": err.Error(), "kind": "unknown"})
		return
	}
	cmd.Stderr = cmd.Stdout // pnpm writes its ERR_PNPM_* diagnostics to stderr
	var tail strings.Builder
	if err := cmd.Start(); err != nil {
		send(map[string]any{"error": err.Error(), "kind": "unknown"})
		return
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		send(map[string]any{"line": line})
		tail.WriteString(line)
		tail.WriteByte('\n')
		if tail.Len() > 64*1024 { // 来源：失败分类只看输出尾部，DSH 的 install-failure 同样只读尾部
			rest := tail.String()[tail.Len()/2:]
			tail.Reset()
			tail.WriteString(rest)
		}
	}
	waitErr := cmd.Wait()
	if waitErr == nil {
		state := m.pluginState()
		// Exit 0 only confirms the package command finished (#460). The existing page consumes
		// error/done, so an extra warning field on done would still display a false success.
		p, ok := installedPlugin(state, before, parsed)
		var detail string
		switch {
		case !ok:
			detail = "安装命令已结束，但无法确认对应的插件产物；请刷新插件列表核对，不能据此认定插件安装成功。"
		case p.Error != "":
			detail = fmt.Sprintf("安装命令已结束，但 %s 的插件文件无法读取：%s。请刷新插件列表核对。", p.Name, p.Error)
		case !p.Layer && !p.ClientOnly:
			detail = fmt.Sprintf("包 %s 已加入依赖，但不是可加载的插件：没有可识别的 DSH bundle 或客户端声明。包仍保留在 profile 中，可刷新列表查看或卸载。", p.Name)
		}
		if detail != "" {
			// No classifier kind: the existing page displays error verbatim in this case.
			send(map[string]any{"error": detail, "state": state})
			return
		}
		send(map[string]any{"done": true, "state": state})
		return
	}
	kind := classifyPluginFailure(tail.String(), errors.Is(ctx.Err(), context.DeadlineExceeded))
	send(map[string]any{
		"error": pluginFailureDetail(tail.String()),
		"kind":  kind,
		"log":   tailLines(tail.String(), 40),
		// DSH prints the exact remedy for a version rejection on its own; the page shows it and
		// stops there. Bothouse never runs it: approving a mismatch is DSH's own exact-version
		// decision, and this panel only relays what DSH said (#460).
		"allow_version": pluginAllowVersionCommand(tail.String()),
	})
}

// installedPlugin matches registry names directly. Non-registry installs must have a unique
// matching source or changed dependency; ambiguous/unidentifiable results are not success.
func installedPlugin(state DSHPluginsState, before map[string]string, spec pluginSpec) (DSHPlugin, bool) {
	var added []DSHPlugin
	for _, p := range state.Plugins {
		if spec.Kind == pluginKindRegistry && p.Name == spec.Name {
			return p, true
		}
		if previous, exists := before[p.Name]; !exists || previous != p.Source || p.Source == spec.Raw {
			added = append(added, p)
		}
	}
	if spec.Kind == pluginKindRegistry {
		return DSHPlugin{}, false
	}
	if len(added) == 1 {
		return added[0], true
	}
	// A reinstall of an installed plugin changes no dependency, and DSH may have stored the spec in
	// another spelling (#656). Accept only an entry whose recorded source names the same source, and
	// only when exactly one does; otherwise the run stays unconfirmed.
	want := normalizePluginSource(spec.Raw)
	var match []DSHPlugin
	for _, p := range state.Plugins {
		if normalizePluginSource(p.Source) == want {
			match = append(match, p)
		}
	}
	if len(match) == 1 {
		return match[0], true
	}
	return DSHPlugin{}, false
}

// pluginGitHubURL is a GitHub https URL pnpm rewrites to the `github:` shorthand.
var pluginGitHubURL = regexp.MustCompile(`^(?:git\+)?https://github\.com/([^/#]+)/([^/#]+?)(?:\.git)?/?(#.*)?$`)

// normalizePluginSource maps a typed spec and the form DSH writes into package.json onto one string,
// for the rewrites DSH actually makes. 来源：#656 实测 dsh 0.2.1-rc.5 / pnpm 12.16.1：
// `/abs/dir` → `link:/abs/dir`；`/abs/x.tgz` → `file:/abs/x.tgz`；`file:`、`git+file://`、`github:` 原样；
// `https://github.com/o/r[.git]`、`git+https://github.com/o/r.git` → `github:o/r`，`#ref` 保留。
// Anything else is compared as written, so an unmeasured spelling stays unconfirmed rather than guessed.
func normalizePluginSource(source string) string {
	s := strings.TrimSpace(source)
	if m := pluginGitHubURL.FindStringSubmatch(s); m != nil {
		return "github:" + m[1] + "/" + m[2] + m[3]
	}
	path := s
	for _, prefix := range []string{"link:", "file:"} {
		if strings.HasPrefix(path, prefix) {
			path = strings.TrimPrefix(path, prefix)
			break
		}
	}
	if pluginPathSpec(path) {
		// Only absolute paths: a relative one depends on the directory DSH resolved it from.
		return "path:" + filepath.ToSlash(filepath.Clean(path))
	}
	return s
}

// classifyPluginFailure turns a failed pnpm run into one of the kinds the page has text for.
// The patterns are DSH's own install-failure classifier
// (@deepseek-ai/dsh-plugin-manager/lib/types/install-failure.js), in its order, so both surfaces
// name the same failure the same way.
func classifyPluginFailure(log string, timedOut bool) string {
	if timedOut {
		return "timeout"
	}
	for _, rule := range []struct{ kind, pattern string }{
		// DSH exits 127 when pnpm is not on PATH and says so in one line.
		// 来源：dsh lib/plugin-BiveYA7h.js:94 "pnpm was not found; install pnpm …".
		{"pnpm-missing", `pnpm was not found|pnpm: command not found|command not found: pnpm`},
		// DSH refuses a bundle whose declared requirements this runtime does not satisfy, and says so
		// in one line before it writes anything.
		// 来源：dsh-app-boot evaluatePluginCompatibility 的 "is incompatible with dsh <version>: requirements …".
		{"incompatible", `is incompatible with dsh|Exact-version exemption|allow-version`},
		{"build-blocked", `ERR_PNPM_IGNORED_BUILDS|Ignored build scripts`},
		{"not-found", `ERR_PNPM_FETCH_404|\bE404\b|404 Not Found|Not Found - GET`},
		{"no-matching-version", `ERR_PNPM_NO_MATCHING_VERSION|\bETARGET\b|No matching version`},
		{"disk-full", `\bENOSPC\b|no space left on device`},
		{"permission", `\bEACCES\b|\bEPERM\b|permission denied`},
		{"integrity", `ERR_PNPM_TARBALL_INTEGRITY|ERR_PNPM_BAD_TARBALL_SIZE|\bEINTEGRITY\b`},
		{"network", `\bENOTFOUND\b|\bECONNRESET\b|\bETIMEDOUT\b|\bECONNREFUSED\b|\bEAI_AGAIN\b|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_FETCH_5[0-9][0-9]|ERR_PNPM_FETCH_TIMEOUT|\bFETCH_ERROR\b|socket hang up|Could not resolve host|unable to access`},
	} {
		if regexp.MustCompile("(?i)" + rule.pattern).MatchString(log) {
			return rule.kind
		}
	}
	return "unknown"
}

// pluginAllowVersionCommand returns DSH's own "to accept the risk, run: …" line, if the run printed
// one. DSH prints it only for a version rejection, naming the exact package@version, the exact DSH
// runtime and `--accept-risk`; the page relays that sentence instead of spelling a command itself,
// so a later DSH wording change cannot leave this panel telling people to run something wrong.
// 来源：dsh lib/plugin-BiveYA7h.js:95 "dsh: to accept the risk, run: dsh plugin --profile … allow-version … --accept-risk"。
func pluginAllowVersionCommand(log string) string {
	const prefix = "dsh: to accept the risk, run: "
	for _, line := range strings.Split(log, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return ""
}

// pluginFailureDetail is the one line worth showing next to the readable message: pnpm's own error
// code, not the whole transcript (the page keeps that under "details").
func pluginFailureDetail(log string) string {
	for _, line := range strings.Split(log, "\n") {
		if strings.Contains(line, "ERR_PNPM_") || strings.Contains(line, "×") {
			return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "Error: "))
		}
	}
	return tailLines(log, 1)
}

// pluginSwitchError carries the HTTP status a locked switch check should answer with, so a
// "not installed" inside the lock keeps its 404 instead of becoming a generic 409.
type pluginSwitchError struct {
	status int
	msg    string
}

func (e *pluginSwitchError) Error() string { return e.msg }

// pluginSwitch changes the profile's selected bundles. This is exactly DSH's setBundleEnabled: the
// same list in the same file, so DSH's own Plugins page shows the switch too. Nothing is uninstalled
// and no data is touched, so switching back on restores the old state.
func (m *ManagementServer) handlePluginsSwitch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if !m.requirePluginWrites(w) {
		return
	}
	var req struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	dir := dshProfileDir()
	// The whole read-modify-write runs under DSH's profile lock. Reading outside and only writing
	// inside would let a concurrent `dsh plugin add` (or DSH's own Plugins page) add a bundle after
	// our snapshot was taken; we would then write the old list back and silently drop its change
	// while still answering changed=true. Recomputing from the locked read keeps whichever write
	// finished first and makes the second one build on it.
	changed := false
	writeErr := withPluginProfileLock(filepath.Join(dir, "package.json"), func() error {
		manifest, current, err := readPluginManifest(dir)
		if err != nil {
			return &pluginSwitchError{status: http.StatusConflict, msg: err.Error()}
		}
		// The base layer comes from the DSH installation, not this profile's dependencies, so the
		// name is checked first: refusing it as "not installed" would be a wrong reason.
		if req.Name == "@deepseek-ai/dsh-base" {
			return &pluginSwitchError{status: http.StatusConflict, msg: "dsh-base 是 DSH 的面板本体，停掉就没有界面可用了"}
		}
		if _, ok := manifest.Dependencies[req.Name]; !ok {
			return &pluginSwitchError{status: http.StatusNotFound, msg: "这个插件不在这份 profile 的依赖里；先装它"}
		}
		bundles := make([]string, 0, len(manifest.DSH.Profile.Bundles)+1)
		for _, name := range manifest.DSH.Profile.Bundles {
			if name == req.Name && !req.Enabled {
				changed = true
				continue
			}
			bundles = append(bundles, name)
		}
		if req.Enabled && !slices.Contains(manifest.DSH.Profile.Bundles, req.Name) {
			bundles = append(bundles, req.Name)
			changed = true
		}
		if !changed {
			return nil
		}
		doc, err := editProfileBundles(current, bundles)
		if err != nil {
			return err
		}
		// 来源：沿用配置变更的时间戳备份（setDSHModuleDisabled 与 config 写入同一惯例）。
		backup := filepath.Join(dir, "package.json.bak-"+time.Now().Format("20060102-150405.000000000"))
		if err := AtomicWriteFile(backup, current, 0o600); err != nil {
			return fmt.Errorf("备份 package.json 失败: %w", err)
		}
		if err := AtomicWriteFile(filepath.Join(dir, "package.json"), doc, 0o600); err != nil {
			return fmt.Errorf("写入 package.json 失败: %w", err)
		}
		return nil
	})
	if writeErr != nil {
		var se *pluginSwitchError
		if errors.As(writeErr, &se) {
			mgmtError(w, se.status, se.msg)
			return
		}
		mgmtError(w, http.StatusConflict, writeErr.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{
		"changed": changed,
		"state":   m.pluginState(),
		// DSH reads the bundle list at start; a running DSH keeps the old composition until restart.
		"restart_required": changed,
	})
}

// editProfileBundles replaces dsh.profile.bundles in place and leaves every other byte of the
// manifest alone. Re-encoding the whole file through a map would alphabetize the keys, and the user
// would see a diff they never made.
func editProfileBundles(raw []byte, bundles []string) ([]byte, error) {
	start, end, err := jsonValueSpan(raw, "dsh", "profile", "bundles")
	if err != nil {
		return nil, err
	}
	value, err := renderBundles(bundles, indentAt(raw, start))
	if err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(raw)-(end-start)+len(value))
	out = append(out, raw[:start]...)
	out = append(out, value...)
	return append(out, raw[end:]...), nil
}

// renderBundles writes the list the way DSH's own writer does (JSON.stringify with 2 spaces: one
// entry per line), so a switch made here and a switch made in DSH's Plugins page leave the file
// looking the same. indent is the column the value starts at.
func renderBundles(bundles []string, indent string) ([]byte, error) {
	if len(bundles) == 0 {
		return []byte("[]"), nil
	}
	var b strings.Builder
	b.WriteString("[\n")
	for i, name := range bundles {
		quoted, err := json.Marshal(name)
		if err != nil {
			return nil, err
		}
		b.WriteString(indent + "  ")
		b.Write(quoted)
		if i < len(bundles)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString(indent + "]")
	return []byte(b.String()), nil
}

// indentAt is the leading whitespace of the line holding pos.
func indentAt(raw []byte, pos int) string {
	line := bytes.LastIndexByte(raw[:pos], '\n') + 1
	end := line
	for end < len(raw) && (raw[end] == ' ' || raw[end] == '\t') {
		end++
	}
	return string(raw[line:end])
}

// jsonValueSpan finds the byte span of the value at a key path. Walking with the decoder (instead
// of unmarshalling into maps) keeps the span byte-exact, so only the bundles list changes.
func jsonValueSpan(raw []byte, path ...string) (int, int, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return walkJSONPath(dec, path)
}

func walkJSONPath(dec *json.Decoder, path []string) (int, int, error) {
	tok, err := dec.Token()
	if err != nil {
		return 0, 0, err
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return 0, 0, fmt.Errorf("package.json: %s is not an object", path[0])
	}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return 0, 0, err
		}
		if key, _ := tok.(string); key != path[0] {
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				return 0, 0, err
			}
			continue
		}
		if len(path) > 1 {
			return walkJSONPath(dec, path[1:])
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return 0, 0, err
		}
		end := int(dec.InputOffset())
		return end - len(value), end, nil
	}
	return 0, 0, fmt.Errorf("package.json has no %s key", strings.Join(path, "."))
}

// ── install policy + inspect ──────────────────────────────────

// nonRegistryHint is the one sentence both the refusal and the page use, so the person learns the
// switch's name once.
const nonRegistryHint = "只有 npm registry 上的包默认能装。要装 git 仓库、tarball 或本地路径，先在 config.toml 里加 [plugins] allow_non_registry = true，装的时候这里会再问你一次。"

// pluginNonRegistryConfirm is the exact value the page sends after the person ticks the
// non-registry box. A literal rather than true/1: a truthy value would be sent by anything that can
// set an extra JSON field, which is the one-click path the confirm step exists to close.
const pluginNonRegistryConfirm = "non-registry"

// nonRegistryConfirmHint refuses a non-registry install that skipped the page's acknowledgement.
// Wording follows nonRegistryAck in bridge/web/src/pages/Plugins/texts.ts, so the page's checkbox
// and this error name the same sentence.
const nonRegistryConfirmHint = "其它来源需要先在这个页面上显式确认：勾选「我知道这个地址是什么，继续」后再装。"

// SetPluginInstallPolicy wires the install switch to config.toml (cmd/cc-connect).
func (m *ManagementServer) SetPluginInstallPolicy(fn func() PluginInstallPolicy) {
	m.pluginInstallPolicy = fn
}

// pluginPolicy is the effective policy; a server built without one allows the registry only.
func (m *ManagementServer) pluginPolicy() PluginInstallPolicy {
	if m.pluginInstallPolicy == nil {
		return PluginInstallPolicy{}
	}
	return m.pluginInstallPolicy()
}

// handlePluginsInspect describes what a spec would install, before anything runs.
//
// This exists because the old page went straight from "type a spec" to "load this code": an npm
// name is one thing, a git URL another, and neither told the person who published it or what it may
// do. Nothing here installs; the run is still the separate POST.
func (m *ManagementServer) handlePluginsInspect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	parsed, err := parsePluginSpec(r.URL.Query().Get("spec"))
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, inspectPluginSpec(r.Context(), parsed, m.pluginPolicy(), dshRuntimeVersion(r.Context())))
}
