package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
)

func runVoiceDesk(args []string) {
	if len(args) > 0 && isHelpArg(args[0]) {
		args = []string{"-h"} // the flag set prints the usage and returns flag.ErrHelp
	}
	if err := voiceDeskCommand(args, os.Stdout); err != nil && !errors.Is(err, flag.ErrHelp) {
		fmt.Fprintf(os.Stderr, "voice-desk: %v\n", err)
		os.Exit(1)
	}
}

func voiceDeskCommand(args []string, out io.Writer) error {
	f := flag.NewFlagSet("voice-desk", flag.ContinueOnError)
	project := f.String("project", os.Getenv("CC_PROJECT"), "project with voice desk enabled")
	dataDir := f.String("data-dir", "", "bridge data directory")
	if err := f.Parse(args); err != nil {
		return err
	}
	if *project == "" || f.NArg() != 0 {
		return fmt.Errorf("project is required; no positional arguments")
	}
	var result struct {
		Brief string `json:"brief"`
	}
	if err := modelAPIGet(resolveSocketPath(*dataDir), "/voice/desk?"+url.Values{"project": {*project}}.Encode(), &result); err != nil {
		return err
	}
	_, err := fmt.Fprintln(out, result.Brief)
	return err
}
