package core

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Shared with dsh/collab/credentials.mjs; the plugin loads this file on startup.
const collabCredentialsFile = "cloud-web-bot-tokens.json"

// 来源：dsh/collab/identity.mjs memberId, including its reserved human/system identities.
var collabMemberID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

func collabSetupDir(req WizardRequest) string {
	if req.CloudWeb == nil {
		return ""
	}
	return strings.TrimSpace(req.CloudWeb.CollabDataDir)
}

func validCollabID(id string) bool {
	return collabMemberID.MatchString(id) && id != "owner" && id != "user" && id != "system"
}

// provisionCollab writes the server's credential map before handing matching tokens
// to the client config writer. A failed client write leaves reusable, unused credentials;
// rerunning never rotates existing identities. The exclusive file prevents lost updates
// across wizard processes; a stale lock fails explicitly rather than overwriting a file.
func provisionCollab(dir string, pl *wizardPlan, dryRun bool) error {
	if !filepath.IsAbs(dir) {
		return errors.New("collab_data_dir must be the collab server's absolute dataDir")
	}
	ids := map[string]bool{}
	for _, w := range pl.writes {
		if w.PlatformType != "cloud_web" {
			continue
		}
		u, _ := w.Options["ws_url"].(string)
		id := cloudWebQuery(u, "bot")
		if !validCollabID(id) || ids[id] {
			return errors.New("collab bot id must be a lowercase slug, not owner, user or system")
		}
		ids[id] = true
	}
	if len(ids) != 0 {
		if err := checkCollabMemberIDs(dir, ids); err != nil {
			return err
		}
	}
	path := filepath.Join(dir, collabCredentialsFile)
	if !dryRun {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("prepare collab credentials directory: %w", err)
		}
		lock, err := os.OpenFile(path+".lock", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return errors.New("collab credentials are locked or not writable; check the credentials lock file")
		}
		defer func() { _ = lock.Close(); _ = os.Remove(path + ".lock") }()
	}
	tokens := map[string]string{}
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return errors.New("collab credentials must be a regular private file (chmod 600)")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return errors.New("cannot read collab credentials")
		}
		if json.Unmarshal(b, &tokens) != nil || tokens == nil {
			return errors.New("invalid collab credentials JSON object")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return errors.New("cannot inspect collab credentials")
	}
	seen := map[string]bool{}
	for id, token := range tokens {
		if !validCollabID(id) || strings.TrimSpace(token) == "" || seen[token] {
			return errors.New("invalid or duplicate collab credential identity/secret")
		}
		seen[token] = true
	}
	changed := false
	for id := range ids {
		if tokens[id] == "" && !dryRun {
			tokens[id] = rand.Text() // source: crypto/rand.Text provides at least 128 bits of entropy.
			changed = true
		}
	}
	if changed {
		if err := writeJSONFile(path, tokens, 0o600); err != nil {
			return fmt.Errorf("save collab credentials: %w", err)
		}
	}
	for i := range pl.writes {
		w := &pl.writes[i]
		u, _ := w.Options["ws_url"].(string)
		if token := tokens[cloudWebQuery(u, "bot")]; token != "" && w.PlatformType == "cloud_web" {
			w.Options["token"] = token
		}
	}
	return nil
}

// DSH already requires a Node runtime with node:sqlite. Read its initialized roster
// without importing a database driver into core or opening/migrating production data.
// Config seeds and removed members both reserve their identities in this table.
func checkCollabMemberIDs(dir string, ids map[string]bool) error {
	dbPath := filepath.Join(dir, "collab.sqlite3")
	if info, err := os.Lstat(dbPath); err != nil || !info.Mode().IsRegular() {
		return errors.New("initialize the DSH collab server once before provisioning credentials; use its exact dataDir")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	const script = "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1], { readOnly: true }); try { console.log(JSON.stringify(db.prepare('SELECT id FROM members').all().map(r => r.id))); } finally { db.close(); }"
	b, err := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script, dbPath).Output()
	if err != nil {
		return errors.New("cannot read the DSH member roster; ensure Node with node:sqlite is available and the collab database is initialized")
	}
	var members []string
	if json.Unmarshal(b, &members) != nil {
		return errors.New("invalid DSH member roster")
	}
	for _, id := range members {
		if ids[id] {
			return errors.New("bot identity conflicts with an existing DSH member; choose a different bot id before provisioning credentials")
		}
	}
	return nil
}
