package core

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// GitHub repository events (#1541), the parts with state: the HTTP entry (signature, repeats),
// the queue on disk and the timer that merges it. See github_events.go for the rules.
//
// Files under <data dir>/github-events:
//
//	queue.json      events that still owe a wake, and the immediate wakes of the last hour
//	deliveries.log  every X-GitHub-Delivery handled, one per line (a repeat is answered, not processed)
//	events.jsonl    every event with its tier, in order of arrival
//	payloads/       the raw payload of each delivery

var errGitHubRepoNotListed = errors.New("repository is not listed in [webhook.github]")

// A delivery id names the payload file, so it must be a plain GUID-like token.
var githubDeliveryID = regexp.MustCompile(`^[A-Za-z0-9-]+$`)

// 来源：GitHub 文档「Webhook events and payloads」：payload 上限 25 MB。
const githubMaxPayload = 25 << 20

type githubQueued struct {
	GitHubEvent
	sending bool // handed to a wake that has not been accepted yet
}

// target is where the event's wake goes: role, channel and repository.
func (q *githubQueued) target() string {
	return q.Project + "\x00" + q.SessionKey + "\x00" + strings.ToLower(q.Repo)
}

type githubState struct {
	Queue []*githubQueued        `json:"queue"`
	Wakes map[string][]time.Time `json:"wakes,omitempty"` // repository → immediate wakes in the last hour
}

type githubEvents struct {
	cfg GitHubEventsConfig
	dir string
	now func() time.Time
	// wake hands the events to the role as one prompt. accepted is called once the prompt has the
	// session or is queued behind the running turn; false = not taken, the events stay queued.
	wake func(events []GitHubEvent, immediate bool, accepted func()) bool
	run  func(func()) // how a wake is started; a goroutine outside tests

	mu      sync.Mutex
	state   githubState
	seen    map[string]bool
	hold    map[string]time.Time // target → no wake before this time (the last one was not taken)
	timer   *time.Timer
	started bool
}

func newGitHubEvents(cfg GitHubEventsConfig, dataDir string) (*githubEvents, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	dir := filepath.Join(dataDir, "github-events")
	// 沿用已有配置：目录、文件权限同 NewCronStore（cron.go）。
	if err := os.MkdirAll(filepath.Join(dir, "payloads"), 0o755); err != nil {
		return nil, err
	}
	g := &githubEvents{
		cfg: cfg, dir: dir, now: time.Now,
		run:  func(f func()) { go f() },
		seen: map[string]bool{}, hold: map[string]time.Time{},
	}
	if data, err := os.ReadFile(filepath.Join(dir, "queue.json")); err == nil {
		if err := json.Unmarshal(data, &g.state); err != nil {
			return nil, fmt.Errorf("webhook.github: read queue: %w", err)
		}
	}
	if g.state.Wakes == nil {
		g.state.Wakes = map[string][]time.Time{}
	}
	if f, err := os.Open(filepath.Join(dir, "deliveries.log")); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			g.seen[sc.Text()] = true
		}
		f.Close()
	}
	return g, nil
}

func (g *githubEvents) saveLocked() {
	data, err := json.MarshalIndent(g.state, "", "  ")
	if err == nil {
		err = AtomicWriteFile(filepath.Join(g.dir, "queue.json"), data, 0o644) // 沿用已有配置：同 CronStore.save
	}
	if err != nil {
		slog.Error("webhook: github queue not saved", "error", err)
	}
}

func (g *githubEvents) appendLine(name, line string) {
	f, err := os.OpenFile(filepath.Join(g.dir, name), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644) // 沿用已有配置：同 CronStore.save
	if err == nil {
		_, err = f.WriteString(line + "\n")
		f.Close()
	}
	if err != nil {
		slog.Error("webhook: github log not written", "file", name, "error", err)
	}
}

// accept takes one verified delivery: normalize, sort into a tier, log, and queue what owes a
// wake. A repeated delivery returns duplicate = true and changes nothing.
func (g *githubEvents) accept(eventType, delivery string, body []byte) (ev GitHubEvent, duplicate bool, err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.seen[delivery] {
		return ev, true, nil
	}
	now := g.now()
	ev, err = normalizeGitHubEvent(eventType, delivery, body, g.cfg.BotLogin, now)
	if err != nil {
		return ev, false, err
	}
	repo := g.cfg.repo(ev.Repo)
	if repo == nil {
		return ev, false, errGitHubRepoNotListed
	}
	classifyGitHubEvent(repo, &ev)
	q := &githubQueued{GitHubEvent: ev}

	if ev.Tier == GitHubTierImmediate && !g.immediateOwedLocked(q) {
		// A new wake: it counts against the repository's hourly cap; above the cap it is batched.
		key := strings.ToLower(ev.Repo)
		var recent []time.Time
		for _, t := range g.state.Wakes[key] {
			if now.Sub(t) < time.Hour { // #1541 「每仓库每小时立即叫醒设上限」
				recent = append(recent, t)
			}
		}
		if len(recent) >= g.cfg.immediatePerHour() {
			q.Tier, q.Reason = GitHubTierBatch, ev.Reason+"; over the hourly cap, batched"
		} else {
			recent = append(recent, now)
		}
		g.state.Wakes[key] = recent
	}
	if q.Tier != GitHubTierIgnore {
		if q.CommentID != 0 {
			// A comment edited several times: only the last version stays queued.
			kept := g.state.Queue[:0]
			for _, old := range g.state.Queue {
				if old.sending || old.CommentID != q.CommentID || !strings.EqualFold(old.Repo, q.Repo) {
					kept = append(kept, old)
				}
			}
			g.state.Queue = kept
		}
		g.state.Queue = append(g.state.Queue, q)
		g.saveLocked()
	}

	g.seen[delivery] = true
	g.appendLine("deliveries.log", delivery)
	if err := os.WriteFile(filepath.Join(g.dir, "payloads", delivery+".json"), body, 0o644); err != nil { // 沿用已有配置：同 CronStore.save
		slog.Error("webhook: github payload not kept", "delivery", delivery, "error", err)
	}
	if line, err := json.Marshal(q.GitHubEvent); err == nil {
		g.appendLine("events.jsonl", string(line))
	}
	slog.Info("webhook: github event", "repo", q.Repo, "kind", q.Kind, "tier", q.Tier, "reason", q.Reason, "delivery", delivery)
	g.scheduleLocked()
	return q.GitHubEvent, false, nil
}

// immediateOwedLocked: an immediate wake for the same issue/PR is already waiting in its window.
func (g *githubEvents) immediateOwedLocked(q *githubQueued) bool {
	if q.Number == 0 {
		return false
	}
	for _, old := range g.state.Queue {
		if !old.sending && old.Tier == GitHubTierImmediate && old.Number == q.Number && old.target() == q.target() {
			return true
		}
	}
	return false
}

type githubWake struct {
	events    []*githubQueued
	immediate bool
}

// dueLocked returns the wakes owed at now, and when the next one is owed (zero: nothing queued).
//
//   - an immediate event: one merge window after the first immediate event of its issue/PR; the
//     wake takes everything queued for that issue/PR with it;
//   - batched events of one repository and target: one batch interval after the oldest, or as
//     soon as there are batchMax of them. An empty queue owes nothing.
func (g *githubEvents) dueLocked(now time.Time) (due []githubWake, next time.Time) {
	var targets []string
	byTarget := map[string][]*githubQueued{}
	for _, q := range g.state.Queue {
		if q.sending {
			continue
		}
		t := q.target()
		if _, ok := byTarget[t]; !ok {
			targets = append(targets, t)
		}
		byTarget[t] = append(byTarget[t], q)
	}
	owe := func(target string, at time.Time, w githubWake) {
		if hold := g.hold[target]; at.Before(hold) {
			at = hold
		}
		if !now.Before(at) {
			due = append(due, w)
		} else if next.IsZero() || at.Before(next) {
			next = at
		}
	}
	for _, t := range targets {
		taken := map[*githubQueued]bool{}
		for _, q := range byTarget[t] {
			if taken[q] || q.Tier != GitHubTierImmediate {
				continue
			}
			w := githubWake{immediate: true}
			for _, other := range byTarget[t] {
				if other == q || (q.Number != 0 && other.Number == q.Number) {
					w.events = append(w.events, other)
					taken[other] = true
				}
			}
			owe(t, q.At.Add(g.cfg.immediateMerge()), w)
		}
		var batch githubWake
		for _, q := range byTarget[t] {
			if !taken[q] {
				batch.events = append(batch.events, q)
			}
		}
		if len(batch.events) == 0 {
			continue
		}
		at := batch.events[0].At.Add(g.cfg.batchInterval())
		if len(batch.events) >= g.cfg.batchMax() {
			at = now
		}
		owe(t, at, batch)
	}
	return due, next
}

// runDue starts every wake owed at now.
func (g *githubEvents) runDue(now time.Time) {
	g.mu.Lock()
	due, _ := g.dueLocked(now)
	for _, w := range due {
		for _, q := range w.events {
			q.sending = true
		}
	}
	g.scheduleLocked()
	g.mu.Unlock()
	for _, w := range due {
		w := w
		g.run(func() { g.deliver(w) })
	}
}

func (g *githubEvents) deliver(w githubWake) {
	events := make([]GitHubEvent, len(w.events))
	for i, q := range w.events {
		events[i] = q.GitHubEvent
	}
	taken := g.wake(events, w.immediate, func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		gone := map[*githubQueued]bool{}
		for _, q := range w.events {
			gone[q] = true
		}
		kept := g.state.Queue[:0]
		for _, q := range g.state.Queue {
			if !gone[q] {
				kept = append(kept, q)
			}
		}
		g.state.Queue = kept
		g.saveLocked()
	})
	if taken {
		return
	}
	// Not taken (role paused, queue full, channel unreachable): the events stay on disk and are
	// tried again one batch interval later.
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, q := range w.events {
		q.sending = false
	}
	g.hold[w.events[0].target()] = g.now().Add(g.cfg.batchInterval())
	g.scheduleLocked()
}

// scheduleLocked arms the one timer for the next owed wake.
func (g *githubEvents) scheduleLocked() {
	if !g.started {
		return
	}
	if g.timer != nil {
		g.timer.Stop()
		g.timer = nil
	}
	now := g.now()
	due, next := g.dueLocked(now)
	switch {
	case len(due) > 0:
		next = now
	case next.IsZero():
		return
	}
	g.timer = time.AfterFunc(next.Sub(now), func() { g.runDue(g.now()) })
}

func (g *githubEvents) start() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.started = true
	g.scheduleLocked()
}

func (g *githubEvents) stop() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.started = false
	if g.timer != nil {
		g.timer.Stop()
		g.timer = nil
	}
}

func validGitHubSignature(secret string, body []byte, header string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(header))
}

// EnableGitHub turns on <webhook path>/github with the given [webhook.github] settings. Call
// before Start.
func (ws *WebhookServer) EnableGitHub(cfg GitHubEventsConfig, dataDir string) error {
	g, err := newGitHubEvents(cfg, dataDir)
	if err != nil {
		return err
	}
	g.wake = ws.wakeGitHub
	ws.github = g
	return nil
}

func (ws *WebhookServer) wakeGitHub(events []GitHubEvent, immediate bool, accepted func()) bool {
	first := events[0]
	engine, err := ws.resolveEngine(first.Project)
	if err != nil {
		slog.Error("webhook: github wake has no role", "repo", first.Repo, "error", err)
		return false
	}
	label := "github " + first.Repo
	if immediate && first.Number != 0 {
		label += fmt.Sprintf(" #%d", first.Number)
	}
	prompt := githubDigest(events, immediate, engine.i18n.IsZhLike())
	return ws.deliverPrompt(engine, first.SessionKey, prompt, false, label, accepted)
}

// handleGitHub is POST <webhook path>/github: a native GitHub webhook. Only a request signed with
// the configured secret, for a listed repository, is taken; the wake itself happens after the reply.
func (ws *WebhookServer) handleGitHub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, githubMaxPayload))
	if err != nil {
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}
	if !validGitHubSignature(ws.github.cfg.Secret, body, r.Header.Get("X-Hub-Signature-256")) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}
	eventType, delivery := r.Header.Get("X-GitHub-Event"), r.Header.Get("X-GitHub-Delivery")
	if eventType == "" || !githubDeliveryID.MatchString(delivery) {
		http.Error(w, "X-GitHub-Event and X-GitHub-Delivery are required", http.StatusBadRequest)
		return
	}
	if eventType == "ping" {
		apiJSON(w, http.StatusOK, map[string]string{"status": "pong"})
		return
	}
	ev, duplicate, err := ws.github.accept(eventType, delivery, body)
	switch {
	case errors.Is(err, errGitHubRepoNotListed):
		http.Error(w, err.Error(), http.StatusForbidden)
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadRequest)
	case duplicate:
		apiJSON(w, http.StatusOK, map[string]string{"status": "duplicate", "delivery": delivery})
	default:
		apiJSON(w, http.StatusOK, map[string]string{"status": "accepted", "delivery": delivery, "kind": ev.Kind, "tier": ev.Tier})
	}
}
