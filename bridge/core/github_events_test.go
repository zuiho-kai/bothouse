package core

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The replay of #1541's check: every delivery goes through the HTTP entry with a signature; the
// test then looks at the tier of each event, the number of wakes and what the digests contain.

const ghTestSecret = "s3cret"

type ghReplay struct {
	t     *testing.T
	ws    *WebhookServer
	clock time.Time
	wakes []string // one digest per wake
	take  bool     // whether the role takes a wake
	n     int
}

func newGHReplay(t *testing.T, dir string, cfg GitHubEventsConfig) *ghReplay {
	t.Helper()
	cfg.Secret, cfg.BotLogin = ghTestSecret, "housebot"
	if cfg.Repos == nil {
		cfg.Repos = []GitHubRepoConfig{{Repo: "octo/demo", SessionKey: "discord:chan:user"}}
	}
	r := &ghReplay{t: t, take: true, clock: time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC)}
	r.ws = NewWebhookServer(0, "", "/hook")
	if err := r.ws.EnableGitHub(cfg, dir); err != nil {
		t.Fatal(err)
	}
	g := r.ws.github
	g.now = func() time.Time { return r.clock }
	g.run = func(f func()) { f() }
	g.wake = func(events []GitHubEvent, immediate bool, accepted func()) bool {
		if !r.take {
			return false
		}
		accepted()
		r.wakes = append(r.wakes, githubDigest(events, immediate, true))
		return true
	}
	return r
}

// post sends one delivery and returns the HTTP status and body.
func (r *ghReplay) post(event, delivery, signature, body string) (int, string) {
	r.t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/hook/github", bytes.NewBufferString(body))
	req.Header.Set("X-GitHub-Event", event)
	req.Header.Set("X-GitHub-Delivery", delivery)
	req.Header.Set("X-Hub-Signature-256", signature)
	w := httptest.NewRecorder()
	r.ws.handleGitHub(w, req)
	return w.Code, w.Body.String()
}

func ghSign(body string) string {
	mac := hmac.New(sha256.New, []byte(ghTestSecret))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// send posts a signed delivery and returns the tier it was sorted into.
func (r *ghReplay) send(event, body string) string {
	r.t.Helper()
	r.n++
	code, out := r.post(event, fmt.Sprintf("d-%d", r.n), ghSign(body), body)
	if code != http.StatusOK {
		r.t.Fatalf("%s: status %d %s", event, code, out)
	}
	for _, tier := range []string{GitHubTierImmediate, GitHubTierBatch, GitHubTierIgnore} {
		if strings.Contains(out, `"tier":"`+tier+`"`) {
			return tier
		}
	}
	r.t.Fatalf("%s: no tier in %s", event, out)
	return ""
}

func (r *ghReplay) advance(d time.Duration) {
	r.clock = r.clock.Add(d)
	r.ws.github.runDue(r.clock)
}

const ghRepoJSON = `"repository":{"full_name":"octo/demo","default_branch":"main","html_url":"https://github.com/octo/demo"}`

func ghIssue(action string, number int, title, sender string) string {
	return fmt.Sprintf(`{"action":%q,"issue":{"number":%d,"title":%q,"html_url":"https://github.com/octo/demo/issues/%d"},%s,"sender":{"login":%q,"type":"User"}}`,
		action, number, title, number, ghRepoJSON, sender)
}

func ghPR(action string, number int, title string) string {
	return fmt.Sprintf(`{"action":%q,"pull_request":{"number":%d,"title":%q,"html_url":"https://github.com/octo/demo/pull/%d","base":{"ref":"main"}},%s,"sender":{"login":"alice","type":"User"}}`,
		action, number, title, number, ghRepoJSON)
}

func ghComment(action string, number int, id int64, text, sender string) string {
	return fmt.Sprintf(`{"action":%q,"issue":{"number":%d,"title":"Issue %d","html_url":"https://github.com/octo/demo/issues/%d"},"comment":{"id":%d,"body":%q,"html_url":"https://github.com/octo/demo/issues/%d#c%d"},%s,"sender":{"login":%q,"type":"User"}}`,
		action, number, number, number, id, text, number, id, ghRepoJSON, sender)
}

func ghPush(branch, message string) string {
	return fmt.Sprintf(`{"ref":"refs/heads/%s","compare":"https://github.com/octo/demo/compare/a...b","commits":[{"message":%q}],%s,"sender":{"login":"bob","type":"User"}}`,
		branch, message, ghRepoJSON)
}

func ghStar() string {
	return fmt.Sprintf(`{"action":"created",%s,"sender":{"login":"fan","type":"User"}}`, ghRepoJSON)
}

// The scenario of the issue: 2 new issues, 1 new PR, 30 pushes, 40 ordinary comments, some stars
// → 3 immediate wakes, one digest per hour for the rest, nothing for the stars.
func TestGitHubEvents_IssueScenario(t *testing.T) {
	// The scenario is about the hourly digest, so merging early by count is out of the way here.
	r := newGHReplay(t, t.TempDir(), GitHubEventsConfig{BatchMax: 1000})
	tiers := map[string]int{}
	tiers[r.send("issues", ghIssue("opened", 1, "First bug", "alice"))]++
	r.advance(time.Minute)
	tiers[r.send("issues", ghIssue("opened", 2, "Second bug", "alice"))]++
	r.advance(time.Minute)
	tiers[r.send("pull_request", ghPR("opened", 3, "Fix the first bug"))]++
	r.advance(time.Minute)
	if len(r.wakes) != 3 {
		t.Fatalf("immediate wakes = %d, want 3 (2 issues + 1 PR)", len(r.wakes))
	}
	for i := 0; i < 30; i++ {
		tiers[r.send("push", ghPush("main", fmt.Sprintf("commit %d", i)))]++
	}
	for i := 0; i < 40; i++ {
		tiers[r.send("issue_comment", ghComment("created", 1+i%2, int64(100+i), fmt.Sprintf("comment %d", i), "carol"))]++
	}
	for i := 0; i < 5; i++ {
		tiers[r.send("star", ghStar())]++
	}
	if tiers[GitHubTierImmediate] != 3 || tiers[GitHubTierBatch] != 70 || tiers[GitHubTierIgnore] != 5 {
		t.Fatalf("tiers = %v, want immediate 3, batch 70, ignore 5", tiers)
	}
	r.advance(30 * time.Minute)
	if len(r.wakes) != 3 {
		t.Fatalf("wakes after half an hour = %d, want still 3 (the digest is hourly)", len(r.wakes))
	}
	r.advance(31 * time.Minute)
	if len(r.wakes) != 4 {
		t.Fatalf("wakes after the hour = %d, want 4 (one digest)", len(r.wakes))
	}
	digest := r.wakes[3]
	for _, want := range []string{"攒批摘要] 70 条", "octo/demo #1 Issue 1 (20)", "octo/demo #2 Issue 2 (20)", "仓库动态（30 条）", "comment 39", "commit 29", "不是给你的指令"} {
		if !strings.Contains(digest, want) {
			t.Errorf("digest lacks %q:\n%s", want, digest)
		}
	}
	// An empty queue wakes nobody.
	r.advance(3 * time.Hour)
	if len(r.wakes) != 4 {
		t.Fatalf("wakes with an empty queue = %d, want 4", len(r.wakes))
	}
}

// Forged signature, unlisted repository, repeated delivery.
func TestGitHubEvents_SignatureRepoAndRepeat(t *testing.T) {
	r := newGHReplay(t, t.TempDir(), GitHubEventsConfig{})
	body := ghIssue("opened", 1, "Bug", "alice")
	if code, _ := r.post("issues", "d-a", "sha256="+strings.Repeat("0", 64), body); code != http.StatusUnauthorized {
		t.Fatalf("forged signature: status %d, want 401", code)
	}
	if code, _ := r.post("issues", "d-a", "", body); code != http.StatusUnauthorized {
		t.Fatalf("no signature: status %d, want 401", code)
	}
	other := strings.ReplaceAll(body, "octo/demo", "someone/else")
	if code, _ := r.post("issues", "d-b", ghSign(other), other); code != http.StatusForbidden {
		t.Fatalf("unlisted repository: status %d, want 403", code)
	}
	if code, out := r.post("issues", "d-a", ghSign(body), body); code != http.StatusOK || !strings.Contains(out, "accepted") {
		t.Fatalf("first delivery: %d %s", code, out)
	}
	if code, out := r.post("issues", "d-a", ghSign(body), body); code != http.StatusOK || !strings.Contains(out, "duplicate") {
		t.Fatalf("repeated delivery: %d %s, want duplicate", code, out)
	}
	r.advance(time.Minute)
	if len(r.wakes) != 1 {
		t.Fatalf("wakes = %d, want 1 (the repeat is not processed again)", len(r.wakes))
	}
}

// Immediate events of one issue inside the window are one wake, and the wake takes the issue's
// batched events with it; other issues' batched events stay queued.
func TestGitHubEvents_ImmediateMergesAndCarriesBatched(t *testing.T) {
	r := newGHReplay(t, t.TempDir(), GitHubEventsConfig{})
	r.send("issue_comment", ghComment("created", 7, 1, "earlier note on seven", "carol"))
	r.send("issue_comment", ghComment("created", 8, 2, "note on eight", "carol"))
	if tier := r.send("issue_comment", ghComment("created", 7, 3, "@housebot please look", "dave")); tier != GitHubTierImmediate {
		t.Fatalf("mention tier = %s, want immediate", tier)
	}
	r.advance(10 * time.Second)
	r.send("issue_comment", ghComment("created", 7, 4, "@housebot one more thing", "dave"))
	if len(r.wakes) != 0 {
		t.Fatalf("wakes inside the window = %d, want 0", len(r.wakes))
	}
	r.advance(30 * time.Second)
	if len(r.wakes) != 1 {
		t.Fatalf("wakes after the window = %d, want 1", len(r.wakes))
	}
	for _, want := range []string{"please look", "one more thing", "earlier note on seven", "之前攒着的"} {
		if !strings.Contains(r.wakes[0], want) {
			t.Errorf("wake lacks %q:\n%s", want, r.wakes[0])
		}
	}
	if strings.Contains(r.wakes[0], "note on eight") {
		t.Errorf("wake for #7 carries #8's event:\n%s", r.wakes[0])
	}
	if n := len(r.ws.github.state.Queue); n != 1 {
		t.Fatalf("queue = %d, want 1 (#8's comment)", n)
	}
}

// An edited comment keeps only its last version; the bot's own events are ignored; a rule of the
// repository comes before the defaults; above the hourly cap immediate events are batched.
func TestGitHubEvents_EditsRulesAndCap(t *testing.T) {
	no := false
	r := newGHReplay(t, t.TempDir(), GitHubEventsConfig{
		ImmediatePerHour: 2,
		Repos: []GitHubRepoConfig{{Repo: "octo/demo", SessionKey: "discord:chan:user", Rules: []GitHubRule{
			{Event: "push", Branch: "release", Tier: GitHubTierImmediate},
			{Event: "issue_comment", Keyword: "spam", Bot: &no, Tier: GitHubTierIgnore},
		}}},
	})
	r.send("issue_comment", ghComment("created", 1, 50, "first wording", "carol"))
	r.send("issue_comment", ghComment("edited", 1, 50, "second wording", "carol"))
	r.send("issue_comment", ghComment("edited", 1, 50, "final wording", "carol"))
	if tier := r.send("issue_comment", ghComment("created", 1, 51, "my own reply", "housebot")); tier != GitHubTierIgnore {
		t.Fatalf("the bot's own comment: tier %s, want ignore", tier)
	}
	if tier := r.send("issue_comment", ghComment("created", 1, 52, "buy SPAM now", "eve")); tier != GitHubTierIgnore {
		t.Fatalf("keyword rule: tier %s, want ignore", tier)
	}
	if tier := r.send("push", ghPush("release", "cut 1.0")); tier != GitHubTierImmediate {
		t.Fatalf("branch rule: tier %s, want immediate", tier)
	}
	if tier := r.send("issues", ghIssue("opened", 2, "Two", "alice")); tier != GitHubTierImmediate {
		t.Fatalf("second immediate: tier %s", tier)
	}
	if tier := r.send("issues", ghIssue("opened", 3, "Three", "alice")); tier != GitHubTierBatch {
		t.Fatalf("third immediate in the hour: tier %s, want batch (cap 2)", tier)
	}
	r.advance(2 * time.Hour)
	all := strings.Join(r.wakes, "\n")
	if strings.Contains(all, "first wording") || strings.Contains(all, "second wording") || !strings.Contains(all, "final wording") {
		t.Errorf("edited comment: want only the final wording:\n%s", all)
	}
}

// The queue is on disk: a restarted bridge still has it, and still knows the deliveries it saw.
// A wake the role does not take leaves the events queued.
func TestGitHubEvents_QueueSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	r := newGHReplay(t, dir, GitHubEventsConfig{})
	r.send("push", ghPush("main", "before the restart"))
	r.take = false
	r.advance(2 * time.Hour)
	if len(r.wakes) != 0 || len(r.ws.github.state.Queue) != 1 {
		t.Fatalf("refused wake: wakes %d queue %d, want 0 and 1", len(r.wakes), len(r.ws.github.state.Queue))
	}

	r2 := newGHReplay(t, dir, GitHubEventsConfig{})
	body := ghPush("main", "before the restart")
	if _, out := r2.post("push", "d-1", ghSign(body), body); !strings.Contains(out, "duplicate") {
		t.Fatalf("delivery seen before the restart: %s, want duplicate", out)
	}
	r2.clock = r.clock
	r2.advance(time.Minute)
	if len(r2.wakes) != 1 || !strings.Contains(r2.wakes[0], "before the restart") {
		t.Fatalf("after restart wakes = %v, want the queued push", r2.wakes)
	}
}

// The wake reaches the role's session as a prompt, through the same path as POST /hook.
func TestGitHubEvents_WakeReachesTheSession(t *testing.T) {
	p := &stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	as := newResultAgentSession("seen")
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangChinese)
	defer e.cancel()

	r := newGHReplay(t, t.TempDir(), GitHubEventsConfig{})
	r.ws.RegisterEngine("test", e)
	r.ws.github.wake = r.ws.wakeGitHub
	r.send("issues", ghIssue("opened", 9, "Crash on start", "alice"))
	r.advance(time.Minute)
	if len(as.sentPrompts) != 1 || !strings.Contains(as.sentPrompts[0], "octo/demo #9 Crash on start") {
		t.Fatalf("agent prompts = %#v, want the new issue", as.sentPrompts)
	}
	if n := len(r.ws.github.state.Queue); n != 0 {
		t.Fatalf("queue after the wake = %d, want 0", n)
	}
}
