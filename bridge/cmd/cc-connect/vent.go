package main

// `bothouse vent "<一句话>"`: a teammate stuck on a tool, command or environment writes one
// line; the lead reads what is new at the hourly wrap-up with `bothouse vent list --new`.
// Modelled on Lovable's #agent-vents (user 2026-11-13 「都做」 on 橘's proposal 「给队友一个
// 固定的「工具坑」去处，卡在工具上就写一行，收口时挑明显的修」). It only records and lists;
// whether to fix is the lead's call at wrap-up — nothing here repairs or dispatches.

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
)

const (
	ventFile     = "vents.jsonl"
	ventSeenFile = "vents.seen"
)

type ventEntry struct {
	At      string `json:"at"` // RFC 3339, local time
	Project string `json:"project,omitempty"`
	Session string `json:"session,omitempty"`
	Task    int    `json:"task,omitempty"` // open board item bound to this session; 0 = none
	Text    string `json:"text"`
}

func runVent(args []string) {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		printVentUsage()
		if len(args) == 0 {
			os.Exit(2)
		}
		return
	}
	if args[0] == "list" {
		runVentList(args[1:])
		return
	}
	fs := flag.NewFlagSet("vent", flag.ExitOnError)
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	fs.Usage = printVentUsage
	_ = fs.Parse(args)
	text := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if text == "" {
		printVentUsage()
		os.Exit(2)
	}
	dir := ventTeamDir(*dataDir)
	session := strings.TrimSpace(os.Getenv("CC_SESSION_KEY"))
	e := ventEntry{
		At:      time.Now().Format(time.RFC3339),
		Project: strings.TrimSpace(os.Getenv("CC_PROJECT")),
		Session: session,
		Task:    ventTaskFor(dir, session),
		Text:    text,
	}
	if err := appendVent(dir, e); err != nil {
		fmt.Fprintln(os.Stderr, "vent:", err)
		os.Exit(1)
	}
	fmt.Println("记下了：" + formatVent(e))
}

func runVentList(args []string) {
	fs := flag.NewFlagSet("vent list", flag.ExitOnError)
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	onlyNew := fs.Bool("new", false, "只列上次 --new 之后新增的，并记下这次看到哪")
	fs.Usage = printVentUsage
	_ = fs.Parse(args)
	dir := ventTeamDir(*dataDir)
	all := readVents(dir)
	from := 0
	if *onlyNew {
		from = readVentSeen(dir)
		if from > len(all) { // file was trimmed or replaced: show it all again
			from = 0
		}
	}
	shown := all[from:]
	if len(shown) == 0 {
		if *onlyNew {
			fmt.Println("上次收口以来没有新吐槽。")
		} else {
			fmt.Println("还没有吐槽。")
		}
	} else {
		if *onlyNew {
			fmt.Printf("上次收口以来新吐槽 %d 条（挑明显的派修，修不修你定）：\n", len(shown))
		}
		for _, e := range shown {
			fmt.Println("- " + formatVent(e))
		}
	}
	if *onlyNew {
		if err := os.WriteFile(filepath.Join(dir, ventSeenFile), []byte(fmt.Sprint(len(all))), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "vent:", err)
			os.Exit(1)
		}
	}
}

func printVentUsage() {
	fmt.Println(`usage:
  bothouse vent "<一句话>"      卡在工具/命令/环境上时记一行（自动带角色、会话、时间、任务号）
  bothouse vent list            列出全部
  bothouse vent list --new      收口用：只列上次 --new 之后新增的`)
}

// ventTeamDir is the shared team directory (<data dir>/team, the wizard default), so every
// role on this machine writes to the same list.
func ventTeamDir(flagDir string) string {
	dir := strings.TrimSpace(flagDir)
	if dir == "" {
		if env := ccconnect.GuardTestDataDir(strings.TrimSpace(os.Getenv("CC_DATA_DIR"))); env != "" {
			dir = env
		} else {
			dir = resolveDataDir("")
		}
	}
	return filepath.Join(dir, "team")
}

var ventDoneStatus = regexp.MustCompile(`^\s*已?完成`)

// ventTaskFor: the newest open board item whose workspace (ws) or chat (sk) is this session.
func ventTaskFor(dir, session string) int {
	if session == "" {
		return 0
	}
	f, err := os.Open(filepath.Join(dir, "board.jsonl"))
	if err != nil {
		return 0
	}
	defer f.Close()
	best := 0
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 4<<20)
	for sc.Scan() {
		var it struct {
			ID     int    `json:"id"`
			Status string `json:"status"`
			SK     string `json:"sk"`
			WS     string `json:"ws"`
		}
		if json.Unmarshal(sc.Bytes(), &it) != nil || it.ID <= 0 || ventDoneStatus.MatchString(it.Status) {
			continue
		}
		if (it.WS == session || it.SK == session) && it.ID > best {
			best = it.ID
		}
	}
	return best
}

func appendVent(dir string, e ventEntry) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, ventFile), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return err
}

func readVents(dir string) []ventEntry {
	f, err := os.Open(filepath.Join(dir, ventFile))
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []ventEntry
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 4<<20)
	for sc.Scan() {
		var e ventEntry
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.Text != "" {
			out = append(out, e)
		}
	}
	return out
}

func readVentSeen(dir string) int {
	b, err := os.ReadFile(filepath.Join(dir, ventSeenFile))
	if err != nil {
		return 0
	}
	n := 0
	_, _ = fmt.Sscan(strings.TrimSpace(string(b)), &n)
	if n < 0 {
		return 0
	}
	return n
}

func formatVent(e ventEntry) string {
	at := e.At
	if t, err := time.Parse(time.RFC3339, e.At); err == nil {
		at = t.Local().Format("01-02 15:04")
	}
	who := e.Project
	if who == "" {
		who = "?"
	}
	s := at + " " + who
	if e.Task > 0 {
		s += fmt.Sprintf(" #%d", e.Task)
	}
	if e.Session != "" {
		s += " (" + e.Session + ")"
	}
	return s + "：" + e.Text
}
