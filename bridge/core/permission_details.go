package core

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const MsgPermissionDetails MsgKey = "permission_details"

// Approval evidence must not inherit the progress display's truncation setting.
func (e *Engine) sendEventPermissionPrompt(p Platform, replyCtx any, pending *pendingPermission, event Event, workspace string) {
	if workspace == "" {
		if wd, ok := e.agent.(WorkDirSwitcher); ok {
			workspace = wd.GetWorkDir()
		}
	}
	details := permissionRequestDetails(event, workspace)
	preview := details
	if utf8.RuneCountInString(details) > 1000 || strings.Contains(details, "\nScript snapshot:") {
		preview = truncateIf(event.ToolInput, 700) + "\n\n" + e.i18n.T(MsgPermissionDetails)
		delivered := false
		if fs, ok := p.(FileSender); ok {
			if err := e.waitOutgoing(p); err != nil {
				return
			}
			err := fs.SendFile(e.ctx, replyCtx, FileAttachment{FileName: "permission-" + pending.ApprovalID + ".txt", MimeType: "text/plain; charset=utf-8", Data: []byte(details)})
			delivered = err == nil
			if err != nil {
				slog.Warn("permission attachment failed; sending full details as text", "error", err)
			}
		}
		if !delivered {
			// Keep all bytes available on platforms without attachments or if upload fails.
			for _, chunk := range SplitMessageCodeFenceAware(details, maxPlatformMessageLen) {
				e.send(p, replyCtx, chunk)
			}
		}
	}
	prompt := fmt.Sprintf(e.i18n.T(MsgPermissionPrompt), event.ToolName, preview)
	e.sendPermissionPrompt(p, replyCtx, e.delegatedPermissionPrompt(p, pending, prompt), event.ToolName, preview)
}

func permissionCommand(raw map[string]any) string {
	for _, key := range []string{"command", "cmd"} {
		switch value := raw[key].(type) {
		case string:
			return value
		case []any:
			var words []string
			for _, word := range value {
				text, ok := word.(string)
				if !ok {
					return ""
				}
				words = append(words, text)
			}
			return strings.Join(words, " ")
		}
	}
	if call, ok := raw["toolCall"].(map[string]any); ok {
		if input, ok := call["rawInput"].(map[string]any); ok {
			return permissionCommand(input)
		}
	}
	return ""
}

func permissionRequestDetails(event Event, workspace string) string {
	var out strings.Builder
	fmt.Fprintf(&out, "Tool: %s\nRequest: %s\n\n%s", event.ToolName, event.RequestID, event.ToolInput)
	if len(event.ToolInputRaw) > 0 {
		if data, err := json.MarshalIndent(event.ToolInputRaw, "", "  "); err == nil {
			out.WriteString("\n\nRaw input:\n")
			out.Write(data)
		}
	}
	for _, key := range []string{"cwd", "workdir", "work_dir"} {
		if dir, ok := event.ToolInputRaw[key].(string); ok && filepath.IsAbs(dir) {
			workspace = dir
			break
		}
	}
	command := permissionCommand(event.ToolInputRaw)
	if command == "" {
		command = event.ToolInput
	}
	for _, path := range permissionScriptPaths(command) {
		resolved := path
		if !filepath.IsAbs(resolved) {
			if workspace == "" {
				fmt.Fprintf(&out, "\nScript snapshot: %s\nUnavailable: working directory unknown.\n", path)
				continue
			}
			resolved = filepath.Join(workspace, path)
		}
		fmt.Fprintf(&out, "\nScript snapshot: %s\n", resolved)
		// Do not open pipes/devices, follow symlinks, or execute the script.
		info, err := os.Lstat(resolved)
		if err != nil || !info.Mode().IsRegular() {
			out.WriteString("Unavailable: missing or non-regular file.\n")
			continue
		}
		file, err := os.Open(resolved)
		if err != nil {
			out.WriteString("Unavailable: cannot read file.\n")
			continue
		}
		data, err := io.ReadAll(io.LimitReader(file, 8193))
		file.Close()
		if err != nil {
			out.WriteString("Unavailable: cannot read file.\n")
			continue
		}
		fmt.Fprintf(&out, "Size: %d bytes. Snapshot at approval time; not an execution-time guarantee.\n", info.Size())
		if len(data) > 8192 {
			out.WriteString("Excerpt: first 8192 bytes (remaining content omitted).\n")
			data = data[:8192]
		} else {
			fmt.Fprintf(&out, "SHA256: %x\n", sha256.Sum256(data))
		}
		if !utf8.Valid(data) {
			out.WriteString("Binary or non-UTF8 script; content not displayed.\n")
			continue
		}
		out.Write(data)
		out.WriteByte('\n')
	}
	return out.String()
}

var permissionShellWords = regexp.MustCompile(`[^\s"';&|<>]+|"[^"]*"|'[^']*'`)

// Inspect explicit script paths and interpreter script arguments only. Dynamic
// shell expansion is not evaluated; missing/indirect scripts stay reviewable.
func permissionScriptPaths(command string) []string {
	words := permissionShellWords.FindAllString(command, -1)
	seen := map[string]bool{}
	var paths []string
	interpreter := false
	for _, word := range words {
		word = strings.Trim(word, "\"'")
		if strings.ContainsAny(word, "$`\n\r") {
			interpreter = false
			continue
		}
		base := filepath.Base(word)
		switch base {
		case "bash", "sh", "zsh", "python", "python3", "node", "ruby", "perl", "pwsh", "powershell", "source", ".":
			interpreter = true
			continue
		}
		if interpreter && strings.HasPrefix(word, "-") {
			// Inline programs/module execution have no directly referenced script.
			if word == "-c" || word == "-m" || word == "-e" || word == "-Command" {
				interpreter = false
			}
			continue
		}
		ext := strings.ToLower(filepath.Ext(word))
		isScript := ext == ".sh" || ext == ".py" || ext == ".js" || ext == ".mjs" || ext == ".rb" || ext == ".pl" || ext == ".ps1"
		if (interpreter || isScript) && !strings.HasPrefix(word, "-") && !seen[word] {
			seen[word] = true
			paths = append(paths, word)
			if len(paths) == 8 {
				break
			}
		}
		interpreter = false
	}
	return paths
}
