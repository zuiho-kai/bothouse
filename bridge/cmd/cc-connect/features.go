package main

// 功能开关 (#1861): one registry (config/features.go) behind the panel's 功能开关 page and
// `bothouse features list`, which roles run when asked whether a feature is on.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// featureBoot is every switch's value when this process started: what a switch that needs a
// restart is really running with, whatever config.toml says now.
var featureBoot map[string]bool

func featureList() (core.FeatureList, error) {
	states, lang, err := config.ListFeatureStates(featureBoot)
	if err != nil {
		return core.FeatureList{}, err
	}
	return core.FeatureList{Features: states, Lang: lang}, nil
}

// wireFeatures backs the 功能开关 page. Normal mode and the setup wizard both wire it, like
// wireGlobalSettings.
func wireFeatures(srv *core.ManagementServer) {
	srv.SetFeatureFuncs(featureList, config.SetFeatureSwitch)
}

func printFeaturesUsage() {
	fmt.Println(`Usage: bothouse features list [--all]

Every feature switch of config.toml: on or off now, its default, and whether a change needs a
restart. Inside a role's turn it lists the global switches and that role's own; --all lists every
role's. The panel's 功能开关 page shows and changes the same list.`)
}

// runFeatures is `bothouse features list`.
func runFeatures(args []string) {
	if len(args) == 0 || isHelpArg(args[0]) || args[0] != "list" && args[0] != "ls" {
		printFeaturesUsage()
		if len(args) == 0 || !isHelpArg(args[0]) {
			os.Exit(1)
		}
		return
	}
	var all bool
	var dataDir string
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "--all":
			all = true
		case "--data-dir":
			if i+1 < len(args) {
				i++
				dataDir = args[i]
			}
		}
	}
	sockPath := resolveSocketPath(dataDir)
	if _, err := os.Stat(sockPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Error: bothouse is not running (socket not found: %s)\n", sockPath)
		os.Exit(1)
	}
	client := &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { return dialBridge(ctx, sockPath) },
	}}
	resp, err := client.Get("http://unix/features")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Error: %s\n", strings.TrimSpace(string(body)))
		os.Exit(1)
	}
	var list struct {
		Features []config.FeatureState `json:"features"`
		Lang     string                `json:"lang"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		fmt.Fprintf(os.Stderr, "Error: invalid response: %v\n", err)
		os.Exit(1)
	}
	only := ""
	if !all {
		only = strings.TrimSpace(os.Getenv("CC_PROJECT"))
	}
	fmt.Print(formatFeatures(list.Features, list.Lang, only))
}

// formatFeatures prints the list for a role to read: one line per switch, grouped global first,
// then per role (only that role when onlyProject is set).
func formatFeatures(states []config.FeatureState, lang, onlyProject string) string {
	zh := strings.HasPrefix(strings.ToLower(lang), "zh")
	pick := func(a, b string) string {
		if zh {
			return a
		}
		return b
	}
	onOff := func(v bool) string {
		if v {
			return pick("开", "on")
		}
		return pick("关", "off")
	}
	var b strings.Builder
	b.WriteString(pick("功能开关（config.toml 里现在的值；管理页「功能开关」可以改）\n",
		"Feature switches (as config.toml has them now; the panel's Feature switches page changes them)\n"))
	group := "\x00"
	for _, s := range states {
		if s.Project != "" && onlyProject != "" && s.Project != onlyProject {
			continue
		}
		if s.Project != group {
			group = s.Project
			if group == "" {
				b.WriteString(pick("【全局】\n", "[global]\n"))
			} else {
				b.WriteString(pick("【角色 ", "[role ") + group + pick("】\n", "]\n"))
			}
		}
		notes := []string{s.Key, pick("默认", "default ") + onOff(s.Default)}
		if s.Inverted {
			notes[0] += pick("（反着写：开 = false）", " (inverted: on = false)")
		}
		if s.PendingRestart {
			notes = append(notes, pick("配置已改，运行中的桥还是"+onOff(s.Running)+"，重启后生效",
				"changed in config, the running bridge still has it "+onOff(s.Running)+" until a restart"))
		} else if s.Restart {
			notes = append(notes, pick("改了要重启", "a change needs a restart"))
		}
		fmt.Fprintf(&b, "  [%s] %s：%s（%s）\n", onOff(s.On), pick(s.Name, s.NameEN), pick(s.Desc, s.DescEN),
			strings.Join(notes, pick("，", ", ")))
	}
	return b.String()
}
