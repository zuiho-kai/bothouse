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
	state := DSHPluginsState{Profile: DSHProfile, ProfileDir: dir}
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
	mgmtJSON(w, http.StatusOK, listDSHPlugins())
}

// pluginSpecOK accepts what pnpm accepts as a package spec: a name, an optional version/tag, or a
// path/tarball. Leading '-' is refused so a "spec" can never become a flag of `dsh plugin`.
// 来源：pnpm add 的参数就是包名[ @ 版本或标签]，DSH 的安装框同样只收一个包规格。
var pluginSpecOK = regexp.MustCompile(`^[A-Za-z0-9@][A-Za-z0-9@._/~^:+-]*$`)

// handlePluginsInstall runs `dsh plugin --profile web add <spec>` and streams its output: the run
// takes minutes on a cold npm cache, so the page reads progress instead of waiting on one response.
func (m *ManagementServer) handlePluginsInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		Spec string `json:"spec"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	spec := strings.TrimSpace(req.Spec)
	if !pluginSpecOK.MatchString(spec) {
		mgmtError(w, http.StatusBadRequest, "包名只能包含字母、数字和 @ . _ / ~ ^ : + -，例如 @scope/pkg 或 pkg@1.2.3")
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
	cmd := exec.CommandContext(ctx, dshBin, "plugin", "--profile", DSHProfile, "add", spec)
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
		send(map[string]any{"done": true, "state": listDSHPlugins()})
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
	var req struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	dir := dshProfileDir()
	manifest, raw, err := readPluginManifest(dir)
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
		doc, err := editProfileBundles(raw, bundles)
		if err != nil {
			mgmtError(w, http.StatusConflict, err.Error())
			return
		}
		// 来源：沿用配置变更的时间戳备份（setDSHModuleDisabled 与 config 写入同一惯例）。
		backup := filepath.Join(dir, "package.json.bak-"+time.Now().Format("20060102-150405.000000000"))
		if err := AtomicWriteFile(backup, raw, 0o600); err != nil {
			mgmtError(w, http.StatusInternalServerError, "备份 package.json 失败: "+err.Error())
			return
		}
		if err := AtomicWriteFile(filepath.Join(dir, "package.json"), doc, 0o600); err != nil {
			mgmtError(w, http.StatusInternalServerError, "写入 package.json 失败: "+err.Error())
			return
		}
	}
	mgmtJSON(w, http.StatusOK, map[string]any{
		"changed": changed,
		"state":   listDSHPlugins(),
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
