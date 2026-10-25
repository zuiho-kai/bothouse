package main

import (
	"os"
	"os/user"
	"path/filepath"
	"strings"
)

func trayInvocation(args []string) bool {
	if len(args) == 0 {
		return true
	}
	switch args[0] {
	case "config-example", "config", "update", "check-update", "provider", "send", "progress", "task", "cron", "model", "workspace", "timer", "at", "relay", "sessions", "session", "agent-sid", "daemon", "feishu", "tuitui", "weixin", "yuanbao", "doctor", "web", "setup", "version", "help", "upgrade":
		return false
	}
	for _, a := range args {
		if a == "-h" || a == "--help" || a == "--version" {
			return false
		}
	}
	return true
}

// Explicit headless/CLI invocations never create native desktop UI. Auto mode
// compares HOME with the OS account, so preview and test homes stay invisible.
func trayEnabledForInstance(args []string, getenv func(string) string, home, accountHome string) bool {
	if !trayInvocation(args) {
		return false
	}
	opts, err := parseRootCLIOptions(args)
	if err != nil || opts.headless || len(opts.args) > 0 {
		return false
	}
	if getenv("BOTHOUSE_NO_TRAY") == "1" {
		return false
	}
	switch strings.ToLower(getenv("BOTHOUSE_TRAY")) {
	case "off", "0", "false":
		return false
	case "on", "1", "true":
		return true
	}
	if getenv("SSH_CONNECTION") != "" || getenv("SSH_TTY") != "" {
		return false
	}
	return home != "" && accountHome != "" && filepath.Clean(home) == filepath.Clean(accountHome)
}

func desktopTrayEnabled(args []string) bool {
	home, _ := os.UserHomeDir()
	account, err := user.Current()
	accountHome := ""
	if err == nil {
		accountHome = account.HomeDir
	}
	return trayEnabledForInstance(args, os.Getenv, home, accountHome)
}
