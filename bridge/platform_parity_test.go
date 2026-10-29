package ccconnect

import (
	"bufio"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Platform capability parity (user 2026-10-30「我们核心是通用化，你这个问题犯错很多次了，怎么修」):
// a feature built in core and wired into one platform only (team mode, reply background) kept
// shipping as Discord-only. This test makes every platform take a stand on every optional
// capability core checks for, in platform/CAPABILITIES.md:
//
//   - only the platforms we support are checked (supportedPlatforms: DSH, Discord, 飞书, 自建网页);
//   - a capability is a core interface that core checks with a type assertion `.(X)` (or a type
//     switch case; an inline `.(interface{ Foo() })` is named "anon:Foo") and that at least one
//     supported platform implements. One no platform implements yet is not one: the first platform
//     that implements it makes it one, and the others fail until they take a stand;
//   - a platform implements it when some method in its package has each method name (names only:
//     not signatures, not the receiver type — a known limit);
//   - "Message.Reference" is the inbound "which message does this reply to" field: a platform
//     fills it when its code sets core.Message.Reference;
//   - a gap (capability a platform lacks) passes only when CAPABILITIES.md says 不支持：<原因> for
//     it or platform/capability_baseline.txt lists it. The baseline holds the gaps there were when
//     this check came in and only shrinks: a line not in origin/develop's version fails (skipped
//     when git or the ref is unavailable), and so does a line whose gap is closed or gone;
//   - SentMessageRecorder and Message.Reference may not go into the baseline: every supported
//     platform states 已接 or 不支持：<原因> for them in CAPABILITIES.md;
//   - a CAPABILITIES.md line must agree with the code.
//
// Run: go test -tags no_web -run TestPlatformCapabilityParity . (in bridge/).

const capabilityMatrixPath = "platform/CAPABILITIES.md"

// referenceCapability is the matrix section for core.Message.Reference.
const referenceCapability = "Message.Reference"

const (
	capWired       = "已接"
	capUnsupported = "不支持："
)

type coreInterface struct {
	name     string
	methods  []string
	embedded []string
}

type platformCode struct {
	name      string
	methods   map[string]bool
	reference bool // sets core.Message.Reference
}

func (p platformCode) implements(methods []string) bool {
	for _, m := range methods {
		if !p.methods[m] {
			return false
		}
	}
	return true
}

func (p platformCode) has(capability string, caps map[string][]string) bool {
	if capability == referenceCapability {
		return p.reference
	}
	return p.implements(caps[capability])
}

func parseGoFiles(dir string) ([]*ast.File, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	fset := token.NewFileSet()
	var files []*ast.File
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}

// scanPlatformCapabilities returns the capabilities (name → method names) and every platform's code.
func scanPlatformCapabilities(root string) (map[string][]string, []platformCode, error) {
	coreFiles, err := parseGoFiles(filepath.Join(root, "core"))
	if err != nil {
		return nil, nil, err
	}
	ifaces := map[string]*coreInterface{}
	asserted := map[string]bool{}
	// assert records an asserted type: a named interface by its name, an inline one
	// (`x.(interface{ Foo() })`) by "anon:" + its sorted method names, so it is a capability too.
	assert := func(e ast.Expr) {
		switch t := e.(type) {
		case *ast.Ident:
			asserted[t.Name] = true
		case *ast.InterfaceType:
			ci := interfaceOf(t)
			parts := append(append([]string(nil), ci.methods...), ci.embedded...)
			sort.Strings(parts)
			ci.name = "anon:" + strings.Join(parts, "+")
			ifaces[ci.name] = ci
			asserted[ci.name] = true
		}
	}
	for _, f := range coreFiles {
		ast.Inspect(f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.TypeSpec:
				it, ok := x.Type.(*ast.InterfaceType)
				if !ok {
					return true
				}
				ci := interfaceOf(it)
				ci.name = x.Name.Name
				ifaces[ci.name] = ci
			case *ast.TypeAssertExpr:
				assert(x.Type)
			case *ast.TypeSwitchStmt:
				for _, stmt := range x.Body.List {
					for _, e := range stmt.(*ast.CaseClause).List {
						assert(e)
					}
				}
			}
			return true
		})
	}
	var methodsOf func(name string, seen map[string]bool) []string
	methodsOf = func(name string, seen map[string]bool) []string {
		ci := ifaces[name]
		if ci == nil || seen[name] {
			return nil
		}
		seen[name] = true
		out := append([]string(nil), ci.methods...)
		for _, e := range ci.embedded {
			out = append(out, methodsOf(e, seen)...)
		}
		return out
	}

	dirs, err := os.ReadDir(filepath.Join(root, "platform"))
	if err != nil {
		return nil, nil, err
	}
	var plats []platformCode
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, err := parseGoFiles(filepath.Join(root, "platform", d.Name()))
		if err != nil {
			return nil, nil, err
		}
		if len(files) == 0 {
			continue
		}
		pc := platformCode{name: d.Name(), methods: map[string]bool{}}
		for _, f := range files {
			ast.Inspect(f, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.FuncDecl:
					if x.Recv != nil {
						pc.methods[x.Name.Name] = true
					}
				case *ast.CompositeLit:
					if isCoreMessage(x.Type) {
						for _, el := range x.Elts {
							if kv, ok := el.(*ast.KeyValueExpr); ok {
								if id, ok := kv.Key.(*ast.Ident); ok && id.Name == "Reference" {
									pc.reference = true
								}
							}
						}
					}
				case *ast.AssignStmt:
					for _, l := range x.Lhs {
						if sel, ok := l.(*ast.SelectorExpr); ok && sel.Sel.Name == "Reference" {
							pc.reference = true
						}
					}
				}
				return true
			})
		}
		plats = append(plats, pc)
	}
	sort.Slice(plats, func(i, j int) bool { return plats[i].name < plats[j].name })

	caps := map[string][]string{}
	for name := range asserted {
		if ifaces[name] == nil || name == "Platform" {
			continue
		}
		methods := methodsOf(name, map[string]bool{})
		if len(methods) == 0 {
			continue
		}
		for _, p := range plats {
			if p.implements(methods) {
				caps[name] = methods
				break
			}
		}
	}
	return caps, plats, nil
}

func interfaceOf(it *ast.InterfaceType) *coreInterface {
	ci := &coreInterface{}
	for _, field := range it.Methods.List {
		if _, ok := field.Type.(*ast.FuncType); ok {
			for _, name := range field.Names {
				ci.methods = append(ci.methods, name.Name)
			}
		} else if id, ok := field.Type.(*ast.Ident); ok {
			ci.embedded = append(ci.embedded, id.Name)
		}
	}
	return ci
}

func isCoreMessage(e ast.Expr) bool {
	sel, ok := e.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Message" {
		return false
	}
	id, ok := sel.X.(*ast.Ident)
	return ok && id.Name == "core"
}

// readCapabilityMatrix parses "## <capability>" sections of "- <platform>: 已接" or
// "- <platform>: 不支持：<原因>" lines.
func readCapabilityMatrix(path string) (map[string]map[string]string, []string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	matrix := map[string]map[string]string{}
	var problems []string
	section := ""
	sc := bufio.NewScanner(f)
	for line := 1; sc.Scan(); line++ {
		text := strings.TrimSpace(sc.Text())
		switch {
		case strings.HasPrefix(text, "## "):
			section = strings.TrimSpace(strings.TrimPrefix(text, "## "))
			if matrix[section] != nil {
				problems = append(problems, fmt.Sprintf("%s:%d 能力 %s 写了两次", path, line, section))
			}
			matrix[section] = map[string]string{}
		case strings.HasPrefix(text, "- ") && section != "":
			plat, state, ok := strings.Cut(strings.TrimPrefix(text, "- "), ": ")
			plat, state = strings.TrimSpace(plat), strings.TrimSpace(state)
			if !ok || plat == "" {
				problems = append(problems, fmt.Sprintf("%s:%d 看不懂这一行，格式是「- <平台>: 已接」或「- <平台>: 不支持：<原因>」", path, line))
				continue
			}
			if _, dup := matrix[section][plat]; dup {
				problems = append(problems, fmt.Sprintf("%s:%d %s 的 %s 写了两次", path, line, section, plat))
			}
			matrix[section][plat] = state
		}
	}
	return matrix, problems, sc.Err()
}

// supportedPlatforms are the platforms we support (user 2026-10-30「就支持我们明确支持的」:
// DSH, Discord, 飞书, 自建网页): only their directories under platform/ are checked.
var supportedPlatforms = []string{"cloud-web", "discord", "feishu"}

// platformAliases are supported platforms with no directory of their own: DSH's rooms reach the
// bridge through its collab gateway (dsh/collab/cloudweb.mjs) on platform/cloud-web, so DSH has
// what cloud-web has. They must state the mustState capabilities in the matrix too.
var platformAliases = map[string]string{"dsh": "cloud-web"}

// mustState capabilities may not go into the baseline: every supported platform (aliases too)
// states 已接 or 不支持：<原因> for them in CAPABILITIES.md.
var mustState = map[string]bool{"SentMessageRecorder": true, referenceCapability: true}

const capabilityBaselinePath = "platform/capability_baseline.txt"

// baselineBase is the version of the baseline the current one may only shrink from.
const baselineBase = "origin/develop"

type gap struct{ capability, platform string }

// readCapabilityBaseline reads "<capability> <platform>" lines ("#" starts a comment).
func readCapabilityBaseline(text string) (map[gap]int, []string) {
	out := map[gap]int{}
	var problems []string
	for i, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Fields(line)
		if len(f) != 2 {
			problems = append(problems, fmt.Sprintf("%s:%d 看不懂这一行，格式是「<能力> <平台>」", capabilityBaselinePath, i+1))
			continue
		}
		g := gap{f[0], f[1]}
		if _, dup := out[g]; dup {
			problems = append(problems, fmt.Sprintf("%s:%d %s %s 写了两次", capabilityBaselinePath, i+1, g.capability, g.platform))
		}
		out[g] = i + 1
	}
	return out, problems
}

// baselineAtBase returns the baseline at baselineBase, or ok=false when git or the ref is not
// available (then the "only shrinks" check is skipped).
func baselineAtBase() (string, bool) {
	out, err := exec.Command("git", "show", baselineBase+":./"+capabilityBaselinePath).Output()
	if err != nil {
		return "", false
	}
	return string(out), true
}

func TestPlatformCapabilityParity(t *testing.T) {
	caps, all, err := scanPlatformCapabilities(".")
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]platformCode{}
	for _, p := range all {
		byName[p.name] = p
	}
	var plats []platformCode
	for _, name := range supportedPlatforms {
		p, ok := byName[name]
		if !ok {
			t.Fatalf("支持的平台 %s 在 platform/ 下没有代码", name)
		}
		plats = append(plats, p)
	}
	// A capability counts once a supported platform implements it.
	for name, methods := range caps {
		used := false
		for _, p := range plats {
			used = used || p.implements(methods)
		}
		if !used {
			delete(caps, name)
		}
	}
	matrix, problems, err := readCapabilityMatrix(capabilityMatrixPath)
	if err != nil {
		t.Fatalf("读不了平台能力矩阵 %s：%v", capabilityMatrixPath, err)
	}
	baseText, err := os.ReadFile(capabilityBaselinePath)
	if err != nil {
		t.Fatalf("读不了能力基线 %s：%v", capabilityBaselinePath, err)
	}
	baseline, bp := readCapabilityBaseline(string(baseText))
	problems = append(problems, bp...)

	names := []string{referenceCapability}
	for name := range caps {
		names = append(names, name)
	}
	sort.Strings(names[1:])
	known := map[string]bool{}
	for _, p := range plats {
		known[p.name] = true
	}
	for alias := range platformAliases {
		known[alias] = true
	}
	used := map[gap]bool{}
	for _, name := range names {
		var wired []string
		for _, p := range plats {
			if p.has(name, caps) {
				wired = append(wired, p.name)
			}
		}
		lines := matrix[name]
		check := append([]platformCode(nil), plats...)
		if mustState[name] {
			for alias, dir := range platformAliases {
				pc := byName[dir]
				pc.name = alias
				check = append(check, pc)
			}
		}
		var missing []string
		for _, p := range check {
			state, ok := lines[p.name]
			has := p.has(name, caps)
			g := gap{name, p.name}
			if _, inBase := baseline[g]; inBase {
				used[g] = true
				switch {
				case mustState[name]:
					problems = append(problems, fmt.Sprintf("能力 %s 不许进基线：删掉 %s 里「%s %s」，在 %s 写 %s 已接或不支持原因", name, capabilityBaselinePath, name, p.name, capabilityMatrixPath, p.name))
				case has:
					problems = append(problems, fmt.Sprintf("能力 %s：%s 已经接上了，请删掉 %s 里「%s %s」这一行", name, p.name, capabilityBaselinePath, name, p.name))
				case ok:
					problems = append(problems, fmt.Sprintf("能力 %s：%s 已在 %s 表态，请删掉 %s 里「%s %s」这一行", name, p.name, capabilityMatrixPath, capabilityBaselinePath, name, p.name))
				default:
					continue
				}
			}
			switch {
			case !ok && has && mustState[name]:
				problems = append(problems, fmt.Sprintf("能力 %s：%s 已经接上，请在 %s「## %s」一节写「- %s: %s」", name, p.name, capabilityMatrixPath, name, p.name, capWired))
			case !ok && !has:
				missing = append(missing, p.name)
			case !ok:
			case state == capWired && !has:
				problems = append(problems, fmt.Sprintf("能力 %s：%s 写 %s 已接，代码里 %s 没有实现（%s）。请接上，或改成「不支持：<原因>」", name, capabilityMatrixPath, p.name, p.name, capabilityHint(name, caps)))
			case strings.HasPrefix(state, capUnsupported) && has:
				problems = append(problems, fmt.Sprintf("能力 %s：%s 已经实现了，%s 却写「%s」。请改成「已接」", name, p.name, capabilityMatrixPath, state))
			case strings.HasPrefix(state, capUnsupported) && strings.TrimSpace(strings.TrimPrefix(state, capUnsupported)) == "":
				problems = append(problems, fmt.Sprintf("能力 %s：%s 写了不支持但没写原因", name, p.name))
			case state != capWired && !strings.HasPrefix(state, capUnsupported):
				problems = append(problems, fmt.Sprintf("能力 %s：%s 的状态「%s」只能是「已接」或「不支持：<原因>」", name, p.name, state))
			}
		}
		for plat := range lines {
			if !known[plat] {
				problems = append(problems, fmt.Sprintf("能力 %s：%s 里的平台 %s 不是我们支持的平台（%s）", name, capabilityMatrixPath, plat, strings.Join(supportedPlatforms, "、")))
			}
		}
		if len(missing) > 0 {
			only := "没有平台"
			if len(wired) > 0 {
				only = strings.Join(wired, "、")
			}
			problems = append(problems, fmt.Sprintf("能力 %s 只接了 %s，%s 请接上（%s）或在 %s「## %s」一节写「- <平台>: 不支持：<原因>」",
				name, only, strings.Join(missing, "、"), capabilityHint(name, caps), capabilityMatrixPath, name))
		}
	}
	for name := range matrix {
		if name != referenceCapability && caps[name] == nil {
			problems = append(problems, fmt.Sprintf("%s 里的能力 %s 在 core 里已经没有类型断言或没有平台实现，请删掉这一节", capabilityMatrixPath, name))
		}
	}
	for g, line := range baseline {
		if !used[g] {
			problems = append(problems, fmt.Sprintf("%s:%d「%s %s」是死行（能力或平台已不存在），请删掉", capabilityBaselinePath, line, g.capability, g.platform))
		}
	}
	// The baseline only shrinks: a line not in baselineBase's version is a new gap let through.
	if old, ok := baselineAtBase(); ok {
		prev, _ := readCapabilityBaseline(old)
		for g, line := range baseline {
			if _, was := prev[g]; !was {
				problems = append(problems, fmt.Sprintf("%s:%d「%s %s」是新加的缺口。基线只许删行：能力 %s 请给 %s 接上，或在 %s 写不支持原因", capabilityBaselinePath, line, g.capability, g.platform, g.capability, g.platform, capabilityMatrixPath))
			}
		}
	} else {
		t.Logf("取不到 %s 的 %s，跳过「基线只许变少」这一项", baselineBase, capabilityBaselinePath)
	}
	sort.Strings(problems)
	for _, p := range problems {
		t.Error(p)
	}
}

func capabilityHint(name string, caps map[string][]string) string {
	if name == referenceCapability {
		return "入站解析回复时给 core.Message.Reference 赋值"
	}
	return "要实现的方法：" + strings.Join(caps[name], "、")
}
