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
	"os"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func runProgress(args []string) {
	if err := progressCommand(args, os.Stdout); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintf(os.Stderr, "progress: %v\n", err)
		os.Exit(1)
	}
}

func parseProgressArgs(args []string) (core.PublicProgressRequest, string, error) {
	var req core.PublicProgressRequest
	var dataDir string
	f := flag.NewFlagSet("progress", flag.ContinueOnError)
	f.StringVar(&req.Project, "project", os.Getenv("CC_PROJECT"), "project")
	f.StringVar(&req.SessionKey, "session", os.Getenv("CC_SESSION_KEY"), "session")
	f.StringVar(&req.Run, "run", "", "current turn token from prompt (required)")
	f.Int64Var(&req.Seq, "seq", 0, "sequence, beginning at 1")
	f.StringVar(&req.Kind, "kind", "", "start/update/milestone/waiting/result (member also: failed/cancelled)")
	f.StringVar(&req.Title, "title", "", "short task title, required for start")
	f.StringVar(&req.Summary, "message", "", "short, intentionally public summary")
	f.StringVar(&dataDir, "data-dir", "", "bridge data directory")
	if err := f.Parse(args); err != nil {
		return req, dataDir, err
	}
	if f.NArg() != 0 {
		return req, dataDir, errors.New("unexpected positional arguments")
	}
	return req, dataDir, req.Validate()
}

func progressCommand(args []string, out io.Writer) error {
	req, dataDir, err := parseProgressArgs(args)
	if err != nil {
		return err
	}
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	socket := resolveSocketPath(dataDir)
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 15 * time.Second}
	resp, err := client.Post("http://unix/progress", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, b)
	}
	_, err = out.Write(b)
	return err
}
