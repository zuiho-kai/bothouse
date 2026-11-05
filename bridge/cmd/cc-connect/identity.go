package main

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

const identityUsage = `Usage: bothouse identity <command> [options]

Signed caller identity: who (which platform user) started the turn this command runs in.
The bridge signs it with its own key; the model cannot forge it. See docs/caller-identity.md.

Commands:
  token               print a fresh token for the current turn (valid 5 minutes)
  show                print the current turn's claims as JSON (and the token)
  pubkey              print the bridge public key (copy it to guard hosts)
  verify <token>      check a token offline against --pubkey (or this bridge's key)

Options:
  --project NAME      default $CC_PROJECT
  --session KEY       default $CC_SESSION_KEY
  --data-dir DIR      default $CC_DATA_DIR
  --pubkey FILE       (verify) trusted public key file; repeatable via comma
`

func runIdentity(args []string) {
	if err := identityCommand(args, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "identity:", err)
		os.Exit(1)
	}
}

func identityCommand(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Fprint(out, identityUsage)
		return nil
	}
	cmd := args[0]
	fs := flag.NewFlagSet("identity "+cmd, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	project := fs.String("project", os.Getenv("CC_PROJECT"), "")
	session := fs.String("session", os.Getenv("CC_SESSION_KEY"), "")
	dataDir := fs.String("data-dir", "", "")
	pubkey := fs.String("pubkey", "", "")
	if err := fs.Parse(args[1:]); err != nil {
		return fmt.Errorf("%w\n%s", err, identityUsage)
	}
	switch cmd {
	case "token", "show":
		tok, claims, err := fetchCallerToken(*dataDir, *project, *session)
		if err != nil {
			return err
		}
		if cmd == "token" {
			fmt.Fprintln(out, tok)
			return nil
		}
		b, _ := json.MarshalIndent(map[string]any{"claims": claims, "token": tok}, "", "  ")
		fmt.Fprintln(out, string(b))
		return nil
	case "pubkey":
		b, err := identityCall(*dataDir, "/identity/pubkey")
		if err != nil {
			// The bridge may be down: the key file is still there (if readable).
			_, pub := core.IdentityKeyPaths(identityDataDir(*dataDir))
			fb, ferr := os.ReadFile(pub)
			if ferr != nil {
				return err
			}
			fmt.Fprint(out, string(fb))
			return nil
		}
		var got struct {
			PubKey string `json:"pubkey"`
		}
		if err := json.Unmarshal(b, &got); err != nil {
			return err
		}
		fmt.Fprintln(out, got.PubKey)
		return nil
	case "verify":
		tok := strings.TrimSpace(strings.Join(fs.Args(), " "))
		if tok == "" || tok == "-" {
			b, _ := io.ReadAll(os.Stdin)
			tok = strings.TrimSpace(string(b))
		}
		keys, err := loadTrustedKeys(*pubkey, *dataDir)
		if err != nil {
			return err
		}
		c, err := core.VerifyCallerToken(tok, keys, time.Now())
		if err != nil {
			return err
		}
		b, _ := json.MarshalIndent(c, "", "  ")
		fmt.Fprintln(out, string(b))
		return nil
	}
	return fmt.Errorf("unknown command %q\n%s", cmd, identityUsage)
}

func identityDataDir(dataDir string) string {
	return filepath.Dir(filepath.Dir(resolveSocketPath(dataDir))) // <dataDir>/run/api.sock → <dataDir>
}

func identityCall(dataDir, path string) ([]byte, error) {
	sock := core.IdentitySocketPath(identityDataDir(dataDir))
	tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", sock)
	}}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 10 * time.Second}
	resp, err := client.Get("http://unix" + path)
	if err != nil {
		return nil, fmt.Errorf("bridge identity socket %s: %w", sock, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != 200 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(b, &e) == nil && e.Error != "" {
			return nil, errors.New(e.Error)
		}
		return nil, fmt.Errorf("bridge: %s", strings.TrimSpace(string(b)))
	}
	return b, nil
}

// fetchCallerToken asks the bridge for a token of the turn running in project/session.
func fetchCallerToken(dataDir, project, session string) (string, core.CallerClaims, error) {
	var got struct {
		Token  string            `json:"token"`
		Claims core.CallerClaims `json:"claims"`
	}
	if project == "" || session == "" {
		return "", got.Claims, errors.New("CC_PROJECT/CC_SESSION_KEY not set; run inside a bot turn or pass --project and --session")
	}
	q := url.Values{"project": {project}, "session": {session}}
	b, err := identityCall(dataDir, "/identity/token?"+q.Encode())
	if err != nil {
		return "", got.Claims, err
	}
	if err := json.Unmarshal(b, &got); err != nil || got.Token == "" {
		return "", got.Claims, fmt.Errorf("unexpected bridge reply %q", b)
	}
	return got.Token, got.Claims, nil
}

// loadTrustedKeys reads comma-separated public key files; with none given it uses this bridge's own
// public key file under the data dir.
func loadTrustedKeys(files, dataDir string) ([]ed25519.PublicKey, error) {
	var paths []string
	for _, f := range strings.Split(files, ",") {
		if f = strings.TrimSpace(f); f != "" {
			paths = append(paths, f)
		}
	}
	if len(paths) == 0 {
		_, pub := core.IdentityKeyPaths(identityDataDir(dataDir))
		paths = []string{pub}
	}
	var keys []ed25519.PublicKey
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			return nil, fmt.Errorf("public key: %w", err)
		}
		for _, line := range strings.Split(string(b), "\n") {
			if line = strings.TrimSpace(line); line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, err := core.ParseIdentityPubKey(line)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", p, err)
			}
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return nil, errors.New("no trusted public key")
	}
	return keys, nil
}
