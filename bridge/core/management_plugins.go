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
				row := DSHPluginRow{ID: id.Value, Name: name.Value, Disabled: disabled[id.Value]}
				if flag := mapGet(item, "disabled"); flag != nil && flag.Tag == "!!bool" {
					var off bool
					if flag.Decode(&off) == nil {
						row.Disabled = off
					}
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
	dshBin, err := LookDSH()
	if err != nil {
		mgmtError(w, http.StatusConflict, "这台电脑还没装 DSH：先 npm i -g @deepseek-ai/dsh")
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
		send(map[string]any{"done": true, "state": m.pluginState()})
		return
	}
	kind := classifyPluginFailure(tail.String(), errors.Is(ctx.Err(), context.DeadlineExceeded))
	send(map[string]any{
		"error": pluginFailureDetail(tail.String()),
		"kind":  kind,
		"log":   tailLines(tail.String(), 40),
	})
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
	manifest, _, err := readPluginManifest(dir)
	if err != nil {
		mgmtError(w, http.StatusConflict, err.Error())
		return
	}
	// The base layer comes from the DSH installation, not this profile's dependencies, so the
	// name is checked first: refusing it as "not installed" would be a wrong reason.
	if req.Name == "@deepseek-ai/dsh-base" {
		mgmtError(w, http.StatusConflict, "dsh-base 是 DSH 的面板本体，停掉就没有界面可用了")
		return
	}
	if _, ok := manifest.Dependencies[req.Name]; !ok {
		mgmtError(w, http.StatusNotFound, "这个插件不在这份 profile 的依赖里；先装它")
		return
	}
	bundles := make([]string, 0, len(manifest.DSH.Profile.Bundles)+1)
	changed := false
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
	if changed {
		// Re-read and rewrite under DSH's own profile write lock, so a switch cannot interleave
		// with `dsh plugin add` (or DSH's Plugins page) editing the same file.
		writeErr := withPluginProfileLock(filepath.Join(dir, "package.json"), func() error {
			_, current, err := readPluginManifest(dir)
			if err != nil {
				return err
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
			mgmtError(w, http.StatusConflict, writeErr.Error())
			return
		}
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
