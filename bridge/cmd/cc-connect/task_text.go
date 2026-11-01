package main

import (
	"encoding/json"
	"errors"
	"flag"
	"github.com/chenhg5/cc-connect/core"
	"io"
	"net/http"
	"os"
)

func taskTextCommand(args []string, out io.Writer) error {
	f := flag.NewFlagSet("task delivery", flag.ContinueOnError)
	var req core.TaskTextResolutionRequest
	f.StringVar(&req.Project, "project", os.Getenv("CC_PROJECT"), "sending project")
	f.StringVar(&req.TaskID, "id", "", "task ID")
	f.StringVar(&req.DeliveryID, "delivery-id", "", "delivery ID (required for a resolution)")
	f.StringVar(&req.Action, "action", "list", "list, sent, not-accepted, cancel")
	f.StringVar(&req.Evidence, "evidence", "", "confirmed message ID or safe evidence reference")
	dataDir := f.String("data-dir", os.Getenv("CC_DATA_DIR"), "bridge data directory")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 || req.Project == "" || req.TaskID == "" || *dataDir == "" {
		return errors.New("project, id and data-dir required; no positional arguments")
	}
	if req.Action != "list" && (req.DeliveryID == "" || req.Evidence == "") {
		return errors.New("resolution requires delivery-id and evidence")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	client := taskClient(*dataDir)
	defer client.CloseIdleConnections()
	b, err := taskCall(client, http.MethodPost, "/task-text", body)
	if err != nil {
		return err
	}
	return writeJSON(out, b)
}
