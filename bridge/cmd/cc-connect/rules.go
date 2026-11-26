package main

// `bothouse rules check [file]` measures the house rules file against the bridge's one warn line
// (core.HouseRulesWarnBytes), so the rules generator gates on the same number the bridge warns at
// instead of keeping its own copy (#2048).

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

func printRulesUsage() {
	fmt.Println(`Usage: bothouse rules check [file]

Measures the house rules file (default: <data dir>/rules/house.md, data dir $CC_DATA_DIR or
~/.bothouse) against the bridge's warn line. Prints "<bytes>/<line> <path>" and exits 1 when the
file is over the line. The bridge sends the file whole either way and warns in chat once per
version when it is over.`)
}

func runRules(args []string) {
	if len(args) == 0 || args[0] != "check" || len(args) > 2 {
		printRulesUsage()
		if len(args) == 0 || !isHelpArg(args[0]) {
			os.Exit(2)
		}
		return
	}
	path := ""
	if len(args) == 2 {
		path = args[1]
	} else {
		dir := strings.TrimSpace(os.Getenv("CC_DATA_DIR"))
		if dir == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				fmt.Fprintln(os.Stderr, "Error:", err)
				os.Exit(2)
			}
			dir = filepath.Join(home, ".bothouse")
		}
		path = core.HouseRulesPath(dir)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(2)
	}
	fmt.Printf("%d/%d %s\n", len(b), core.HouseRulesWarnBytes, path)
	if len(b) > core.HouseRulesWarnBytes {
		os.Exit(1)
	}
}
