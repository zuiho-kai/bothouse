package main

// `bothouse rules check [file]` measures the house rules files against the bridge's one warn line
// (core.HouseRulesWarnBytes), so the rules generator gates on the same number the bridge warns at
// instead of keeping its own copy (#2048).

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

func printRulesUsage() {
	fmt.Println(`Usage: bothouse rules check [file]

Measures house rules files against the bridge's warn line. With no file: <data dir>/rules/house.md
(data dir $CC_DATA_DIR or ~/.bothouse) and the per-session copies house.lead.md,
house.workspace.md, house.member.md that exist. Prints "<bytes>/<line> <path>" per file and exits
1 when any is over the line. The bridge sends a file whole either way and warns in chat once per
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
	var paths []string
	optional := map[string]bool{}
	if len(args) == 2 {
		paths = []string{args[1]}
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
		paths = []string{core.HouseRulesPath(dir)}
		for _, a := range core.HouseAudiences { // #2082: one copy per kind of session, each under the line
			p := core.HouseRulesPathFor(dir, a)
			paths = append(paths, p)
			optional[p] = true
		}
	}
	over := false
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			if optional[path] && errors.Is(err, fs.ErrNotExist) {
				continue
			}
			fmt.Fprintln(os.Stderr, "Error:", err)
			os.Exit(2)
		}
		fmt.Printf("%d/%d %s\n", len(b), core.HouseRulesWarnBytes, path)
		over = over || len(b) > core.HouseRulesWarnBytes
	}
	if over {
		os.Exit(1)
	}
}
