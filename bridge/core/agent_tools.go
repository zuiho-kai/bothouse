package core

// Agent tools: the small command-line tools in bridge/contrib/tools (peek, watchvid, websearch), installed into
// <data_dir>/tools. A role gets them by a marked block in its persona that says what each tool is for and the
// exact command to run it; the agent runs them with its own shell tool, so every CLI can use them. Same layout as
// the agent hooks (contrib/hooks): scripts plus rules/<name>.<zh|en>.md snippets, embedded by package ccconnect.
// The scripts are uv scripts (PEP 723): `uv run --script` installs their Python dependencies on first use.

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"strings"
)

// AgentToolFS holds bridge/contrib/tools, embedded by package ccconnect and set by main. nil (tests, library
// users) = the tools cannot be installed.
var AgentToolFS fs.FS

// agentTools are the tools, in the order their lines are written.
var agentTools = []string{"peek", "watchvid", "websearch"}

// AgentToolNames lists every tool.
func AgentToolNames() []string { return slices.Clone(agentTools) }

// AgentToolsDir is where the scripts are installed.
func AgentToolsDir(dataDir string) string { return filepath.Join(dataDir, "tools") }

// InstallAgentTools writes the embedded scripts and rule snippets into AgentToolsDir (replacing older copies;
// anything else in that directory is left alone). Tests (test_*.py) are not installed.
func InstallAgentTools(dataDir string) (string, error) {
	if AgentToolFS == nil {
		return "", errors.New("the tools are not built into this binary")
	}
	dir := AgentToolsDir(dataDir)
	if err := os.MkdirAll(filepath.Join(dir, "rules"), 0o755); err != nil {
		return "", err
	}
	n := 0
	err := fs.WalkDir(AgentToolFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		base := path.Base(p)
		if strings.HasPrefix(base, "test_") || !(strings.HasSuffix(base, ".py") || strings.HasSuffix(base, ".md")) {
			return nil
		}
		dst := filepath.Join(dir, base)
		if path.Base(path.Dir(p)) == "rules" {
			dst = filepath.Join(dir, "rules", base)
		}
		b, err := fs.ReadFile(AgentToolFS, p)
		if err != nil {
			return err
		}
		n++
		return AtomicWriteFile(dst, b, 0o755)
	})
	if err == nil && n == 0 {
		err = errors.New("no tools are built into this binary")
	}
	return dir, err
}

// FindUV returns the absolute path of uv, which runs the tools; "" when it is not on PATH.
func FindUV() string {
	p, err := exec.LookPath("uv")
	if err != nil {
		return ""
	}
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	return p
}

// AgentToolOptions says which role and which tools.
type AgentToolOptions struct {
	DataDir   string   // cc-connect data_dir: scripts go to <data_dir>/tools
	WorkDir   string   // the role's work_dir
	AgentType string   // the role's agent type (claudecode, codex, acp, …): picks the persona file (PersonaFilePath)
	Lang      string   // language of the persona block (zh* = Chinese, else English); "" = the persona's reply language, else system
	Only      []string // tools to switch on/off; empty = all
}

// AgentToolResult is what was written.
type AgentToolResult struct {
	Enabled     []string `json:"enabled"`
	ToolsDir    string   `json:"tools_dir,omitempty"`
	PersonaFile string   `json:"persona_file"`
	UV          string   `json:"uv,omitempty"`
	Warnings    []string `json:"warnings,omitempty"`
}

func (o AgentToolOptions) names() ([]string, error) {
	if len(o.Only) == 0 {
		return AgentToolNames(), nil
	}
	var out []string
	for _, n := range o.Only {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if !slices.Contains(agentTools, n) {
			return nil, fmt.Errorf("unknown tool %q (tools: %s)", n, strings.Join(agentTools, ", "))
		}
		out = append(out, n)
	}
	return out, nil
}

// toolWarnings: what the tools need and this machine lacks (they still get installed; the tool says it again).
func toolWarnings(uv string, enabled []string) []string {
	var w []string
	if uv == "" {
		w = append(w, "uv not found on PATH: the tools run with `uv run --script`; install it from https://docs.astral.sh/uv/getting-started/installation/")
	}
	if slices.Contains(enabled, "watchvid") {
		if _, err := exec.LookPath("ffmpeg"); err != nil {
			w = append(w, "ffmpeg not found on PATH: watchvid needs ffmpeg and ffprobe (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg; Windows: winget install Gyan.FFmpeg)")
		}
	}
	return w
}

// EnableAgentTools installs the scripts and adds the tools to one role's persona block.
func EnableAgentTools(o AgentToolOptions) (*AgentToolResult, error) {
	if o.WorkDir == "" {
		return nil, errors.New("work_dir is empty")
	}
	names, err := o.names()
	if err != nil {
		return nil, err
	}
	dir, err := InstallAgentTools(o.DataDir)
	if err != nil {
		return nil, err
	}
	persona := PersonaFilePath(o.AgentType, o.WorkDir)
	on, err := AgentToolsEnabled(persona)
	if err != nil {
		return nil, err
	}
	for _, n := range names {
		if !slices.Contains(on, n) {
			on = append(on, n)
		}
	}
	uv := FindUV()
	if err := writeToolRules(persona, o.Lang, on, uv, dir); err != nil {
		return nil, err
	}
	res := &AgentToolResult{ToolsDir: dir, PersonaFile: persona, UV: uv}
	if res.Enabled, err = AgentToolsEnabled(persona); err != nil {
		return nil, err
	}
	res.Warnings = toolWarnings(uv, res.Enabled)
	return res, nil
}

// DisableAgentTools takes tools out of one role's persona block (all of them when Only is empty); with none left
// the block is removed. The installed scripts stay (other roles use them).
func DisableAgentTools(o AgentToolOptions) (*AgentToolResult, error) {
	if o.WorkDir == "" {
		return nil, errors.New("work_dir is empty")
	}
	names, err := o.names()
	if err != nil {
		return nil, err
	}
	persona := PersonaFilePath(o.AgentType, o.WorkDir)
	on, err := AgentToolsEnabled(persona)
	if err != nil {
		return nil, err
	}
	on = slices.DeleteFunc(on, func(n string) bool { return slices.Contains(names, n) })
	if err := writeToolRules(persona, o.Lang, on, FindUV(), AgentToolsDir(o.DataDir)); err != nil {
		return nil, err
	}
	res := &AgentToolResult{PersonaFile: persona}
	res.Enabled, err = AgentToolsEnabled(persona)
	return res, err
}

// AgentToolsEnabled lists the tools named in the persona's tools block (none when it has no block).
func AgentToolsEnabled(persona string) ([]string, error) {
	b, err := os.ReadFile(persona)
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	block, ok := markedBlock(string(b), toolRulesBegin, toolRulesEnd)
	out := []string{}
	if !ok {
		return out, nil
	}
	for _, n := range agentTools {
		if strings.Contains(block, n+".py") {
			out = append(out, n)
		}
	}
	return out, nil
}

// ── persona block ──────────────────────────────────────────────

const toolRulesBegin, toolRulesEnd = "<!-- conest:tools -->", "<!-- /conest:tools -->"

// ToolRules is the persona block for the enabled tools ("" for none), from rules/<name>.<zh|en>.md.
func ToolRules(lang string, enabled []string, uv, toolsDir string) string {
	if len(enabled) == 0 || AgentToolFS == nil {
		return ""
	}
	l := "en"
	if isZH(lang) {
		l = "zh"
	}
	read := func(name string) string {
		b, err := fs.ReadFile(AgentToolFS, "contrib/tools/rules/"+name+"."+l+".md")
		if err != nil {
			return ""
		}
		return strings.TrimRight(string(b), "\n")
	}
	parts := []string{read("_head")}
	for _, n := range agentTools { // fixed order, whatever order they were switched on in
		if slices.Contains(enabled, n) {
			if s := read(n); s != "" {
				parts = append(parts, s)
			}
		}
	}
	if uv == "" {
		uv = "uv"
	}
	return strings.NewReplacer("{{TOOLS}}", toolsDir, "{{UV}}", uv).Replace(strings.Join(parts, "\n"))
}

// WithToolRules puts block between the tools markers (replacing an older block), or removes the block when it
// is "". Everything outside the markers is kept.
func WithToolRules(persona, block string) string {
	return withMarkedBlock(persona, toolRulesBegin, toolRulesEnd, block)
}

func writeToolRules(persona, lang string, enabled []string, uv, dir string) error {
	b, err := os.ReadFile(persona)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if lang == "" {
		lang, _ = PersonaReplyLanguage(string(b))
	}
	if lang == "" {
		lang = SystemLanguage()
	}
	out := WithToolRules(string(b), ToolRules(lang, enabled, uv, dir))
	if out == string(b) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(persona), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(persona, []byte(out), 0o644)
}

// markedBlock returns the text between begin and end (a missing end = to the end of the file).
func markedBlock(persona, begin, end string) (string, bool) {
	i := strings.Index(persona, begin)
	if i < 0 {
		return "", false
	}
	rest := persona[i+len(begin):]
	if j := strings.Index(rest, end); j >= 0 {
		rest = rest[:j]
	}
	return rest, true
}

// withMarkedBlock replaces the begin…end block in persona with block (removing it when block is ""), or appends
// it after a blank line. Text outside the markers and the file's line endings are kept.
func withMarkedBlock(persona, begin, end, block string) string {
	eol := "\n"
	if strings.Contains(persona, "\r\n") {
		eol = "\r\n"
	}
	if i := strings.Index(persona, begin); i >= 0 {
		rest := persona[i:]
		stop := len(rest)
		if j := strings.Index(rest, end); j >= 0 {
			stop = j + len(end)
		}
		after := strings.TrimLeft(rest[stop:], "\r\n")
		before := strings.TrimRight(persona[:i], "\r\n")
		persona = before
		if after != "" {
			if persona != "" {
				persona += eol + eol
			}
			persona += after
		} else if persona != "" {
			persona += eol
		}
	}
	if block == "" {
		return persona
	}
	persona = strings.TrimRight(persona, "\r\n")
	if persona != "" {
		persona += eol + eol
	}
	block = strings.ReplaceAll(block, "\n", eol)
	return persona + begin + eol + block + eol + end + eol
}
