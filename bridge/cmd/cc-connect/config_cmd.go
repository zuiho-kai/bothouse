package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/BurntSushi/toml"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
)

func runConfig(args []string) {
	if len(args) == 0 {
		printConfigUsage()
		os.Exit(1)
	}
	if isHelpArg(args[0]) {
		printConfigUsage()
		return
	}
	switch args[0] {
	case "example":
		fmt.Print(ccconnect.ConfigExampleTOML)
	case "format", "fmt":
		runConfigFormat(args[1:])
	case "path":
		fmt.Println(resolveConfigPath(""))
	case "get":
		runConfigGet(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown config subcommand: %s\n", args[0])
		printConfigUsage()
		os.Exit(1)
	}
}

func runConfigFormat(args []string) {
	fs := flag.NewFlagSet("config format", flag.ExitOnError)
	configPath := fs.String("config", "", "path to config file (default: auto-detect)")
	_ = fs.Parse(args)

	path := resolveConfigPath(*configPath)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Config file not found: %s\n", path)
		os.Exit(1)
	}

	if err := config.FormatConfigFile(path); err != nil {
		fmt.Fprintf(os.Stderr, "Error formatting config: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Formatted %s\n", path)
}

// runConfigGet prints one value of config.toml as JSON, so scripts in other languages read the bridge's config
// through the bridge instead of parsing TOML themselves (#2051: Python on 3.9 has no tomllib and used regexes).
func runConfigGet(args []string) {
	fs := flag.NewFlagSet("config get", flag.ExitOnError)
	configPath := fs.String("config", "", "path to config file (default: auto-detect)")
	_ = fs.Parse(args)
	if fs.NArg() > 1 {
		fmt.Fprintln(os.Stderr, "Usage: bothouse config get [--config <path>] [<key>[.<key>...]]")
		os.Exit(2)
	}
	if err := configGet(os.Stdout, resolveConfigPath(*configPath), fs.Arg(0)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// configGet writes the value at the dotted key (the whole file when key is empty) as JSON. A key that is not
// set prints null; a table array (e.g. projects) is a JSON array.
func configGet(w io.Writer, path, key string) error {
	var v any = map[string]any{}
	if _, err := toml.DecodeFile(path, &v); err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	for _, k := range strings.Split(key, ".") {
		if k == "" {
			continue
		}
		m, ok := v.(map[string]any)
		if !ok {
			v = nil
			break
		}
		v = m[k]
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func printConfigUsage() {
	fmt.Fprintf(os.Stderr, `Usage: bothouse config <subcommand>

Subcommands:
  example    Print a complete annotated config.toml example
  format     Format the config file (alias: fmt)
  path       Print the resolved config file path
  get        Print a value as JSON: get [--config <path>] [<key>[.<key>...]]  (no key = the whole file)

Flags for 'format':
  --config <path>   Path to config file (default: auto-detect)

Examples:
  bothouse config example              Print example config
  bothouse config example > config.toml  Save example config
  bothouse config format               Format default config file
  bothouse config fmt --config /path/to/config.toml
  bothouse config get projects         All [[projects]] as a JSON array
`)
}
