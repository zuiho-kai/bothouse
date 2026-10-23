package core

import (
	"bytes"
	"fmt"
	"github.com/BurntSushi/toml"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// Kimi Code supports KIMI_CODE_HOME, not a documented project config layer.
// Keep config, login and runtime state inside this role; never mutate the user's home.
func KimiHookHome(workDir string) string {
	p, _ := filepath.Abs(filepath.Join(workDir, ".bothouse", "kimi-home"))
	return p
}
func KimiHookConfigPath(workDir string) string {
	return filepath.Join(KimiHookHome(workDir), "config.toml")
}
func KimiHookHomeIfPresent(workDir string) string {
	_, rules, err := readKimiHooks(workDir)
	if err != nil {
		return ""
	}
	for _, rule := range rules {
		cmd, _ := rule["command"].(string)
		if ourHook(cmd) == "bash-guard" && !slices.Contains(AgentHooksSwitchedOff(workDir), "bash-guard") {
			return KimiHookHome(workDir)
		}
	}
	return ""
}
func readKimiHooks(workDir string) (map[string]any, []map[string]any, error) {
	c := map[string]any{}
	b, e := os.ReadFile(KimiHookConfigPath(workDir))
	if os.IsNotExist(e) {
		return c, nil, nil
	}
	if e != nil {
		return nil, nil, e
	}
	if _, e = toml.Decode(string(b), &c); e != nil {
		return nil, nil, fmt.Errorf("Kimi config unchanged: %w", e)
	}
	var rules []map[string]any
	switch v := c["hooks"].(type) {
	case []map[string]any:
		rules = v
	case []any:
		for _, x := range v {
			m, ok := x.(map[string]any)
			if !ok {
				return nil, nil, fmt.Errorf("invalid Kimi hook rule")
			}
			rules = append(rules, m)
		}
	case nil:
	default:
		return nil, nil, fmt.Errorf("Kimi hooks must be a TOML array of tables")
	}
	return c, rules, nil
}

// kimiHookSections returns the byte ranges for each top-level [[hooks]] block.
// It tracks TOML strings so bracket-looking text inside multiline strings is
// never interpreted as a table. Decoding each block validates the ownership
// scan before a caller edits it.
func kimiHookSections(raw []byte) ([][2]int, error) {
	var sections [][2]int
	start := -1
	inBasic, inLiteral := false, false
	lineStart := 0
	for lineStart < len(raw) {
		lineEnd := bytes.IndexByte(raw[lineStart:], '\n')
		if lineEnd < 0 {
			lineEnd = len(raw)
		} else {
			lineEnd += lineStart
		}
		line := raw[lineStart:lineEnd]
		trimmed := bytes.TrimSpace(line)
		if !inBasic && !inLiteral && bytes.HasPrefix(trimmed, []byte("[")) {
			var table map[string]any
			if _, err := toml.Decode(string(append(append([]byte{}, trimmed...), '\n')), &table); err == nil {
				hooks, isHooks := table["hooks"]
				_, array := hooks.([]map[string]any)
				if _, ok := hooks.([]any); ok {
					array = true
				}
				if start >= 0 && (!isHooks || array) {
					sections = append(sections, [2]int{start, lineStart})
					start = -1
				}
				if isHooks && array {
					start = lineStart
				}
			}
		}

		for i := 0; i < len(line); {
			if !inBasic && !inLiteral && line[i] == '#' {
				break
			}
			if !inLiteral && i+2 < len(line) && bytes.Equal(line[i:i+3], []byte(`"""`)) {
				inBasic = !inBasic
				i += 3
				continue
			}
			if !inBasic && i+2 < len(line) && bytes.Equal(line[i:i+3], []byte("'''")) {
				inLiteral = !inLiteral
				i += 3
				continue
			}
			if inBasic && line[i] == '\\' {
				i += 2
				continue
			}
			if !inBasic && !inLiteral && (line[i] == '"' || line[i] == '\'') {
				quote := line[i]
				i++
				for i < len(line) {
					if quote == '"' && line[i] == '\\' {
						i += 2
						continue
					}
					if line[i] == quote {
						i++
						break
					}
					i++
				}
				continue
			}
			i++
		}
		lineStart = lineEnd + 1
	}
	if start >= 0 {
		sections = append(sections, [2]int{start, len(raw)})
	}
	return sections, nil
}

func rewriteKimiHookText(raw []byte, enabled bool, hookCommand string) ([]byte, error) {
	var config map[string]any
	if _, err := toml.Decode(string(raw), &config); err != nil {
		return nil, fmt.Errorf("Kimi config unchanged: %w", err)
	}
	sections, err := kimiHookSections(raw)
	if err != nil {
		return nil, err
	}
	_, rules, err := readKimiHooksFromBytes(raw)
	if err != nil {
		return nil, err
	}
	managed := 0
	for _, rule := range rules {
		cmd, _ := rule["command"].(string)
		if ourHook(cmd) != "" {
			managed++
		}
	}
	owned := [][2]int{}
	for _, section := range sections {
		_, list, err := readKimiHooksFromBytes(raw[section[0]:section[1]])
		if err != nil {
			return nil, err
		}
		if len(list) != 1 {
			continue
		}
		cmd, _ := list[0]["command"].(string)
		if ourHook(cmd) != "" {
			owned = append(owned, section)
		}
	}
	if len(owned) != managed {
		return nil, fmt.Errorf("Kimi hooks unchanged: could not safely locate all managed hook entries")
	}
	var out bytes.Buffer
	cursor := 0
	for _, section := range owned {
		begin, end := section[0], section[1]
		marker := []byte("\n# bothouse managed hook begin\n")
		if begin >= len(marker) && bytes.Equal(raw[begin-len(marker):begin], marker) {
			begin -= len(marker)
			endMarker := []byte("# bothouse managed hook end\n")
			if n := bytes.Index(raw[section[0]:end], endMarker); n >= 0 {
				end = section[0] + n + len(endMarker)
			} else {
				return nil, fmt.Errorf("Kimi managed hook end marker missing")
			}
			out.Write(raw[cursor:begin])
		} else {
			out.Write(raw[cursor:begin])
			// Preserve comments and blank lines in legacy unmarked managed blocks.
			for _, line := range bytes.SplitAfter(raw[begin:end], []byte("\n")) {
				trimmed := bytes.TrimSpace(line)
				if len(trimmed) == 0 || bytes.HasPrefix(trimmed, []byte("#")) {
					out.Write(line)
				}
			}
		}
		cursor = end
	}
	out.Write(raw[cursor:])
	result := out.Bytes()
	if enabled {
		entry := "\n# bothouse managed hook begin\n[[hooks]]\nevent = \"PreToolUse\"\nmatcher = \"Bash|bash\"\ncommand = " +
			strconv.Quote(hookCommand) + "\ntimeout = 10\n# bothouse managed hook end\n"
		result = append(result, []byte(entry)...)
	}
	return result, nil
}

func readKimiHooksFromBytes(raw []byte) (map[string]any, []map[string]any, error) {
	c := map[string]any{}
	if _, err := toml.Decode(string(raw), &c); err != nil {
		return nil, nil, err
	}
	var rules []map[string]any
	switch v := c["hooks"].(type) {
	case []map[string]any:
		rules = v
	case []any:
		for _, x := range v {
			m, ok := x.(map[string]any)
			if !ok {
				return nil, nil, fmt.Errorf("invalid Kimi hook rule")
			}
			rules = append(rules, m)
		}
	case nil:
	default:
		return nil, nil, fmt.Errorf("Kimi hooks must be a TOML array of tables")
	}
	return c, rules, nil
}
func KimiHooksStatus(workDir string) (*AgentHookResult, error) {
	_, rules, e := readKimiHooks(workDir)
	if e != nil {
		return nil, e
	}
	r := &AgentHookResult{SettingsFile: KimiHookConfigPath(workDir), PersonaFile: filepath.Join(workDir, "AGENTS.md"), Enabled: []string{}}
	for _, h := range rules {
		cmd, _ := h["command"].(string)
		if ourHook(cmd) == "bash-guard" {
			r.Enabled = []string{"bash-guard"}
			break
		}
	}
	return r, nil
}
func setKimiHooks(o AgentHookOptions, on bool) (*AgentHookResult, error) {
	if o.WorkDir == "" {
		return nil, fmt.Errorf("work_dir is empty")
	}
	for _, n := range o.Only {
		if n != "bash-guard" {
			return nil, fmt.Errorf("Kimi hook %q not adapted; only bash-guard is verified", n)
		}
	}
	_, _, e := readKimiHooks(o.WorkDir)
	if e != nil {
		return nil, e
	}
	python, e := FindPython()
	if e != nil {
		return nil, e
	}
	dir := AgentHooksDir(o.DataDir)
	if on {
		dir, e = InstallAgentHookScripts(o.DataDir)
		if e != nil {
			return nil, e
		}
	}
	raw, e := os.ReadFile(KimiHookConfigPath(o.WorkDir))
	if os.IsNotExist(e) {
		raw, e = nil, nil
	}
	if e != nil {
		return nil, e
	}
	raw, e = rewriteKimiHookText(raw, on, agentHookCommand(python, dir, "bash-guard", "--role", o.WorkDir, "--kimi"))
	if e != nil {
		return nil, e
	}
	path := KimiHookConfigPath(o.WorkDir)
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	if e = AtomicWriteFile(path, raw, 0600); e != nil {
		return nil, e
	}
	res, e := KimiHooksStatus(o.WorkDir)
	if e != nil {
		return nil, e
	}
	res.HooksDir = dir
	if on {
		res.Warnings = []string{"Kimi role configuration is stored in its own directory; configure a model or sign in there separately."}
		if isZH(o.Lang) {
			res.Warnings[0] = "Kimi 角色使用独立配置目录；请在该目录单独配置模型或登录。"
		}
	}
	if e = writeHookRules(res.PersonaFile, o.Lang, res.Enabled, python, dir, o.WorkDir); e != nil {
		return nil, e
	}
	if e = writeKimiConfigNote(res.PersonaFile, o.Lang, on); e != nil {
		return nil, e
	}
	return res, nil
}

const kimiNoteBegin, kimiNoteEnd = "<!-- conest:kimi-config -->", "<!-- /conest:kimi-config -->"

func writeKimiConfigNote(path, lang string, enabled bool) error {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		raw, err = nil, nil
	}
	if err != nil {
		return err
	}
	text := string(raw)
	start := strings.Index(text, kimiNoteBegin)
	if start >= 0 {
		end := strings.Index(text[start+len(kimiNoteBegin):], kimiNoteEnd)
		if end >= 0 {
			end += start + len(kimiNoteBegin) + len(kimiNoteEnd)
			text = strings.TrimRight(text[:start], "\n") + text[end:]
		}
	}
	if enabled {
		note := "Configure a model or sign in in this role's Kimi configuration directory."
		if isZH(lang) {
			note = "请在此角色的 Kimi 独立配置目录中配置模型或登录。"
		}
		text = strings.TrimRight(text, "\n") + "\n\n" + kimiNoteBegin + "\n" + note + "\n" + kimiNoteEnd + "\n"
	}
	return AtomicWriteFile(path, []byte(text), 0600)
}
