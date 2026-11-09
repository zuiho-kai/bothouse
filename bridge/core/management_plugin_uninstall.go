package core

// 插件卸载 (#1377): removing a bundle this profile installed, through the same CLI install uses.
//
// `dsh plugin --profile web remove -- <name>` is pnpm's remove forwarded verbatim (the CLI help
// says so), so it takes the same `package.json.lock` as an add and `reconcile()` drops the bundle
// from `dsh.profile.bundles` by itself. What that command does *not* do is refuse the three kinds
// of package that must not be removed through a panel button, so they are checked here, before the
// command runs:
//
//   - a layer that comes from the DSH installation (`@deepseek-ai/dsh-base` is not even in the
//     profile's dependencies; `@deepseek-ai/dsh-web-app` is linked in from the install directory),
//   - a package another installed package still depends on (pnpm removes the target silently and
//     the dependent package then fails at load with MODULE_NOT_FOUND),
//   - a name this profile does not have.
//
// The reverse-dependency check reads `node_modules/*/package.json` instead of asking pnpm: `pnpm
// why` answers `[]` for a link: package, so it cannot be trusted here.

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// pluginUninstallTimeout bounds `dsh plugin remove`: it deletes files from the profile, it does not
// download anything.
// 来源：方案实测 `dsh plugin remove` 整体约 0.35s（notes/plugin-uninstall-plan-20261109.md 一.1），
// 这里留足冷缓存与杀毒软件扫描的余量；不沿用安装那份 5 分钟。
const pluginUninstallTimeout = 30 * time.Second

// pluginUninstallError carries the HTTP status and the classifier kind the page has text for.
type pluginUninstallError struct {
	status int
	kind   string
	msg    string
	// inUse names the packages that still depend on the target; only set for in-use.
	inUse []string
}

func (e *pluginUninstallError) Error() string { return e.msg }

// handlePluginsUninstall removes one dependency from this profile.
func (m *ManagementServer) handlePluginsUninstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if !m.requirePluginWrites(w) {
		return
	}
	var req struct {
		Name string `json:"name"`
		// Confirm must equal Name. The page sends it only after the person typed the package name
		// into the dialog; a truthy flag would be one click, which is what the step exists to stop.
		// 来源：方案 §二.2，与 install 的 confirm_source 同一个套路。
		Confirm string `json:"confirm"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || strings.HasPrefix(name, "-") || strings.ContainsAny(name, " \t\n") {
		uninstallError(w, &pluginUninstallError{
			status: http.StatusBadRequest,
			kind:   "invalid-name",
			msg:    "包名不对：填 profile 依赖里的完整包名，不带版本、不带空格。",
		})
		return
	}
	if req.Confirm != name {
		uninstallError(w, &pluginUninstallError{
			status: http.StatusBadRequest,
			kind:   "confirm-mismatch",
			msg:    "包名不对，再输一次。",
		})
		return
	}
	dshBin, err := LookDSH()
	if err != nil {
		mgmtError(w, http.StatusConflict, "这台电脑还没装 DSH：先 npm i -g @deepseek-ai/dsh")
		return
	}

	dir := dshProfileDir()
	// The checks read the manifest the same way the switch does, under DSH's own lock, so another
	// writer cannot add or drop a dependency between the check and the decision. The lock is
	// released before `dsh plugin remove` runs: that command takes the same lock itself, and
	// holding it here would make the uninstall wait on us.
	var checkErr error
	lockErr := withPluginProfileLock(filepath.Join(dir, "package.json"), func() error {
		checkErr = pluginUninstallPrecheck(dir, name)
		return nil
	})
	if lockErr != nil {
		mgmtError(w, http.StatusConflict, lockErr.Error())
		return
	}
	if checkErr != nil {
		var se *pluginUninstallError
		if errors.As(checkErr, &se) {
			uninstallError(w, se)
			return
		}
		mgmtError(w, http.StatusConflict, checkErr.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), pluginUninstallTimeout)
	defer cancel()
	// `--` keeps a name that starts with '-' from being read as a pnpm flag. 来源：方案一.1
	// (`remove -- <name>` eats a leading dash as a package name).
	cmd := exec.CommandContext(ctx, dshBin, "plugin", "--profile", DSHProfile, "remove", "--", name)
	out, runErr := cmd.CombinedOutput()
	text := string(out)
	if runErr != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			uninstallError(w, &pluginUninstallError{
				status: http.StatusConflict,
				kind:   "timeout",
				msg:    "卸载超时了。先在终端跑一次 dsh plugin remove，再回来刷新看看。",
			})
			return
		}
		// pnpm's own words never reach the page; only its error code tells us which readable
		// sentence fits. 来源：方案 §二.2 把 ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS 归到 not-removable。
		if strings.Contains(text, "ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS") {
			uninstallError(w, &pluginUninstallError{
				status: http.StatusForbidden,
				kind:   "not-removable",
				msg:    "这一层不是这份 profile 装的，不能在这里卸载。",
			})
			return
		}
		uninstallError(w, &pluginUninstallError{
			status: http.StatusConflict,
			kind:   "unknown",
			msg:    "没卸成，DSH 没有说明原因。到 DSH 的插件页或终端里再试一次。",
		})
		return
	}

	mgmtJSON(w, http.StatusOK, map[string]any{
		"uninstalled": true,
		"state":       m.pluginState(),
		// DSH reads dsh.profile.bundles at start; the removed layer keeps loading until restart.
		// 来源：方案 §一.4。
		"restart_required": true,
	})
}

// pluginUninstallPrecheck answers "may this name be removed from this profile?" and returns nil
// when it may. It runs with the profile lock held, before any process is started.
func pluginUninstallPrecheck(dir, name string) error {
	manifest, _, err := readPluginManifest(dir)
	if err != nil {
		return &pluginUninstallError{status: http.StatusConflict, kind: "manifest", msg: err.Error()}
	}
	installRoot := ""
	if anchor := dshInstallAnchor(); anchor != "" {
		installRoot = filepath.Dir(anchor)
	}
	pkgDir := resolveDSHBundle(name, dshInstallAnchor(), dir)
	shipped := installRoot != "" && strings.HasPrefix(pkgDir, installRoot+string(filepath.Separator))

	// (a) built-in layers. dsh-base is not in the profile's dependencies at all, so the name is
	// checked before "not installed": refusing it as missing would name the wrong reason.
	if name == "@deepseek-ai/dsh-base" {
		return &pluginUninstallError{
			status: http.StatusForbidden,
			kind:   "not-removable",
			msg:    "dsh-base 是 DSH 的面板本体，卸掉就没有界面可用了。",
		}
	}
	if shipped {
		return &pluginUninstallError{
			status: http.StatusForbidden,
			kind:   "not-removable",
			msg:    "这一层随 DSH 一起安装，不能在这里卸载。",
		}
	}
	source, ok := manifest.Dependencies[name]
	if !ok {
		return &pluginUninstallError{
			status: http.StatusNotFound,
			kind:   "not-installed",
			msg:    "这份 profile 里没有这个包。",
		}
	}
	// (b) a layer linked in from the installation directory: removing it deletes the profile's
	// reference, and DSH starts one layer short. 来源：方案一.3 的实测。
	if strings.HasPrefix(source, "link:") && installRoot != "" {
		target := strings.TrimPrefix(source, "link:")
		if resolved, err := filepath.EvalSymlinks(target); err == nil {
			target = resolved
		}
		if strings.HasPrefix(target, installRoot+string(filepath.Separator)) {
			return &pluginUninstallError{
				status: http.StatusForbidden,
				kind:   "not-removable",
				msg:    "这一层从 DSH 安装目录链接进来，随 DSH 一起安装，不能在这里卸载。",
			}
		}
	}
	// (c) something still depends on it. pnpm removes the target and says nothing; the dependent
	// package then dies at load with MODULE_NOT_FOUND.
	if who := pluginReverseDeps(dir, name); len(who) > 0 {
		return &pluginUninstallError{
			status: http.StatusConflict,
			kind:   "in-use",
			msg:    strings.Join(who, "、") + " 还在用它，先卸载 " + strings.Join(who, "、") + "。",
			inUse:  who,
		}
	}
	return nil
}

// pluginReverseDeps lists the installed packages in the profile that name `name` in their own
// dependency fields. It reads the same tree pnpm writes (`node_modules/<pkg>` and
// `node_modules/@<scope>/<pkg>`), so it sees link: packages that `pnpm why` answers `[]` for.
func pluginReverseDeps(dir, name string) []string {
	root := filepath.Join(dir, "node_modules")
	// pnpm installs a dependency as a symlink into its store, and a `link:` dependency as a symlink
	// at the source directory; both are the common case here, so a directory test has to follow the
	// link. `DirEntry.IsDir` does not (it reports the link itself), which would skip every real
	// package and make this check silently useless — the real-entry run found exactly that.
	isPkgDir := func(path string) bool {
		info, err := os.Stat(path)
		return err == nil && info.IsDir()
	}
	var dirs []string
	if entries, err := os.ReadDir(root); err == nil {
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			p := filepath.Join(root, name)
			if strings.HasPrefix(name, "@") {
				if scoped, err := os.ReadDir(p); err == nil {
					for _, inner := range scoped {
						if child := filepath.Join(p, inner.Name()); !strings.HasPrefix(inner.Name(), ".") && isPkgDir(child) {
							dirs = append(dirs, child)
						}
					}
				}
				continue
			}
			if isPkgDir(p) {
				dirs = append(dirs, p)
			}
		}
	}
	sort.Strings(dirs)
	var who []string
	seen := map[string]bool{}
	for _, pkgDir := range dirs {
		raw, err := os.ReadFile(filepath.Join(pkgDir, "package.json"))
		if err != nil {
			continue
		}
		var pkg struct {
			Name                 string            `json:"name"`
			Dependencies         map[string]string `json:"dependencies"`
			PeerDependencies     map[string]string `json:"peerDependencies"`
			OptionalDependencies map[string]string `json:"optionalDependencies"`
		}
		if err := json.Unmarshal(raw, &pkg); err != nil || pkg.Name == "" || pkg.Name == name {
			continue
		}
		if _, ok := pkg.Dependencies[name]; !ok {
			if _, ok := pkg.PeerDependencies[name]; !ok {
				if _, ok := pkg.OptionalDependencies[name]; !ok {
					continue
				}
			}
		}
		if !seen[pkg.Name] {
			seen[pkg.Name] = true
			who = append(who, pkg.Name)
		}
	}
	return who
}

// uninstallError writes the readable sentence plus the kind the page translates, and the blocking
// package names for in-use so the page can say who.
func uninstallError(w http.ResponseWriter, e *pluginUninstallError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	body := map[string]any{"ok": false, "error": e.msg, "kind": e.kind}
	if len(e.inUse) > 0 {
		body["in_use_by"] = e.inUse
	}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("management api: write uninstall error JSON failed", "error", err)
	}
}
