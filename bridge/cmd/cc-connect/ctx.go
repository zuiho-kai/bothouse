package main

// `bothouse ctx <编号>…`: print what the turn injected only as a title and [#编号] (core/ctxstore.go).

import (
	"flag"
	"fmt"
	"os"
	"strings"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/core"
)

func runCtx(args []string) {
	fs := flag.NewFlagSet("ctx", flag.ExitOnError)
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: bothouse ctx <编号> [<编号>…]\n  打印每轮注入里只给了标题和 [#编号] 的那条的正文")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	if fs.NArg() == 0 {
		fs.Usage()
		os.Exit(2)
	}
	dir := *dataDir
	if dir == "" {
		if env := ccconnect.GuardTestDataDir(strings.TrimSpace(os.Getenv("CC_DATA_DIR"))); env != "" {
			dir = env
		} else {
			dir = resolveDataDir("")
		}
	}
	failed := false
	for i, id := range fs.Args() {
		body, err := core.ReadCtx(dir, id)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			failed = true
			continue
		}
		if fs.NArg() > 1 {
			if i > 0 {
				fmt.Println()
			}
			fmt.Printf("===== #%s =====\n", strings.Trim(id, "[]#"))
		}
		fmt.Print(strings.TrimRight(body, "\n") + "\n")
	}
	if failed {
		os.Exit(1)
	}
}
