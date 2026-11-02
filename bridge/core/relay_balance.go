package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Relay balance guard (#837): a member whose agent runs through a prepaid
// new-api relay fails silently once the account balance drops below one turn's
// pre-deduction (the relay answers 403 insufficient_user_quota). The guard reads
// the account balance before a dispatch to that member and refuses the dispatch
// when it cannot pay for one turn, and polls the balance so the user is told to
// top up before it runs out.
//
// Config: <data_dir>/relay-balance.json, keyed by project name:
//
//	{"longniang": {"base_url": "https://relay.example", "user_id": "42",
//	  "token_file": "/path/to/access-token", "round_usd": 0.46,
//	  "notify_project": "maomao", "notify_session": "discord:<chat id>"}}
//
// token_file holds the relay account's system access token (new-api: personal
// settings -> system access token); the API key used for requests cannot read
// the account balance. A project without an entry, or with an unreadable token,
// is not guarded.

const (
	relayBalanceFile      = "relay-balance.json"
	relayBalanceStateFile = "relay-balance-state.json"
	// Source: #837 scope, "低于约 3 轮预扣就提醒".
	relayBalanceWarnTurns = 3
	// Source: relay 403 on 2026-10-31 23:52, "需要预扣费额度: ＄0.461052".
	relayBalanceDefRound = 0.46
	// Source: #837 scope, "定时查"; one reading per half hour keeps a daily warning timely.
	relayBalancePoll = 30 * time.Minute
	// Source: same as relayBalancePoll's purpose; back-to-back dispatches share one reading.
	relayBalanceCacheTTL = 2 * time.Minute
	// Source: new-api default QuotaPerUnit (used only when /api/status omits it).
	relayBalanceDefPerUnit = 500000.0
)

type relayBalanceConf struct {
	BaseURL       string  `json:"base_url"`
	UserID        string  `json:"user_id"`
	TokenFile     string  `json:"token_file"`
	RoundUSD      float64 `json:"round_usd"`
	NotifyProject string  `json:"notify_project"`
	NotifySession string  `json:"notify_session"`
}

func (c relayBalanceConf) round() float64 {
	if c.RoundUSD > 0 {
		return c.RoundUSD
	}
	return relayBalanceDefRound
}

type relayBalanceReading struct {
	usd float64
	at  time.Time
}

type relayBalanceGuard struct {
	dataDir string
	client  *http.Client
	mu      sync.Mutex
	cache   map[string]relayBalanceReading
}

func newRelayBalanceGuard(dataDir string) *relayBalanceGuard {
	return &relayBalanceGuard{
		dataDir: dataDir,
		client:  &http.Client{Timeout: relayTimeoutBalance},
		cache:   make(map[string]relayBalanceReading),
	}
}

// Source: the relay answered /api/usage/token in under a second on 11-01; a
// stuck check must not hold a dispatch longer than this.
const relayTimeoutBalance = 15 * time.Second

// confs re-reads the config each time so an edit takes effect without a restart.
func (g *relayBalanceGuard) confs() map[string]relayBalanceConf {
	if g == nil || g.dataDir == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(g.dataDir, relayBalanceFile))
	if err != nil {
		return nil
	}
	var m map[string]relayBalanceConf
	if json.Unmarshal(raw, &m) != nil {
		slog.Warn("relay balance: bad config", "file", relayBalanceFile)
		return nil
	}
	return m
}

// balance returns the account balance in USD for project. ok is false when the
// balance could not be read (the dispatch then goes ahead: a broken check must
// not block work).
func (g *relayBalanceGuard) balance(ctx context.Context, project string, conf relayBalanceConf, fresh bool) (float64, bool) {
	g.mu.Lock()
	if r, hit := g.cache[project]; hit && !fresh && time.Since(r.at) < relayBalanceCacheTTL {
		g.mu.Unlock()
		return r.usd, true
	}
	g.mu.Unlock()
	usd, err := g.fetch(ctx, conf)
	if err != nil {
		slog.Warn("relay balance: check failed", "project", project, "error", err)
		return 0, false
	}
	g.mu.Lock()
	g.cache[project] = relayBalanceReading{usd: usd, at: time.Now()}
	g.mu.Unlock()
	return usd, true
}

func (g *relayBalanceGuard) fetch(ctx context.Context, conf relayBalanceConf) (float64, error) {
	if conf.BaseURL == "" || conf.TokenFile == "" {
		return 0, fmt.Errorf("base_url or token_file missing")
	}
	tok, err := os.ReadFile(conf.TokenFile)
	if err != nil {
		return 0, fmt.Errorf("read token: %w", err)
	}
	base := strings.TrimRight(conf.BaseURL, "/")
	var self struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Quota float64 `json:"quota"`
		} `json:"data"`
	}
	if err := g.getJSON(ctx, base+"/api/user/self", strings.TrimSpace(string(tok)), conf.UserID, &self); err != nil {
		return 0, err
	}
	if !self.Success {
		return 0, fmt.Errorf("user/self: %s", self.Message)
	}
	perUnit := relayBalanceDefPerUnit
	var status struct {
		Data struct {
			QuotaPerUnit float64 `json:"quota_per_unit"`
		} `json:"data"`
	}
	if g.getJSON(ctx, base+"/api/status", "", "", &status) == nil && status.Data.QuotaPerUnit > 0 {
		perUnit = status.Data.QuotaPerUnit
	}
	return self.Data.Quota / perUnit, nil
}

func (g *relayBalanceGuard) getJSON(ctx context.Context, url, token, userID string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if userID != "" {
		req.Header.Set("New-Api-User", userID)
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// checkDispatch returns a non-nil error when project's relay balance cannot pay
// for one turn. The caller should hand the work to someone else.
func (g *relayBalanceGuard) checkDispatch(ctx context.Context, project, name string) error {
	conf, ok := g.confs()[project]
	if !ok {
		return nil
	}
	usd, ok := g.balance(ctx, project, conf, false)
	if !ok || usd >= conf.round() {
		return nil
	}
	if name == "" {
		name = project
	}
	return fmt.Errorf("relay: %s 的中转余额不够（剩 $%.2f，一轮要预扣约 $%.2f），没有派出去，请改派别人；充值要用户来", name, usd, conf.round())
}

// watch polls every guarded project and warns once a day when the balance
// covers fewer than relayBalanceWarnTurns turns.
func (g *relayBalanceGuard) watch(rm *RelayManager) {
	// Source: engines register after NewRelayManager returns; the first check
	// waits so the notifying engine exists.
	time.Sleep(time.Minute)
	g.checkAll(rm)
	t := time.NewTicker(relayBalancePoll)
	defer t.Stop()
	for range t.C {
		g.checkAll(rm)
	}
}

func (g *relayBalanceGuard) checkAll(rm *RelayManager) {
	for project, conf := range g.confs() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*relayTimeoutBalance)
		usd, ok := g.balance(ctx, project, conf, true)
		cancel()
		if !ok || usd >= conf.round()*relayBalanceWarnTurns {
			continue
		}
		today := time.Now().Format("2006-01-02")
		if g.warnedOn(project) == today {
			continue
		}
		rm.mu.RLock()
		notify := rm.engines[conf.NotifyProject]
		target := rm.engines[project]
		rm.mu.RUnlock()
		if notify == nil || conf.NotifySession == "" {
			slog.Warn("relay balance: low but no notify target", "project", project, "usd", usd)
			continue
		}
		name := project
		if target != nil {
			name = target.DisplayName()
		}
		notify.noticeChannel(conf.NotifySession, fmt.Sprintf(
			"⚠️ %s 的中转余额只剩 $%.2f，大约还够 %d 轮（一轮预扣约 $%.2f），请充值。不够一轮时，派给她的活会被拦下改派。",
			name, usd, int(usd/conf.round()), conf.round()))
		g.markWarned(project, today)
	}
}

func (g *relayBalanceGuard) statePath() string {
	return filepath.Join(g.dataDir, relayBalanceStateFile)
}

func (g *relayBalanceGuard) warnedOn(project string) string {
	raw, err := os.ReadFile(g.statePath())
	if err != nil {
		return ""
	}
	var m map[string]string
	_ = json.Unmarshal(raw, &m)
	return m[project]
}

func (g *relayBalanceGuard) markWarned(project, day string) {
	m := map[string]string{}
	if raw, err := os.ReadFile(g.statePath()); err == nil {
		_ = json.Unmarshal(raw, &m)
	}
	m[project] = day
	raw, _ := json.Marshal(m)
	if err := os.WriteFile(g.statePath(), raw, 0o600); err != nil {
		slog.Warn("relay balance: save state", "error", err)
	}
}
