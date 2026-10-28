package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// runTask exposes task-card inspection, member assignment and human acceptance.
// Progress remains on the original card without re-running the work.
func runTask(args []string) {
	if err := taskCommand(args, os.Stdout); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintf(os.Stderr, "task: %v\n", err)
		os.Exit(1)
	}
}

func taskClient(dataDir string) *http.Client {
	socket := resolveSocketPath(dataDir)
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	return &http.Client{Transport: transport, Timeout: 15 * time.Second}
}

func taskCall(client *http.Client, method, path string, body []byte) ([]byte, error) {
	var req *http.Request
	var err error
	if body == nil {
		req, err = http.NewRequest(method, "http://unix"+path, nil)
	} else {
		req, err = http.NewRequest(method, "http://unix"+path, bytes.NewReader(body))
	}
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, b)
	}
	return b, nil
}

func taskCommand(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: task list|show|accept|assign|artifact|rework [flags]")
	}
	if isHelpArg(args[0]) {
		fmt.Fprintln(out, "usage: task list|show|accept|assign|artifact|rework [flags]  (task <action> -h lists the flags)")
		return nil
	}
	action, rest := args[0], args[1:]
	f := flag.NewFlagSet("task "+action, flag.ContinueOnError)
	project := f.String("project", os.Getenv("CC_PROJECT"), "project")
	session := f.String("session", "", "session key (list or assign)")
	id := f.String("id", "", "task id")
	batch := f.String("batch", "", "stable delegation batch id; opens a fresh card without --id (assign only)")
	actor := f.String("by", "", "who confirmed the acceptance")
	run := f.String("run", "", "primary role's current run token (assign only)")
	member := f.String("member", "", "unique member execution id (assign only)")
	name := f.String("name", "", "member display name (assign only)")
	reporter := f.String("reporter-project", "", "configured bot project id; native children inherit their owning bot (assign only)")
	title := f.String("title", "", "short member assignment (assign only)")
	parent := f.String("parent", "", "parent member id for a child agent (assign only)")
	ref := f.String("ref", "", "reference implementation to follow, path:line; non-code work writes 无（新建） (assign only, required)")
	base := f.String("base", "", "branch to start from; required when the title or ref says 多人改/共改文件 (assign only)")
	workspace := f.String("workspace", "", "another workspace of the same chat channel where the member executes (assign only)")
	role := f.String("role", "", "input or output (artifact only)")
	kind := f.String("kind", "", "file/image/video/audio/link/text (artifact only)")
	label := f.String("label", "", "human-readable artifact label (artifact only)")
	locator := f.String("locator", "", "artifact reference: URL, repository path or absolute path (artifact only)")
	summary := f.String("summary", "", "optional note about the artifact (artifact only)")
	artifact := f.String("artifact", "", "artifact id the change is about (output only, rework only)")
	requestID := f.String("request-id", "", "stable operation id for one artifact attach or rework (required); reuse it only when retrying that operation")
	revision := f.Int("revision", 0, "task revision this artifact is delivered for (artifact only, required; a retry keeps its original revision)")
	feedback := f.String("feedback", "", "the change request in the owner's words (rework only)")
	limit := f.Int("limit", 10, "how many tasks to list")
	dataDir := f.String("data-dir", "", "bridge data directory")
	if err := f.Parse(rest); err != nil {
		return err
	}
	if f.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *project == "" || *dataDir == "" {
		return errors.New("project and data-dir are required")
	}
	client := taskClient(*dataDir)
	defer client.CloseIdleConnections()

	switch action {
	case "assign":
		body, err := json.Marshal(core.TaskMemberAssignment{ReporterProject: *reporter, Project: *project, SessionKey: *session, Run: *run, TaskID: *id, BatchID: *batch, MemberID: *member, ParentID: *parent, Name: *name, Title: *title, Ref: *ref, Base: *base, Workspace: *workspace})
		if err != nil {
			return err
		}
		b, err := taskCall(client, http.MethodPost, "/task/assign", body)
		if err != nil {
			return err
		}
		return writeJSON(out, b)
	case "list":
		q := url.Values{"project": {*project}, "limit": {strconv.Itoa(*limit)}}
		if *session != "" {
			q.Set("session", *session)
		}
		b, err := taskCall(client, http.MethodGet, "/task?"+q.Encode(), nil)
		if err != nil {
			return err
		}
		return writeTasks(out, b)
	case "show":
		if *id == "" {
			return errors.New("id is required")
		}
		q := url.Values{"project": {*project}, "id": {*id}}
		b, err := taskCall(client, http.MethodGet, "/task?"+q.Encode(), nil)
		if err != nil {
			return err
		}
		return writeJSON(out, b)
	case "artifact":
		if *id == "" {
			return errors.New("id is required")
		}
		if *requestID == "" {
			return errors.New("--request-id is required: reuse the same id only when retrying one attach")
		}
		if *revision < 1 {
			return errors.New("--revision is required: take the current revision from task show")
		}
		body, err := json.Marshal(core.TaskArtifactRequest{Project: *project, TaskID: *id, RequestID: *requestID, Revision: *revision, Role: *role, Kind: *kind, Label: *label, Ref: *locator, Summary: *summary})
		if err != nil {
			return err
		}
		b, err := taskCall(client, http.MethodPost, "/task/artifact", body)
		if err != nil {
			return err
		}
		return writeJSON(out, b)
	case "rework":
		if *id == "" {
			return errors.New("id is required")
		}
		if *feedback == "" {
			return errors.New("--feedback is required: name the change to make")
		}
		if *requestID == "" {
			return errors.New("--request-id is required: reuse the same id when retrying one change request")
		}
		body, err := json.Marshal(core.TaskReworkRequest{Project: *project, TaskID: *id, ArtifactID: *artifact, RequestID: *requestID, Feedback: *feedback})
		if err != nil {
			return err
		}
		b, err := taskCall(client, http.MethodPost, "/task/rework", body)
		if err != nil {
			return err
		}
		return writeJSON(out, b)
	case "accept":
		if *id == "" {
			return errors.New("id is required")
		}
		if *actor == "" {
			return errors.New("--by is required: acceptance must name the human who confirmed it")
		}
		body, err := json.Marshal(map[string]string{"project": *project, "task_id": *id, "actor": *actor})
		if err != nil {
			return err
		}
		b, err := taskCall(client, http.MethodPost, "/task/accept", body)
		if err != nil {
			return err
		}
		return writeJSON(out, b)
	default:
		return fmt.Errorf("unknown task action %q (use list, show, accept, assign, artifact or rework)", action)
	}
}

// writeTasks prints one line per card so a reader can scan state without the
// full event log.
func writeTasks(out io.Writer, raw []byte) error {
	var payload struct {
		Tasks []*core.Task `json:"tasks"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}
	if len(payload.Tasks) == 0 {
		_, err := fmt.Fprintln(out, "no tasks")
		return err
	}
	for _, t := range payload.Tasks {
		updated := t.UpdatedAt.Local().Format("2006-01-02 15:04")
		fmt.Fprintf(out, "%s\t%s\t%s\t%s\n", t.ID, t.State, updated, t.Title)
		if t.LatestProgress != "" {
			fmt.Fprintf(out, "\t%s\n", t.LatestProgress)
		}
		if t.RevisionNo() > 1 || len(t.Artifacts) > 0 {
			inputs, outputs := 0, 0
			for _, a := range t.Artifacts {
				if a.Role == core.TaskArtifactInput {
					inputs++
				} else {
					outputs++
				}
			}
			fmt.Fprintf(out, "\t%s\n", core.NewI18n(core.Language(core.SystemLanguage())).Tf(core.MsgTaskListRevision, t.RevisionNo(), len(t.Artifacts), inputs, outputs))
		}
	}
	return nil
}

func writeJSON(out io.Writer, raw []byte) error {
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return err
	}
	buf.WriteByte('\n')
	_, err := out.Write(buf.Bytes())
	return err
}
