package core

// 插件 (#150 第 b 项): what an install spec may name, and what the panel shows before the run.
//
// The install route is the one place in the panel that makes this machine load code someone else
// wrote, so the default is narrow on purpose: an npm registry package name with an optional version
// or tag, and nothing else. A git host, a tarball over HTTP or a local path is a different risk (the
// bytes are not the ones the registry signed), so those need both the config switch
// `[plugins] allow_non_registry` and a second confirmation from the person.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// What a spec names. Only "registry" is accepted without the config switch.
const (
	pluginKindRegistry = "registry"
	pluginKindGit      = "git"
	pluginKindTarball  = "tarball"
	pluginKindPath     = "path"
	pluginKindUnknown  = "unknown"
)

// pluginRegistryName is npm's own package-name rule: lowercase URL-safe segments, an optional scope,
// no leading dot or underscore.
// 来源：DSH 自己的 install-spec.js 里 PACKAGE_NAME（同样只收 registry 形态，同一条 214 字符上限）。
var pluginRegistryName = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$`)

// pluginNameMaxLength is npm's limit for the name part of a spec.
// 来源：DSH install-spec.js 的 PACKAGE_NAME_MAX_LENGTH = 214。
const pluginNameMaxLength = 214

// pluginGitShorthand, pluginHTTPGit, pluginTarball and pluginPartialVersion classify the parts of a
// spec; compiled once so a request never re-compiles them.
var (
	pluginGitShorthand   = regexp.MustCompile(`^(?:github|gitlab|bitbucket|gist):`)
	pluginHTTPGit        = regexp.MustCompile(`^https?://[^/]+/[^/]+/[^/#]+(?:\.git)?(?:#.*)?$`)
	pluginTarball        = regexp.MustCompile(`\.(?:tgz|tar\.gz)(?:#.*)?$`)
	pluginPartialVersion = regexp.MustCompile(`^v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$`)
)

// pluginRangeOK is the part after `@`: a version, a partial version, a tag, or a tag selector.
// 来源：pnpm add 接受「包名@版本|标签」，这里只放行字符，不解析语义（语义交给 DSH 与 registry）。
var pluginRangeOK = regexp.MustCompile(`^[~^><=]?[A-Za-z0-9][A-Za-z0-9._~^+*|-]*$`)

// ErrPluginSpecRefused wraps every spec rejection so the route can answer 400 without inspecting text.
var ErrPluginSpecRefused = errors.New("plugin spec refused")

// ErrPluginNonRegistryOff is the refusal for a git/tarball/path spec while the switch is off.
var ErrPluginNonRegistryOff = errors.New("non-registry plugin sources are off")

// pluginSpec is a parsed install spec.
type pluginSpec struct {
	Raw  string
	Name string // package name without the range; the whole spec for git/tarball/path
	Kind string
}

// parsePluginSpec reads a typed spec into the form it takes. Anything this build does not recognise
// is refused here rather than by pnpm, because pnpm's own acceptance is wider than ours.
func parsePluginSpec(raw string) (pluginSpec, error) {
	spec := strings.TrimSpace(raw)
	if spec == "" {
		return pluginSpec{}, fmt.Errorf("%w: 先填要装的包名", ErrPluginSpecRefused)
	}
	lower := strings.ToLower(spec)
	switch {
	case strings.HasPrefix(spec, "-"):
		// A spec that starts with '-' would reach `dsh plugin add` as a flag.
		return pluginSpec{}, fmt.Errorf("%w: 包名不能以 - 开头", ErrPluginSpecRefused)
	case pluginTarball.MatchString(lower):
		return pluginSpec{Raw: spec, Name: spec, Kind: pluginKindTarball}, nil
	case pluginGitShorthand.MatchString(lower),
		strings.HasPrefix(lower, "git+"),
		strings.HasPrefix(lower, "git@"),
		strings.HasPrefix(lower, "git://"),
		pluginHTTPGit.MatchString(lower):
		return pluginSpec{Raw: spec, Name: spec, Kind: pluginKindGit}, nil
	case strings.HasPrefix(lower, "file:"), strings.HasPrefix(lower, "link:"),
		strings.HasPrefix(spec, "./"), strings.HasPrefix(spec, "../"),
		pluginPathSpec(spec):
		return pluginSpec{Raw: spec, Name: spec, Kind: pluginKindPath}, nil
	}

	// The range separator is the last '@' past position 0: a scoped name starts with one too
	// (@scope/name@1.2.3), so the first one is the scope, not the separator.
	name, rng := spec, ""
	if at := strings.LastIndex(spec, "@"); at > 0 {
		name, rng = spec[:at], spec[at+1:]
	}
	if len(name) > pluginNameMaxLength || !pluginRegistryName.MatchString(name) {
		if pluginPathLikeSpec(spec) {
			// #1431: someone typed a path and this build did not read it as one. Saying "包名只能是
			// npm registry 上的名字" here sends them looking in the wrong place.
			return pluginSpec{}, fmt.Errorf("%w: 这看着像个本地路径，但不是能装的绝对路径：Mac/Linux 用 / 开头，Windows 用 C:\\ 或 C:/ 开头（网络路径用 \\\\服务器\\共享\\…），也可以写 link: 前缀；现在是 %q", ErrPluginSpecRefused, spec)
		}
		return pluginSpec{}, fmt.Errorf("%w: 包名只能是 npm registry 上的名字（小写字母、数字、- _ . ~，可带 @scope/），现在是 %q", ErrPluginSpecRefused, name)
	}
	if rng != "" && !pluginRangeOK.MatchString(rng) {
		return pluginSpec{}, fmt.Errorf("%w: 版本或标签只能是字母、数字和 . - _ ~ ^ + * |", ErrPluginSpecRefused)
	}
	return pluginSpec{Raw: spec, Name: name, Kind: pluginKindRegistry}, nil
}

// pluginPathSpec reports whether spec names a local path in any of the forms the three platforms use.
//
// #1431: the first version asked only `strings.HasPrefix(spec, "/")`, so `C:\…` fell through to the
// npm-name check and was refused with a message about package names. The question here is what the
// person typed, not what the host would resolve: the same panel is used on Windows and on Mac/Linux,
// and a Windows path is still a Windows path when the check runs somewhere else (tests, a log copied
// between machines). So the answer is the same on every host: filepath.IsAbs for the host's own forms
// (POSIX `/…`, plus whatever Windows adds there), windowsVolumeOf for the Windows drive and UNC shapes
// a non-Windows filepath does not know.
func pluginPathSpec(spec string) bool {
	// POSIX absolute: the form this branch has always taken, kept first so Mac/Linux behaviour cannot move.
	if strings.HasPrefix(spec, "/") || filepath.IsAbs(spec) {
		return true
	}
	// Windows absolute paths, judged the same way on every host: filepath knows them only on Windows,
	// so the drive/UNC rule is spelled out in windowsVolumeOf. On Windows filepath.IsAbs covers the
	// same specs; on Mac/Linux it does not, and that is the whole point of the second check.
	//
	// filepath.VolumeName is not used as the test: on Windows it answers "C:" for `C:relative\win`
	// too, and that is a drive-relative path, not an absolute one (a Windows test run caught this).
	return windowsVolumeOf(spec) != ""
}

// windowsVolumeOf is what filepath.VolumeName returns on Windows for an absolute spec's volume
// ("C:", `\\host\share`), or "" when spec is not a Windows absolute path. Kept separate so the answer
// does not depend on the host: on Unix filepath.VolumeName always returns "".
// 来源：Windows 路径规则——盘符 + 冒号 + 分隔符是绝对路径；`C:foo` 是「当前盘上的相对路径」，
// VolumeName 对它同样返回 "C:"，所以只认卷名会把非绝对路径当绝对路径，必须同时要求分隔符。
// UNC 是 `\\服务器\共享\…`，服务器名与共享名都要有。
func windowsVolumeOf(spec string) string {
	if len(spec) >= 3 && isPluginDriveLetter(spec[0]) && spec[1] == ':' && (spec[2] == '\\' || spec[2] == '/') {
		return spec[:2]
	}
	if !strings.HasPrefix(spec, `\\`) {
		return ""
	}
	rest := spec[2:]
	if rest == "" {
		// `\\` on its own: Windows calls this absolute (its volume is `\\`), so say the same here.
		return `\\`
	}
	i := strings.IndexAny(rest, `\/`)
	if i <= 0 { // `\\` followed by a separator: no server name
		return ""
	}
	server, tail := rest[:i], rest[i+1:]
	share := tail
	if j := strings.IndexAny(tail, `\/`); j >= 0 {
		share = tail[:j]
	}
	if share == "" {
		// `\\server` with no share: Windows' own filepath.IsAbs calls a UNC path absolute from the
		// leading `\\` on, so this returns the server alone rather than disagreeing with the host.
		return `\\` + server
	}
	return `\\` + server + `\` + share
}

// pluginPathLikeSpec reports whether a spec this build refused still looks like a path the person meant
// to give, so the refusal can name the shapes it reads instead of repeating npm's package-name rule.
// It only shapes the message: nothing is accepted because of it.
func pluginPathLikeSpec(spec string) bool {
	if strings.Contains(spec, `\`) {
		return true // `C:\…`, `\\server\…`, or a path with a typo in the drive part
	}
	// A colon before any scope or version separator: `C:…` (a drive-relative Windows path, which is not
	// absolute), `C:`, or a scheme this build does not take.
	colon := strings.IndexByte(spec, ':')
	if colon >= 0 && (strings.IndexByte(spec, '@') < 0 || colon < strings.IndexByte(spec, '@')) {
		return true
	}
	// Any other slash is a path too: the only registry name with a slash is `@scope/name`.
	return strings.Contains(spec, "/") && !strings.HasPrefix(spec, "@")
}

// isPluginDriveLetter reports whether b can start a Windows drive path. Letters cover real drives;
// digits are included because Windows' own filepath.VolumeName accepts them too, and this check must
// not answer differently on a different host.
func isPluginDriveLetter(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9'
}

// PluginInstallPolicy is what the config allows. Zero value = registry only, npm's own registry.
type PluginInstallPolicy struct {
	AllowNonRegistry bool
	Registry         string
}

// registryURL is the registry to ask, normalised with a trailing slash.
func (p PluginInstallPolicy) registryURL() string {
	if p.Registry == "" {
		return defaultPluginRegistry
	}
	u := strings.TrimSpace(p.Registry)
	if !strings.HasSuffix(u, "/") {
		u += "/"
	}
	return u
}

// defaultPluginRegistry is npm's public registry: what pnpm names when nothing is configured.
// 来源：DSH registry.js 的 OFFICIAL_NPM_REGISTRY。
const defaultPluginRegistry = "https://registry.npmjs.org/"

// pluginInspectTimeout bounds the one metadata read the confirm step makes.
// 来源：沿用 provider presets 的 15s（core/provider_presets.go presetsHTTPTimeout），同一个「读一次远端 JSON」动作。
const pluginInspectTimeout = 15 * time.Second

// PluginInspection is GET /api/v1/plugins/inspect: what the person is about to install.
type PluginInspection struct {
	Spec        string `json:"spec"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Version     string `json:"version,omitempty"`     // registry: the version the tag resolves to
	Registry    string `json:"registry,omitempty"`    // registry: where the bytes come from
	Publisher   string `json:"publisher,omitempty"`   // registry: the account that published it
	Description string `json:"description,omitempty"` // registry: the package's own summary
	Bundle      bool   `json:"bundle"`                // declares dsh.bundle, so DSH will load it
	Runtime     string `json:"runtime,omitempty"`     // `dsh --version`
	Requires    string `json:"requires,omitempty"`    // the plugin's declared DSH requirement
	// Compatible: true/false when the declared requirement could be checked here, nil when the
	// range syntax is one this build does not evaluate (DSH still enforces it at install).
	Compatible *bool  `json:"compatible,omitempty"`
	Required   string `json:"required"` // what installing this gives the package the right to do
	Allowed    bool   `json:"allowed"`  // may this spec be installed with the current config
	Reason     string `json:"reason,omitempty"`
	Error      string `json:"error,omitempty"` // metadata could not be read; the run may still work
}

// pluginPermissionText is what a DSH plugin can do once it is loaded. There is no per-plugin
// sandbox: a bundle is a Node module in the same process as the panel and the agent.
// 来源：DSH README 的 profile/组合层说明（插件与宿主同进程叠加，没有单独权限模型）。
const pluginPermissionText = "插件和面板、agent 在同一个进程里跑，没有单独的沙箱：装上就能读写这个账号能读写的任何文件、连任何网络、在启动时执行代码。只装你信得过的包。"

// inspectPluginSpec describes a spec without installing it. A metadata read that fails is reported in
// Error and does not block the run: the install's own error is the authority.
func inspectPluginSpec(ctx context.Context, spec pluginSpec, policy PluginInstallPolicy, dshVersion string) PluginInspection {
	out := PluginInspection{
		Spec:     spec.Raw,
		Name:     spec.Name,
		Kind:     spec.Kind,
		Runtime:  dshVersion,
		Required: pluginPermissionText,
	}
	switch spec.Kind {
	case pluginKindRegistry:
		out.Registry = policy.registryURL()
		out.Allowed = true
		meta, err := fetchRegistryVersion(ctx, policy.registryURL(), spec)
		if err != nil {
			out.Error = err.Error()
			return out
		}
		out.Version, out.Publisher = meta.Version, meta.Publisher
		out.Description, out.Bundle = meta.Description, meta.Bundle
		out.Requires = meta.Requires
		if meta.EngineRange != "" && dshVersion != "" {
			ok, understood := dshRangeAccepts(meta.EngineRange, dshVersion)
			if understood {
				out.Compatible = &ok
			}
		}
	default:
		// Nothing about a git/tarball/path spec can be read without fetching it, and fetching the
		// thing you are about to install is the install. Say only what is known.
		out.Allowed = policy.AllowNonRegistry
		out.Description = ""
		if !out.Allowed {
			out.Reason = "这个来源不是 npm registry：需要在 config.toml 的 [plugins] 里打开 allow_non_registry = true，并且在这里再确认一次。"
		}
	}
	return out
}

type registryMeta struct {
	Version     string
	Publisher   string
	Description string
	Bundle      bool
	// Requires is what the page shows: engines.dsh when declared, else the @deepseek-ai/dsh*
	// peer ranges (which DSH checks against its own installed packages).
	Requires string
	// EngineRange is set only for engines.dsh: that one names the runtime and is the only range
	// this build can compare against `dsh --version`.
	EngineRange string
}

// fetchRegistryVersion reads one version manifest from the registry. A spec with an explicit version
// asks for it; a bare name asks for `latest`; a tag asks for that tag. Anything else (a range) is not
// resolved here — the install resolves it, and a wrong guess shown before the run is worse than none.
func fetchRegistryVersion(ctx context.Context, registry string, spec pluginSpec) (registryMeta, error) {
	ref := "latest"
	if at := strings.LastIndex(spec.Raw, "@"); at > 0 && at < len(spec.Raw)-1 {
		ref = spec.Raw[at+1:]
	}
	u := registry + url.PathEscape(spec.Name) + "/" + url.PathEscape(ref)
	ctx, cancel := context.WithTimeout(ctx, pluginInspectTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return registryMeta{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := (&http.Client{Timeout: pluginInspectTimeout}).Do(req)
	if err != nil {
		return registryMeta{}, fmt.Errorf("读 registry 失败：%w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return registryMeta{}, fmt.Errorf("registry 上没有这个包或这个版本（%d）", resp.StatusCode)
	case http.StatusMethodNotAllowed:
		// A range: the registry will not resolve it for us, and the install will.
		return registryMeta{}, errors.New("这是个版本范围，registry 不直接解析；装的时候由 DSH 解析")
	default:
		return registryMeta{}, fmt.Errorf("registry 回了 %d", resp.StatusCode)
	}
	var body struct {
		Version     string `json:"version"`
		Description string `json:"description"`
		Engines     struct {
			DSH string `json:"dsh"`
		} `json:"engines"`
		Peer map[string]string `json:"peerDependencies"`
		DSH  struct {
			Bundle json.RawMessage `json:"bundle"`
		} `json:"dsh"`
		User struct {
			Name string `json:"name"`
		} `json:"_npmUser"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return registryMeta{}, fmt.Errorf("registry 回来的 JSON 读不了：%w", err)
	}
	m := registryMeta{
		Version:     body.Version,
		Publisher:   body.User.Name,
		Description: body.Description,
		Bundle:      len(body.DSH.Bundle) > 0 && string(body.DSH.Bundle) != "null",
	}
	switch {
	case body.Engines.DSH != "":
		m.Requires = "engines.dsh " + body.Engines.DSH
		m.EngineRange = body.Engines.DSH
	default:
		// DSH checks every @deepseek-ai/dsh* peer range against what the runtime has installed,
		// so the page lists them all. It does not evaluate them: only the runtime knows which
		// versions of those packages it actually carries.
		var peers []string
		for name, rng := range body.Peer {
			if strings.HasPrefix(name, "@deepseek-ai/dsh") {
				peers = append(peers, name+" "+rng)
			}
		}
		sort.Strings(peers)
		m.Requires = strings.Join(peers, ", ")
	}
	return m, nil
}

// dshRangeAccepts checks an `engines.dsh` range against the running DSH version, for the range
// shapes this build evaluates. understood=false means "not checked here": DSH enforces it at install.
// 来源：DSH 的兼容判定以 engines.dsh 为准（unmetRequirements），peer 范围它拿自己装的包比；
// 范围语法只实现 npm 最常见的 ^ ~ >= 与精确版本。
func dshRangeAccepts(require, version string) (accepted, understood bool) {
	if strings.Contains(require, "||") {
		return false, false // alternatives: not evaluated here
	}
	v := strings.TrimPrefix(strings.TrimSpace(version), "v")
	if semverRe.FindStringSubmatch(v) == nil {
		return false, false
	}
	terms := strings.Fields(strings.TrimSpace(require))
	if len(terms) == 0 {
		return true, true // an empty range is "*"
	}
	for _, term := range terms {
		ok, understood := dshRangeTerm(term, v)
		if !understood {
			return false, false
		}
		if !ok {
			return false, true
		}
	}
	return true, true
}

// dshRangeTerm checks one comparator: ^0.2.0, ~0.2.0, >=0.2.0, <0.3.0-0, =1.2.3, 1.2.3, *.
// A space-separated list is AND, which is how plugin authors write ">=0.2.1-rc.3 <0.3.0-0".
func dshRangeTerm(term, v string) (accepted, understood bool) {
	if term == "*" || term == "x" || term == "latest" {
		return true, true
	}
	for _, op := range []string{">=", ">", "<=", "<", "="} {
		if strings.HasPrefix(term, op) {
			base := strings.TrimSpace(strings.TrimPrefix(term, op))
			if !isPartialVersion(base) {
				return false, false
			}
			cmp := semverCompare(v, base)
			switch op {
			case ">=":
				return cmp >= 0, true
			case ">":
				return cmp > 0, true
			case "<=":
				return cmp <= 0, true
			case "<":
				return cmp < 0, true
			default:
				return cmp == 0, true
			}
		}
	}
	switch {
	case strings.HasPrefix(term, "^"):
		base := strings.TrimPrefix(term, "^")
		if !isPartialVersion(base) {
			return false, false
		}
		// ^x.y.z: same major (0.x: same minor) and at least x.y.z.
		if semverCompare(v, base) < 0 {
			return false, true
		}
		want, got := parseSemver(base), parseSemver(v)
		if want.major != got.major {
			return false, true
		}
		if want.major == 0 && want.minor != got.minor {
			return false, true
		}
		return true, true
	case strings.HasPrefix(term, "~"):
		base := strings.TrimPrefix(term, "~")
		if !isPartialVersion(base) {
			return false, false
		}
		if semverCompare(v, base) < 0 {
			return false, true
		}
		want, got := parseSemver(base), parseSemver(v)
		return want.major == got.major && want.minor == got.minor, true
	default:
		if !isPartialVersion(term) {
			return false, false
		}
		return semverCompare(v, term) == 0, true
	}
}

// isPartialVersion is x, x.y or x.y.z — what the range prefixes above are written against.
func isPartialVersion(s string) bool {
	return pluginPartialVersion.MatchString(strings.TrimSpace(s))
}

// dshRuntimeVersion is `dsh --version`, with the same trimming GetDSHStatus uses.
func dshRuntimeVersion(ctx context.Context) string {
	bin, err := LookDSH()
	if err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, pluginInspectTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "--version").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
