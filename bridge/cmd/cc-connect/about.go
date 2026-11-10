package main

import (
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
)

const aboutUsage = `Usage: bothouse about [--config PATH]

Print what bothouse is (features, how it compares with other projects, roadmap), this
binary's version, and this machine's setup: roles, the CLI each runs, connected platforms.
No tokens or keys are printed. Roles run this when asked what bothouse or they are.
`

func runAbout(args []string) {
	if err := aboutCommand(args, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "about:", err)
		os.Exit(1)
	}
}

func aboutCommand(args []string, out io.Writer) error {
	for _, a := range args {
		if isHelpArg(a) {
			fmt.Fprint(out, aboutUsage)
			return nil
		}
	}
	fs := flag.NewFlagSet("about", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	cfgPath := fs.String("config", "", "")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("%w\n%s", err, aboutUsage)
	}
	path := aboutConfigPath(*cfgPath)
	cfg, cfgErr := config.Load(path)

	lang := ""
	if cfg != nil {
		lang = cfg.Language
	}
	doc, err := aboutDoc(lang)
	if err != nil {
		return err
	}
	v := version
	if v == "" {
		v = "dev"
	}
	fmt.Fprintf(out, "bothouse version: %s\n\n", v)
	fmt.Fprint(out, strings.TrimRight(doc, "\n")+"\n\n")
	fmt.Fprint(out, aboutLocalSetup(cfg, cfgErr, path, os.Getenv("CC_PROJECT")))
	return nil
}

// aboutConfigPath: an explicit --config, else the bridge's own config (CC_CONFIG_PATH, which roles
// inherit), else the one next to the role's data dir (CC_DATA_DIR), else the usual lookup.
func aboutConfigPath(explicit string) string {
	if explicit != "" {
		return explicit
	}
	if p := os.Getenv("CC_CONFIG_PATH"); p != "" {
		return p
	}
	if d := os.Getenv("CC_DATA_DIR"); d != "" {
		p := filepath.Join(d, "config.toml")
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return resolveConfigPath("")
}

func aboutDoc(lang string) (string, error) {
	name := "about/ABOUT.md"
	if strings.HasPrefix(strings.ToLower(lang), "zh") {
		name = "about/ABOUT.zh-CN.md"
	}
	b, err := fs.ReadFile(ccconnect.AboutFiles, name)
	if err != nil {
		return "", fmt.Errorf("product notes are not built into this binary: %w", err)
	}
	return string(b), nil
}

// aboutLocalSetup lists names and types only: never option values, which hold tokens.
func aboutLocalSetup(cfg *config.Config, cfgErr error, path, self string) string {
	var b strings.Builder
	b.WriteString("## This machine's setup\n\n")
	if cfg == nil {
		fmt.Fprintf(&b, "Config %s could not be read (%v); describe bothouse in general terms and say the local setup is unknown.\n", path, cfgErr)
		return b.String()
	}
	if len(cfg.Projects) == 0 {
		b.WriteString("No roles are configured yet (the setup wizard has not been completed).\n")
		return b.String()
	}
	fmt.Fprintf(&b, "%d role(s):\n", len(cfg.Projects))
	platforms := map[string]bool{}
	for _, p := range cfg.Projects {
		name := p.Name
		if p.TeamName != "" && p.TeamName != p.Name {
			name = fmt.Sprintf("%s (shown as %s)", p.Name, p.TeamName)
		}
		if self != "" && p.Name == self {
			name += " — this is you"
		}
		agent := p.Agent.Type
		if agent == "" {
			agent = "unknown"
		}
		if m, ok := p.Agent.Options["model"].(string); ok && m != "" {
			agent += ", model " + m
		}
		var plats []string
		for _, pc := range p.Platforms {
			t := pc.Type
			if pc.Disabled {
				t += " (disabled)"
			} else {
				platforms[pc.Type] = true
			}
			plats = append(plats, t)
		}
		if len(plats) == 0 {
			plats = []string{"none"}
		}
		fmt.Fprintf(&b, "- %s: CLI %s; platforms %s\n", name, agent, strings.Join(plats, ", "))
	}
	var all []string
	for t := range platforms {
		all = append(all, t)
	}
	sort.Strings(all)
	if len(all) > 0 {
		fmt.Fprintf(&b, "Connected platforms: %s\n", strings.Join(all, ", "))
	}
	return b.String()
}
