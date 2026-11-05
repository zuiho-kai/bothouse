package core

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Windows cannot run the lead scripts by name: they have no extension, the python ones say
// `python3` (on a stock Windows that is the Microsoft Store stub) and later / t10 / safe-restart
// are /bin/sh. Next to each script a <name>.cmd is written that a role's PowerShell, cmd or Git Bash
// finds on PATH: python scripts run through the product Python by absolute path; sh scripts run
// through Git Bash with `python3` bound to that same Python; zsh ones say they need a Mac.

// leadShimPython: the product Python, else a real (non-stub) Python on PATH, else "python".
func leadShimPython() string {
	if p := lastProductPython(); p != "" {
		return p
	}
	if p, err := FindPython(); err == nil {
		return p
	}
	return "python"
}

// leadShim is the .cmd body for the lead script at bin (nil: not a script to wrap).
func leadShim(bin, py, bash string) []byte {
	f, err := os.Open(bin)
	if err != nil {
		return nil
	}
	first, _ := bufio.NewReader(f).ReadString('\n')
	f.Close()
	first = strings.TrimSpace(first)
	if !strings.HasPrefix(first, "#!") {
		return nil
	}
	name := filepath.Base(bin)
	var b strings.Builder
	b.WriteString("@echo off\r\n")
	switch {
	case strings.Contains(first, "python"):
		flag := ""
		if strings.Contains(first, " -I") {
			flag = "-I "
		}
		b.WriteString(`"` + py + `" ` + flag + `"%~dp0` + name + `" %*` + "\r\n")
	case name == "board":
		// Same as the sh wrapper: GATE_DIR, else ../gate.
		b.WriteString("if defined GATE_DIR goto gatedir\r\n")
		b.WriteString(`"` + py + `" -I "%~dp0..\gate\board.py" %*` + "\r\nexit /b %errorlevel%\r\n:gatedir\r\n")
		b.WriteString(`"` + py + `" -I "%GATE_DIR%\board.py" %*` + "\r\n")
	case strings.Contains(first, "zsh"):
		b.WriteString("echo " + name + ": needs zsh (macOS only) 1>&2\r\nexit /b 1\r\n")
	case bash == "":
		b.WriteString("echo " + name + ": needs Git Bash, install Git for Windows (https://gitforwindows.org) 1>&2\r\nexit /b 1\r\n")
	default:
		// MSYS bash reads forward slashes as-is; python3 inside the script becomes the product Python.
		pyFwd := strings.ReplaceAll(py, `\`, "/")
		b.WriteString(`set "BH_SCRIPT=%~dp0` + name + `"` + "\r\n")
		b.WriteString(`set "BH_SCRIPT=%BH_SCRIPT:\=/%"` + "\r\n")
		b.WriteString(`"` + bash + `" -c "python3() { '` + pyFwd + `' \"$@\"; }; export -f python3; . \"$0\"" "%BH_SCRIPT%" %*` + "\r\n")
	}
	return []byte(b.String())
}

// writeLeadShims writes <name>.cmd next to every extensionless script in leadDir (Windows only).
func writeLeadShims(leadDir string) {
	entries, err := os.ReadDir(leadDir)
	if err != nil {
		return
	}
	py := leadShimPython()
	bash, _ := LookBash()
	// Git Bash (the shell Claude Code uses on Windows) finds the extensionless script itself, not the
	// .cmd; its `python3` would be the Store stub. This file sits before WindowsApps on the role's PATH.
	py3 := []byte("#!/bin/sh\nexec '" + strings.ReplaceAll(py, `\`, "/") + "' \"$@\"\n")
	if old, err := os.ReadFile(filepath.Join(leadDir, "python3")); err != nil || string(old) != string(py3) {
		_ = AtomicWriteFile(filepath.Join(leadDir, "python3"), py3, 0o755)
	}
	for _, e := range entries {
		if e.IsDir() || strings.Contains(e.Name(), ".") || e.Name() == "python3" {
			continue
		}
		body := leadShim(filepath.Join(leadDir, e.Name()), py, bash)
		if body == nil {
			continue
		}
		dst := filepath.Join(leadDir, e.Name()+".cmd")
		if old, err := os.ReadFile(dst); err == nil && string(old) == string(body) {
			continue
		}
		_ = AtomicWriteFile(dst, body, 0o755)
	}
}
