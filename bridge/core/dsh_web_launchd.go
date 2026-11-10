//go:build darwin

package core

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
)

// dshWebLaunchdLabel is the launchd job that supervises the formal `dsh web` on this machine.
// 来源：dsh/scripts/reload-web.py DEFAULT_LABEL 与 ~/Library/LaunchAgents 里的同名 plist
// （2026-11-05 现场，交接 notes/issue1394-fix-20261110.handoff.md）。
const dshWebLaunchdLabel = "local.bothouse.dsh-web"

// dshWebLaunchdLogPaths is where launchd sends the supervised host's stdout/stderr: the plist's
// StandardOutPath / StandardErrorPath, in that order, only the ones that exist.
//
// Why the panel needs them (#1394): with `--public-url https://<host>.ts.net/` the announcement
// carries no port, so the only line that can prove where the host listens is the one launchd's log
// holds. That log is a release directory's `dsh-web.log`, which is neither the state file's default
// log nor a sibling of the recorded one once the state file was written by an open that recorded
// `~/.bothouse/dsh-web.log` — the announcement was then never read and a second `dsh web` started.
// Reading the plist is the same source reload-web.py uses (launchd_info reads `stdout path`).
func dshWebLaunchdLogPaths() []string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}
	plist := filepath.Join(home, "Library", "LaunchAgents", dshWebLaunchdLabel+".plist")
	b, err := os.ReadFile(plist)
	if err != nil {
		return nil
	}
	values := plistStringValues(b)
	paths := make([]string, 0, 2)
	for _, key := range []string{"StandardOutPath", "StandardErrorPath"} {
		p := strings.TrimSpace(values[key])
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err != nil {
			continue
		}
		paths = append(paths, p)
	}
	return paths
}

// plistStringValues maps each top-level <key> to the <string> that follows it. A plist is a flat
// enough XML for that: keys and their values alternate, and the nested dictionaries (EnvironmentVariables)
// simply contribute their own pairs, which no caller here reads. A binary plist (plutil -convert
// binary1) decodes to nothing and the caller falls back to the other candidates — no worse than before.
func plistStringValues(b []byte) map[string]string {
	values := make(map[string]string)
	dec := xml.NewDecoder(strings.NewReader(string(b)))
	lastKey := ""
	for {
		tok, err := dec.Token()
		if err != nil {
			return values
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "key":
				var s string
				if err := dec.DecodeElement(&s, &t); err != nil {
					return values
				}
				lastKey = strings.TrimSpace(s)
			case "string":
				var s string
				if err := dec.DecodeElement(&s, &t); err != nil {
					return values
				}
				if lastKey != "" {
					if _, dup := values[lastKey]; !dup {
						values[lastKey] = s
					}
					lastKey = ""
				}
			}
		}
	}
}
