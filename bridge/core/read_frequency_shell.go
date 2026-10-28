package core

import (
	"encoding/json"
	"path/filepath"
	"strings"
)

// readPathsFromTool extracts file paths from a tool name and its serialized
// input. events.jsonl stores the summarized tool input in StreamEvent.Text;
// Claude Code stores the raw tool_use input as JSON.
func readPathsFromTool(tool, input string) []string {
	name := strings.ToLower(strings.TrimSpace(tool))
	switch {
	case readFrequencyToolHasPrefix(name, "read", "notebookread", "readfile", "view"):
		return readPathsFromReadInput(input)
	case readFrequencyToolHasPrefix(name, "bash", "shell", "terminal", "execute", "exec", "run", "command"):
		command := input
		if parsed, ok := readCommandFromJSON(input); ok {
			command = parsed
		}
		return readPathsFromShellCommand(stripLeadingCommentLines(command))
	case readFrequencyToolHasPrefix(name, "write", "edit", "multiedit", "patch", "applypatch"):
		return nil
	default:
		// Unknown tools: only trust an explicit command, not file_path,
		// because file_path may belong to a write/edit tool.
		if command, ok := readCommandFromJSON(input); ok {
			return readPathsFromShellCommand(stripLeadingCommentLines(command))
		}
		return nil
	}
}

// readFrequencyToolHasPrefix accepts both exact tool names ("Read") and ACP
// titles ("Read file", "Run command") without matching unrelated words.
func readFrequencyToolHasPrefix(name string, prefixes ...string) bool {
	for _, prefix := range prefixes {
		if name == prefix ||
			strings.HasPrefix(name, prefix+" ") ||
			strings.HasPrefix(name, prefix+"_") ||
			strings.HasPrefix(name, prefix+":") ||
			strings.HasPrefix(name, prefix+"/") {
			return true
		}
	}
	return false
}

func readPathsFromReadInput(input string) []string {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil
	}
	if strings.HasPrefix(input, "{") {
		if path, ok := readPathFromJSON(input); ok {
			return []string{path}
		}
		return nil
	}
	lower := strings.ToLower(input)
	for _, prefix := range []string{"read file: ", "read file ", "read: ", "read "} {
		if strings.HasPrefix(lower, prefix) {
			input = strings.TrimSpace(input[len(prefix):])
			lower = strings.ToLower(input)
			break
		}
	}
	switch lower {
	case "", "read", "read file", "notebookread", "view":
		return nil
	}
	return []string{strings.Trim(input, `"'`)}
}

func readPathFromJSON(input string) (string, bool) {
	var object map[string]any
	if json.Unmarshal([]byte(input), &object) != nil {
		return "", false
	}
	for _, key := range []string{"file_path", "path", "notebook_path", "file", "filename"} {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), true
		}
	}
	return "", false
}

func readCommandFromJSON(input string) (string, bool) {
	var object map[string]any
	if json.Unmarshal([]byte(input), &object) != nil {
		return "", false
	}
	if command, ok := object["command"].(string); ok && strings.TrimSpace(command) != "" {
		return command, true
	}
	return "", false
}

func stripLeadingCommentLines(command string) string {
	lines := strings.Split(command, "\n")
	for len(lines) > 0 {
		line := strings.TrimSpace(lines[0])
		if line == "" || strings.HasPrefix(line, "#") {
			lines = lines[1:]
			continue
		}
		break
	}
	return strings.Join(lines, "\n")
}

// readPathsFromShellCommand recognizes the read-only commands that commonly
// appear in Bash tool calls. It deliberately ignores search commands such as
// grep/rg: those inspect files but do not read whole files into context.
func readPathsFromShellCommand(command string) []string {
	seen := map[string]bool{}
	var out []string
	for _, segment := range splitShellSegments(command) {
		words := splitShellWords(segment)
		if len(words) == 0 {
			continue
		}
		i := 0
		for i < len(words) {
			word := words[i]
			if word == "sudo" || word == "command" || word == "env" || isShellAssignment(word) {
				i++
				continue
			}
			break
		}
		if i >= len(words) {
			continue
		}
		name := strings.ToLower(filepath.Base(words[i]))
		var paths []string
		switch name {
		case "cat", "head", "tail", "less", "more", "bat", "batcat":
			paths = readPathsFromSimpleArgs(name, words[i+1:])
		case "sed":
			paths = readPathsFromSedArgs(words[i+1:])
		}
		for _, path := range paths {
			if !seen[path] {
				seen[path] = true
				out = append(out, path)
			}
		}
	}
	return out
}

func isShellAssignment(word string) bool {
	return strings.Contains(word, "=") && !strings.HasPrefix(word, "-")
}

func readPathsFromSimpleArgs(command string, args []string) []string {
	var out []string
	skipNext := false
	for _, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--" {
			continue
		}
		if arg == ">" || arg == ">>" || arg == "<" || arg == "<<" || arg == "2>" || arg == "2>>" {
			skipNext = true
			continue
		}
		if strings.HasPrefix(arg, "-") {
			if readCommandFlagTakesValue(command, arg) {
				skipNext = true
			}
			continue
		}
		if (command == "less" || command == "more") && strings.HasPrefix(arg, "+") {
			continue
		}
		if readCommandPathLike(arg) {
			out = append(out, arg)
		}
	}
	return out
}

func readPathsFromSedArgs(args []string) []string {
	var out []string
	scriptSeen := false
	skipNext := false
	for _, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--" {
			continue
		}
		if strings.HasPrefix(arg, "--") {
			switch {
			case arg == "--expression" || arg == "--file":
				scriptSeen = true
				skipNext = true
			case strings.HasPrefix(arg, "--expression=") || strings.HasPrefix(arg, "--file="):
				scriptSeen = true
			}
			continue
		}
		if strings.HasPrefix(arg, "-") && arg != "-" {
			// An explicit script (-e/-f) means the next positional argument is
			// an input file, not the positional script. Short options may be
			// bundled ("-ne") or carry the value ("-e1,2p").
			cluster := arg[1:]
			for i := 0; i < len(cluster); i++ {
				if cluster[i] != 'e' && cluster[i] != 'f' {
					continue
				}
				scriptSeen = true
				if i == len(cluster)-1 {
					skipNext = true
				}
				break
			}
			continue
		}
		if !scriptSeen {
			scriptSeen = true
			continue
		}
		if readCommandPathLike(arg) {
			out = append(out, arg)
		}
	}
	return out
}

func readCommandFlagTakesValue(command, flag string) bool {
	switch command {
	case "head", "tail":
		switch flag {
		case "-n", "-c", "--lines", "--bytes":
			return true
		}
	case "bat", "batcat":
		switch flag {
		case "-l", "--language", "-t", "--theme", "--style", "-r", "--range", "--terminal-width":
			return true
		}
	}
	return false
}

func readCommandPathLike(arg string) bool {
	if arg == "" || strings.HasPrefix(arg, "-") {
		return false
	}
	if strings.ContainsAny(arg, "<>") || strings.Contains(arg, "://") {
		return false
	}
	for _, prefix := range []string{"/dev/", "/proc/", "/sys/"} {
		if strings.HasPrefix(arg, prefix) {
			return false
		}
	}
	return true
}

func splitShellSegments(command string) []string {
	var out []string
	var b strings.Builder
	var quote rune
	escaped := false
	runes := []rune(command)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if escaped {
			b.WriteRune(r)
			escaped = false
			continue
		}
		if quote != 0 {
			b.WriteRune(r)
			if r == quote {
				quote = 0
			}
			continue
		}
		switch r {
		case '\'', '"':
			quote = r
			b.WriteRune(r)
		case '\\':
			escaped = true
			b.WriteRune(r)
		case ';', '|', '\n':
			if r == '|' && i+1 < len(runes) && runes[i+1] == '|' {
				i++
			}
			out = append(out, b.String())
			b.Reset()
		case '&':
			if i+1 < len(runes) && runes[i+1] == '&' {
				i++
				out = append(out, b.String())
				b.Reset()
			} else {
				b.WriteRune(r)
			}
		default:
			b.WriteRune(r)
		}
	}
	out = append(out, b.String())
	return out
}

func splitShellWords(command string) []string {
	var out []string
	var b strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if b.Len() > 0 {
			out = append(out, b.String())
			b.Reset()
		}
	}
	for _, r := range command {
		if escaped {
			b.WriteRune(r)
			escaped = false
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
				continue
			}
			if r == '\\' && quote == '"' {
				escaped = true
				continue
			}
			b.WriteRune(r)
			continue
		}
		switch r {
		case '\'', '"':
			quote = r
		case '\\':
			escaped = true
		case ' ', '\t', '\r':
			flush()
		default:
			b.WriteRune(r)
		}
	}
	flush()
	return out
}
