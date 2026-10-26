package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// handoff inspects and performs the manual lead switch (#274). status and show
// read the durable records directly, so they work even when no bot is running;
// switch must reach the local bridge socket because only the live process can
// validate the target and change every engine's next turn.
func runHandoff(args []string) {
	if err := handoffCommand(args, os.Stdout); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintf(os.Stderr, "handoff: %v\n", err)
		os.Exit(1)
	}
}

func handoffCommand(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: handoff status|show|switch [flags]")
	}
	if isHelpArg(args[0]) {
		fmt.Fprintln(out, "usage: handoff status|show|switch [flags]  (handoff <action> -h lists the flags)")
		return nil
	}
	action, rest := args[0], args[1:]
	f := flag.NewFlagSet("handoff "+action, flag.ContinueOnError)
	f.SetOutput(out)
	dataDir := f.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	project := f.String("project", os.Getenv("CC_PROJECT"), "project (show/switch; defaults to the current lead)")
	to := f.String("to", "", "new lead project (switch only)")
	asJSON := f.Bool("json", false, "print JSON")
	if err := f.Parse(rest); err != nil {
		return err
	}
	if f.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *dataDir == "" {
		*dataDir = strings.TrimSpace(os.Getenv("CC_DATA_DIR"))
	}
	if *dataDir == "" {
		*dataDir = defaultDataDir()
	}

	switch action {
	case "status":
		st, err := core.LeadHandoffStatusFor(*dataDir)
		if err != nil {
			return err
		}
		if *asJSON {
			b, err := json.Marshal(st)
			if err != nil {
				return err
			}
			return writeJSON(out, b)
		}
		fmt.Fprintf(out, "当前主角色：%s（%s）\n", displayOr(st.CurrentName, st.CurrentLead), st.CurrentLead)
		if st.SelectedAt != "" {
			fmt.Fprintf(out, "选择时间：%s\n", st.SelectedAt)
		}
		if st.Handoff == nil {
			fmt.Fprintln(out, "交接：没有记录（尚未通过 handoff 切换）")
		} else {
			h := st.Handoff
			fmt.Fprintf(out, "交接：%s · %s · %s → %s · %s\n", core.LeadHandoffStatusLabel(h.Status), h.ID, displayOr(h.FromName, h.From), displayOr(h.ToName, h.To), handoffCLITime(h.At))
			if !h.AckedAt.IsZero() {
				fmt.Fprintf(out, "确认时间：%s\n", handoffCLITime(h.AckedAt))
			}
			if h.Error != "" {
				fmt.Fprintf(out, "失败原因：%s\n", h.Error)
			}
		}
		for i := len(st.History) - 1; i >= 0 && i >= len(st.History)-3; i-- {
			h := st.History[i]
			if st.Handoff != nil && h.ID == st.Handoff.ID {
				continue
			}
			fmt.Fprintf(out, "历史：%s %s → %s %s\n", core.LeadHandoffStatusLabel(h.Status), displayOr(h.FromName, h.From), displayOr(h.ToName, h.To), h.Error)
		}
		return nil
	case "show":
		text, err := core.BuildLeadHandoffText(*dataDir, *project)
		if err != nil {
			return err
		}
		if *asJSON {
			st, err := core.LeadHandoffStatusFor(*dataDir)
			if err != nil {
				return err
			}
			h := st.Handoff
			if *project != "" && (h == nil || h.To != *project) {
				h = nil
				for i := len(st.History) - 1; i >= 0; i-- {
					if st.History[i].To == *project {
						h = &st.History[i]
						break
					}
				}
			}
			if h == nil {
				return errors.New("no handoff record")
			}
			snap := h.Snapshot
			if snap == nil {
				snap, err = core.BuildLeadHandoffSnapshot(*dataDir, h.To, h.From)
				if err != nil {
					return err
				}
			}
			b, err := json.Marshal(snap)
			if err != nil {
				return err
			}
			return writeJSON(out, b)
		}
		_, err = fmt.Fprintln(out, text)
		return err
	case "switch":
		if strings.TrimSpace(*to) == "" {
			return errors.New("switch: --to is required")
		}
		body, err := json.Marshal(map[string]string{"project": *project, "to": *to})
		if err != nil {
			return err
		}
		client := taskClient(*dataDir)
		defer client.CloseIdleConnections()
		b, err := taskCall(client, http.MethodPost, "/handoff/switch", body)
		if err != nil {
			return err
		}
		return writeJSON(out, b)
	default:
		return fmt.Errorf("unknown handoff action %q (usage: handoff status|show|switch)", action)
	}
}

func displayOr(name, project string) string {
	if strings.TrimSpace(name) == "" {
		return project
	}
	return name
}

func handoffCLITime(t time.Time) string {
	if t.IsZero() {
		return "未知"
	}
	return t.Local().Format("2006-01-02 15:04")
}
