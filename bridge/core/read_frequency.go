package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Defaults for the read-frequency report.
const (
	// 来源：bridge/contrib/gate/ctxsvc.py 的 STANDING_CHARS=1500（#574）。
	DefaultReadFrequencySmallChars = 1500
	// 来源：SPEC #580——常读文件超过 64 KiB（约 1.6 万 token，按 4 B/token）视为大文件。
	DefaultReadFrequencyLargeBytes int64 = 65536
	// 来源：SPEC #580——同一文件至少重复读取 2 次才算「常读」。
	DefaultReadFrequencyMinReads = 2
	// 来源：沿用 open-strix file_frequency_report.py 的 --top 默认 15。
	DefaultReadFrequencyTop = 15
	// 来源：bridge/contrib/gate/ctxsvc.py 的 STANDING_LINES=20（#574）。
	readFrequencyStandingMaxLines = 20
)

// ReadFrequencySource names a read-event backend.
type ReadFrequencySource string

const (
	ReadFrequencySourceAuto       ReadFrequencySource = "auto"
	ReadFrequencySourceEvents     ReadFrequencySource = "events"
	ReadFrequencySourceClaudeCode ReadFrequencySource = "claudecode"
)

// ReadEvent is one file read observed in a session.
type ReadEvent struct {
	Time       time.Time
	Project    string
	SessionKey string
	Cwd        string
	Tool       string
	Path       string
}

// ReadEventSource is the adapter boundary. events.jsonl is the primary
// implementation; Claude Code session logs are the fallback. A future backend
// only needs to return ReadEvents.
type ReadEventSource interface {
	Name() string
	ReadEvents(since time.Time) ([]ReadEvent, error)
}

// ReadFrequencyOptions controls aggregation and suggestion thresholds.
type ReadFrequencyOptions struct {
	Source     string
	Since      time.Time
	SmallChars int
	LargeBytes int64
	MinReads   int
	Top        int
}

// ReadFrequencyThresholds is echoed in the report so JSON consumers can see
// exactly which thresholds produced the suggestions.
type ReadFrequencyThresholds struct {
	SmallChars int   `json:"small_chars"`
	LargeBytes int64 `json:"large_bytes"`
	MinReads   int   `json:"min_reads"`
	Top        int   `json:"top"`
}

// ReadFrequencyStanding describes the target STANDING.md block, read-only.
type ReadFrequencyStanding struct {
	Path           string `json:"path"`
	Exists         bool   `json:"exists"`
	Lines          int    `json:"lines"`
	Chars          int    `json:"chars"`
	MaxLines       int    `json:"max_lines"`
	MaxChars       int    `json:"max_chars"`
	RemainingChars int    `json:"remaining_chars"`
}

// ReadFrequencyFile is one file's aggregate for the selected window.
type ReadFrequencyFile struct {
	Path           string    `json:"path"`
	Reads          int       `json:"reads"`
	LastRead       time.Time `json:"last_read"`
	SizeBytes      int64     `json:"size_bytes"`
	SizeKnown      bool      `json:"size_known"`
	Chars          int       `json:"chars"`
	CharsKnown     bool      `json:"chars_known"`
	Suggestion     string    `json:"suggestion,omitempty"`
	SuggestionText string    `json:"suggestion_text,omitempty"`
}

// ReadFrequencyProject groups files by project.
type ReadFrequencyProject struct {
	Project     string              `json:"project"`
	Events      int                 `json:"events"`
	UniqueFiles int                 `json:"unique_files"`
	Files       []ReadFrequencyFile `json:"files"`
}

// ReadFrequencyReport is the machine-readable report.
type ReadFrequencyReport struct {
	GeneratedAt time.Time               `json:"generated_at"`
	Source      string                  `json:"source"`
	WindowStart *time.Time              `json:"window_start,omitempty"`
	WindowEnd   time.Time               `json:"window_end"`
	EventCount  int                     `json:"event_count"`
	Thresholds  ReadFrequencyThresholds `json:"thresholds"`
	Standing    *ReadFrequencyStanding  `json:"standing,omitempty"`
	Projects    []ReadFrequencyProject  `json:"projects"`
}

// Suggestion codes. The text is what the Markdown report shows.
const (
	ReadFrequencySuggestionStanding = "standing"
	ReadFrequencySuggestionSplit    = "split"
)

type readFrequencyAgg struct {
	reads int
	last  time.Time
}

// BuildReadFrequencyReport aggregates read events by project and resolves
// each file's current size. It never edits memory or STANDING.md.
func BuildReadFrequencyReport(events []ReadEvent, opts ReadFrequencyOptions) *ReadFrequencyReport {
	opts = normalizeReadFrequencyOptions(opts)
	now := time.Now()
	report := &ReadFrequencyReport{
		GeneratedAt: now,
		Source:      opts.Source,
		WindowEnd:   now,
		Thresholds: ReadFrequencyThresholds{
			SmallChars: opts.SmallChars,
			LargeBytes: opts.LargeBytes,
			MinReads:   opts.MinReads,
			Top:        opts.Top,
		},
		Projects: []ReadFrequencyProject{},
	}
	if !opts.Since.IsZero() {
		since := opts.Since
		report.WindowStart = &since
	}

	projects := map[string]map[string]*readFrequencyAgg{}
	projectEvents := map[string]int{}
	for _, ev := range events {
		if !opts.Since.IsZero() && ev.Time.Before(opts.Since) {
			continue
		}
		project := strings.TrimSpace(ev.Project)
		if project == "" {
			project = "(unknown)"
		}
		path := ResolveReadPath(ev.Cwd, ev.Path)
		if path == "" {
			continue
		}
		files := projects[project]
		if files == nil {
			files = map[string]*readFrequencyAgg{}
			projects[project] = files
		}
		agg := files[path]
		if agg == nil {
			agg = &readFrequencyAgg{}
			files[path] = agg
		}
		agg.reads++
		if ev.Time.After(agg.last) {
			agg.last = ev.Time
		}
		projectEvents[project]++
		report.EventCount++
	}

	names := make([]string, 0, len(projects))
	for name := range projects {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		files := projects[name]
		rows := make([]ReadFrequencyFile, 0, len(files))
		for path, agg := range files {
			size, sizeKnown, chars, charsKnown := readFrequencyFileInfo(path, opts.SmallChars)
			row := ReadFrequencyFile{
				Path:       path,
				Reads:      agg.reads,
				LastRead:   agg.last,
				SizeBytes:  size,
				SizeKnown:  sizeKnown,
				Chars:      chars,
				CharsKnown: charsKnown,
			}
			if agg.reads >= opts.MinReads {
				switch {
				case charsKnown && chars <= opts.SmallChars:
					row.Suggestion = ReadFrequencySuggestionStanding
				case sizeKnown && size >= opts.LargeBytes:
					row.Suggestion = ReadFrequencySuggestionSplit
				}
				row.SuggestionText = readFrequencySuggestionText(row.Suggestion)
			}
			rows = append(rows, row)
		}
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].Reads != rows[j].Reads {
				return rows[i].Reads > rows[j].Reads
			}
			if !rows[i].LastRead.Equal(rows[j].LastRead) {
				return rows[i].LastRead.After(rows[j].LastRead)
			}
			return rows[i].Path < rows[j].Path
		})
		unique := len(rows)
		if opts.Top > 0 && len(rows) > opts.Top {
			rows = rows[:opts.Top]
		}
		report.Projects = append(report.Projects, ReadFrequencyProject{
			Project:     name,
			Events:      projectEvents[name],
			UniqueFiles: unique,
			Files:       rows,
		})
	}
	return report
}

func normalizeReadFrequencyOptions(opts ReadFrequencyOptions) ReadFrequencyOptions {
	if opts.SmallChars <= 0 {
		opts.SmallChars = DefaultReadFrequencySmallChars
	}
	if opts.LargeBytes <= 0 {
		opts.LargeBytes = DefaultReadFrequencyLargeBytes
	}
	if opts.MinReads <= 0 {
		opts.MinReads = DefaultReadFrequencyMinReads
	}
	if opts.Top <= 0 {
		opts.Top = DefaultReadFrequencyTop
	}
	return opts
}

// ResolveReadPath expands ~ and resolves a relative tool path against the
// session cwd. It is deliberately conservative: an empty path stays empty.
func ResolveReadPath(cwd, raw string) string {
	path := strings.TrimSpace(raw)
	path = strings.Trim(path, `"'`)
	if path == "" {
		return ""
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			if path == "~" {
				path = home
			} else {
				path = filepath.Join(home, path[2:])
			}
		}
	}
	if !filepath.IsAbs(path) {
		base := strings.TrimSpace(cwd)
		if base == "" {
			if wd, err := os.Getwd(); err == nil {
				base = wd
			}
		}
		if base != "" {
			path = filepath.Join(base, path)
		}
	}
	return filepath.Clean(path)
}

func readFrequencyFileInfo(path string, smallChars int) (size int64, sizeKnown bool, chars int, charsKnown bool) {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return 0, false, 0, false
	}
	size, sizeKnown = st.Size(), true
	// UTF-8 uses at most 4 bytes per rune, so a file larger than 4*limit
	// cannot fit within the character budget; only read the candidates.
	if size <= int64(utf8.UTFMax*smallChars) {
		data, err := os.ReadFile(path)
		if err == nil {
			chars = utf8.RuneCount(data)
			charsKnown = true
		}
	}
	return size, sizeKnown, chars, charsKnown
}

func readFrequencySuggestionText(code string) string {
	switch code {
	case ReadFrequencySuggestionStanding:
		return "建议进 STANDING.md"
	case ReadFrequencySuggestionSplit:
		return "建议拆分"
	default:
		return ""
	}
}

// ReadStandingInfo reads <wiki>/STANDING.md and reports its budget usage.
// It never writes the file. An empty wikiDir or "off" disables the section.
func ReadStandingInfo(wikiDir string, smallChars int) *ReadFrequencyStanding {
	wikiDir = strings.TrimSpace(wikiDir)
	if wikiDir == "" || strings.EqualFold(wikiDir, "off") {
		return nil
	}
	if smallChars <= 0 {
		smallChars = DefaultReadFrequencySmallChars
	}
	wikiDir = ResolveReadPath("", wikiDir)
	path := filepath.Join(wikiDir, "STANDING.md")
	info := &ReadFrequencyStanding{
		Path:           path,
		MaxLines:       readFrequencyStandingMaxLines,
		MaxChars:       smallChars,
		RemainingChars: smallChars,
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return info
	}
	body := strings.TrimSpace(string(data))
	info.Exists = true
	info.Chars = utf8.RuneCountInString(body)
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) != "" && !strings.HasPrefix(line, "#") {
			info.Lines++
		}
	}
	if info.Chars >= info.MaxChars {
		info.RemainingChars = 0
	} else {
		info.RemainingChars = info.MaxChars - info.Chars
	}
	return info
}

// RenderReadFrequencyMarkdown renders the human-readable report.
func RenderReadFrequencyMarkdown(report *ReadFrequencyReport) string {
	if report == nil {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# 记忆读取频率报告（%s）\n\n", report.Source)
	if report.WindowStart != nil {
		fmt.Fprintf(&b, "时间窗：%s ~ %s\n\n", formatReadFrequencyTime(*report.WindowStart), formatReadFrequencyTime(report.WindowEnd))
	} else {
		fmt.Fprintf(&b, "时间窗：全部（截至 %s）\n\n", formatReadFrequencyTime(report.WindowEnd))
	}
	fmt.Fprintf(&b, "阈值：常读 ≥%d 次；小 ≤%d 字 → 建议进 STANDING.md；大 ≥%s → 建议拆分\n\n",
		report.Thresholds.MinReads, report.Thresholds.SmallChars, humanBytes(report.Thresholds.LargeBytes))
	if report.Standing != nil {
		if report.Standing.Exists {
			fmt.Fprintf(&b, "常驻做法目标：`%s`（%d/%d 条，%d/%d 字；剩余 %d 字）\n\n",
				report.Standing.Path, report.Standing.Lines, report.Standing.MaxLines,
				report.Standing.Chars, report.Standing.MaxChars, report.Standing.RemainingChars)
		} else {
			fmt.Fprintf(&b, "常驻做法目标：`%s`（尚未创建；上限 %d 条 / %d 字）\n\n",
				report.Standing.Path, report.Standing.MaxLines, report.Standing.MaxChars)
		}
	}
	if len(report.Projects) == 0 {
		b.WriteString("窗口内没有读取事件。\n")
		return b.String()
	}
	for _, project := range report.Projects {
		fmt.Fprintf(&b, "## %s\n\n", readFrequencyCell(project.Project))
		fmt.Fprintf(&b, "读取事件 %d 次，涉及 %d 个文件。\n\n", project.Events, project.UniqueFiles)
		b.WriteString("| 文件 | 读取次数 | 最近读取 | 大小 | 建议 |\n")
		b.WriteString("|---|---:|---|---:|---|\n")
		for _, file := range project.Files {
			suggestion := file.SuggestionText
			if suggestion == "" {
				suggestion = "—"
			}
			fmt.Fprintf(&b, "| %s | %d | %s | %s | %s |\n",
				readFrequencyCell(file.Path), file.Reads,
				formatReadFrequencyTime(file.LastRead), formatReadFrequencySize(file),
				suggestion)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// MarshalReadFrequencyJSON renders the report as indented JSON.
func MarshalReadFrequencyJSON(report *ReadFrequencyReport) ([]byte, error) {
	return json.MarshalIndent(report, "", "  ")
}

func formatReadFrequencyTime(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.Local().Format("2006-01-02 15:04")
}

func formatReadFrequencySize(file ReadFrequencyFile) string {
	if !file.SizeKnown {
		return "未知"
	}
	size := humanBytes(file.SizeBytes)
	if file.CharsKnown {
		size += fmt.Sprintf("（%d 字）", file.Chars)
	}
	return size
}

func readFrequencyCell(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "|", "\\|")
	value = strings.ReplaceAll(value, "\n", " ")
	return value
}

// 来源：IEC 80000-13，1 KiB = 1024 B。
const bytesPerKiB = 1024

func humanBytes(n int64) string {
	if n < bytesPerKiB {
		return fmt.Sprintf("%d B", n)
	}
	value := float64(n) / float64(bytesPerKiB)
	for _, unit := range []string{"KiB", "MiB", "GiB"} {
		if value < float64(bytesPerKiB) {
			return fmt.Sprintf("%.1f %s", value, unit)
		}
		value /= float64(bytesPerKiB)
	}
	return fmt.Sprintf("%.1f TiB", value)
}
