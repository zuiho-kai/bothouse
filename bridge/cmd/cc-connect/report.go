package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// 来源：一天 24 小时。
const hoursPerDay = 24

type reportFileFrequencyOptions struct {
	DataDir    string
	Source     string
	ClaudeDir  string
	Project    string
	SinceRaw   string
	SmallChars int
	LargeBytes int64
	MinReads   int
	Top        int
	Format     string
	JSONOut    string
	WikiDir    string
}

func runReport(args []string) {
	if len(args) == 0 || isHelpArg(args[0]) {
		printReportUsage(os.Stdout)
		return
	}
	switch args[0] {
	case "file-frequency", "reads":
		if err := reportFileFrequencyCommand(args[1:], os.Stdout); err != nil {
			fmt.Fprintf(os.Stderr, "report: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "report: unknown subcommand %q\n\n", args[0])
		printReportUsage(os.Stderr)
		os.Exit(2)
	}
}

func reportFileFrequencyCommand(args []string, out io.Writer) error {
	if len(args) > 0 && isHelpArg(args[0]) {
		printReportFileFrequencyUsage(out)
		return nil
	}
	home, _ := os.UserHomeDir()
	opts := reportFileFrequencyOptions{
		Source:     string(core.ReadFrequencySourceAuto),
		ClaudeDir:  filepath.Join(home, ".claude", "projects"),
		SmallChars: core.DefaultReadFrequencySmallChars,
		LargeBytes: core.DefaultReadFrequencyLargeBytes,
		MinReads:   core.DefaultReadFrequencyMinReads,
		Top:        core.DefaultReadFrequencyTop,
		Format:     "markdown",
		WikiDir:    defaultReadFrequencyWikiDir(),
	}
	fs := flag.NewFlagSet("report file-frequency", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&opts.DataDir, "data-dir", "", "data directory containing events.jsonl (default: resolved bothouse data dir)")
	fs.StringVar(&opts.Source, "source", opts.Source, "event source: auto, events, claudecode")
	fs.StringVar(&opts.ClaudeDir, "claude-dir", opts.ClaudeDir, "Claude Code projects directory (fallback source)")
	fs.StringVar(&opts.Project, "project", "", "only this project (exact name, or basename for Claude cwd)")
	fs.StringVar(&opts.SinceRaw, "since", "", "time window, e.g. 24h or 7d (default: all)")
	fs.IntVar(&opts.SmallChars, "small-chars", opts.SmallChars, "files at or below this many characters suggest STANDING.md")
	fs.Int64Var(&opts.LargeBytes, "large-bytes", opts.LargeBytes, "files at or above this many bytes suggest splitting")
	fs.IntVar(&opts.MinReads, "min-reads", opts.MinReads, "minimum reads to call a file frequently read")
	fs.IntVar(&opts.Top, "top", opts.Top, "rows per project")
	fs.StringVar(&opts.Format, "format", opts.Format, "output format: markdown or json")
	fs.StringVar(&opts.JSONOut, "json-out", "", "also write the JSON report to this file")
	fs.StringVar(&opts.WikiDir, "wiki", opts.WikiDir, "wiki directory holding STANDING.md (default: $GATE_WIKI or ~/wiki; off disables)")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			printReportFileFrequencyUsage(out)
			return nil
		}
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if opts.SmallChars <= 0 {
		return fmt.Errorf("--small-chars must be positive")
	}
	if opts.LargeBytes <= 0 {
		return fmt.Errorf("--large-bytes must be positive")
	}
	if opts.MinReads <= 0 {
		return fmt.Errorf("--min-reads must be positive")
	}
	if opts.Top <= 0 {
		return fmt.Errorf("--top must be positive")
	}
	format := strings.ToLower(strings.TrimSpace(opts.Format))
	if format != "markdown" && format != "json" {
		return fmt.Errorf("--format must be markdown or json")
	}
	source, err := parseReadFrequencySource(opts.Source)
	if err != nil {
		return err
	}
	since, err := parseReadFrequencySince(opts.SinceRaw)
	if err != nil {
		return err
	}
	dataDir := resolveDataDir(opts.DataDir)
	events, actualSource, err := loadReadFrequencyEvents(source, dataDir, opts.ClaudeDir, opts.Project, since)
	if err != nil {
		return err
	}
	if opts.Project != "" {
		filtered := make([]core.ReadEvent, 0, len(events))
		for _, event := range events {
			if readFrequencyProjectMatches(event.Project, opts.Project) {
				filtered = append(filtered, event)
			}
		}
		events = filtered
	}
	report := core.BuildReadFrequencyReport(events, core.ReadFrequencyOptions{
		Source:     actualSource,
		Since:      since,
		SmallChars: opts.SmallChars,
		LargeBytes: opts.LargeBytes,
		MinReads:   opts.MinReads,
		Top:        opts.Top,
	})
	report.Standing = core.ReadStandingInfo(opts.WikiDir, opts.SmallChars)

	jsonData, err := core.MarshalReadFrequencyJSON(report)
	if err != nil {
		return fmt.Errorf("marshal JSON: %w", err)
	}
	if opts.JSONOut != "" {
		if err := os.WriteFile(opts.JSONOut, append(jsonData, '\n'), 0o600); err != nil {
			return fmt.Errorf("write %s: %w", opts.JSONOut, err)
		}
	}
	if format == "json" {
		if _, err := out.Write(append(jsonData, '\n')); err != nil {
			return err
		}
		return nil
	}
	_, err = io.WriteString(out, core.RenderReadFrequencyMarkdown(report))
	return err
}

func parseReadFrequencySource(raw string) (core.ReadFrequencySource, error) {
	switch core.ReadFrequencySource(strings.ToLower(strings.TrimSpace(raw))) {
	case core.ReadFrequencySourceAuto:
		return core.ReadFrequencySourceAuto, nil
	case core.ReadFrequencySourceEvents:
		return core.ReadFrequencySourceEvents, nil
	case core.ReadFrequencySourceClaudeCode:
		return core.ReadFrequencySourceClaudeCode, nil
	default:
		return "", fmt.Errorf("--source must be auto, events or claudecode")
	}
}

func parseReadFrequencySince(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, nil
	}
	if duration, err := time.ParseDuration(raw); err == nil {
		if duration <= 0 {
			return time.Time{}, fmt.Errorf("--since must be positive")
		}
		return time.Now().Add(-duration), nil
	}
	if strings.HasSuffix(raw, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(raw, "d"))
		if err != nil || days <= 0 {
			return time.Time{}, fmt.Errorf("invalid --since %q", raw)
		}
		return time.Now().Add(-time.Duration(days) * hoursPerDay * time.Hour), nil
	}
	return time.Time{}, fmt.Errorf("invalid --since %q (use 24h, 7d, ...)", raw)
}

func loadReadFrequencyEvents(source core.ReadFrequencySource, dataDir, claudeDir, project string, since time.Time) ([]core.ReadEvent, string, error) {
	switch source {
	case core.ReadFrequencySourceEvents:
		events, err := (core.EventsReadSource{DataDir: dataDir}).ReadEvents(since)
		return events, string(core.ReadFrequencySourceEvents), err
	case core.ReadFrequencySourceClaudeCode:
		events, err := (core.ClaudeCodeReadSource{Dir: claudeDir}).ReadEvents(since)
		return events, string(core.ReadFrequencySourceClaudeCode), err
	default:
		events, eventsErr := (core.EventsReadSource{DataDir: dataDir}).ReadEvents(since)
		// Decide on the reads the caller will actually report: another
		// project's activity must not hide this project's Claude records.
		if eventsErr == nil && readFrequencyEventsMatchProject(events, project) {
			return events, string(core.ReadFrequencySourceEvents), nil
		}
		claudeEvents, claudeErr := (core.ClaudeCodeReadSource{Dir: claudeDir}).ReadEvents(since)
		if claudeErr != nil {
			if eventsErr != nil {
				return nil, "", fmt.Errorf("events: %v; claudecode: %w", eventsErr, claudeErr)
			}
			return nil, "", claudeErr
		}
		return claudeEvents, string(core.ReadFrequencySourceClaudeCode), nil
	}
}

func readFrequencyProjectMatches(project, filter string) bool {
	if filter == "" {
		return true
	}
	project = strings.TrimSpace(project)
	return project == filter || filepath.Base(project) == filter
}

// readFrequencyEventsMatchProject reports whether events contain a read for the
// requested project. With no filter it is just "any events at all", preserving
// the previous auto-source behaviour.
func readFrequencyEventsMatchProject(events []core.ReadEvent, project string) bool {
	if project == "" {
		return len(events) > 0
	}
	for _, event := range events {
		if readFrequencyProjectMatches(event.Project, project) {
			return true
		}
	}
	return false
}

func defaultReadFrequencyWikiDir() string {
	if value, ok := os.LookupEnv("GATE_WIKI"); ok {
		return strings.TrimSpace(value)
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, "wiki")
	}
	return ""
}

func printReportUsage(w io.Writer) {
	fmt.Fprintln(w, `Usage:
  bothouse report <subcommand> [flags]

Subcommands:
  file-frequency     Files read most often (also: reads)

Run 'bothouse report file-frequency -h' for flags.
The command is read-only: it never changes memory or STANDING.md.`)
}

func printReportFileFrequencyUsage(w io.Writer) {
	fmt.Fprintf(w, `Usage:
  bothouse report file-frequency [flags]

Reads tool events from <data-dir>/events.jsonl (the #581 unified stream).
If that stream has no reads, it falls back to Claude Code session logs in
~/.claude/projects. It reports counts, last read and size per project, and
suggests small frequent files for the STANDING.md block or large frequent
files for splitting. It never edits memory or STANDING.md.

Examples:
  bothouse report file-frequency --since 7d
  bothouse report file-frequency --project deep --format json
  bothouse report file-frequency --source claudecode --since 30d --json-out /tmp/reads.json

Flags:
  --data-dir PATH      data directory containing events.jsonl (default: resolved bothouse data dir)
  --source NAME        auto (default), events, or claudecode
  --claude-dir PATH    Claude Code projects directory (default: ~/.claude/projects)
  --project NAME       only this project (exact; Claude cwd basename also matches)
  --since WINDOW       e.g. 24h or 7d (default: all time)
  --small-chars N      standing suggestion at or below N chars (default: %d, STANDING.md limit)
  --large-bytes N      split suggestion at or above N bytes (default: %d)
  --min-reads N        minimum reads to call a file frequent (default: %d)
  --top N              rows per project (default: %d)
  --format NAME        markdown (default) or json
  --json-out PATH      also write the JSON report to PATH
  --wiki PATH          wiki directory holding STANDING.md (default: $GATE_WIKI or ~/wiki; off disables)
`, core.DefaultReadFrequencySmallChars, core.DefaultReadFrequencyLargeBytes, core.DefaultReadFrequencyMinReads, core.DefaultReadFrequencyTop)
}
