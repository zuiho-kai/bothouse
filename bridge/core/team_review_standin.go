package core

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Stand-in reviews on the tier model (user 2026-11-04「简单的交给便宜模型」, follow-up to #974):
// when a tier's role is cooling or wrote the work, the role that reviews instead still runs on
// the tier's chosen model when its backend offers it; when no role can, a simple review goes to
// the cheapest role. A model the reviewer's backend would ignore is logged and shown on the
// settings page instead of passing silently.

// taskReviewTierModelID: the model chosen for it's tier in settings ("" = none).
func taskReviewTierModelID(it teamTaskBoardItem) string {
	m := teamReviewModels.Load()
	if m == nil {
		return ""
	}
	if taskReviewComplex(it) {
		return m[1]
	}
	return m[0]
}

// taskReviewModelFor: the model x reviews it on. The tier's role always gets the tier model; a
// stand-in gets it only when its backend lists it, else it keeps its own model.
func taskReviewModelFor(it teamTaskBoardItem, x *Engine) string {
	m := taskReviewTierModelID(it)
	if m == "" || x == nil {
		return ""
	}
	if x.name == taskReviewTierRole(it) {
		if ok, why := x.reviewModelSupport(m); !ok {
			noteReviewModelIgnored(it, x.name, m, why)
		}
		return m
	}
	if ok, _ := x.reviewModelSupport(m); ok {
		return m
	}
	return ""
}

// rankTaskReviewStandIns orders the roles that may review in place of an unavailable tier role:
// those whose backend offers the tier model first; then, for a simple review, the cheapest
// current model. ranked is false when neither applies (complex review, nobody offers its model):
// the usual idle-first pick stays. The sort is stable, so the designated reviewer and the
// least-loaded role still win ties.
func rankTaskReviewStandIns(it teamTaskBoardItem, cands []*Engine, chat string) (ranked bool) {
	if len(cands) == 0 {
		return false
	}
	m := taskReviewTierModelID(it)
	can := map[*Engine]bool{}
	anyCan := false
	if m != "" {
		for _, x := range cands {
			ok, _ := x.reviewModelSupport(m)
			can[x] = ok
			anyCan = anyCan || ok
		}
	}
	simple := !taskReviewComplex(it)
	if !anyCan && !simple {
		return false
	}
	price := map[*Engine]float64{}
	for _, x := range cands {
		price[x] = x.reviewModelPrice(chat)
	}
	sort.SliceStable(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if can[a] != can[b] {
			return can[a]
		}
		if simple && price[a] != price[b] {
			return price[a] < price[b]
		}
		return false
	})
	if m != "" && !can[cands[0]] {
		noteReviewModelIgnored(it, cands[0].name, m, "代审角色的后端都没有这个模型，改用最便宜的角色自己的模型")
	}
	return true
}

// teamReviewPrices: the usage price table (config usage_prices over the built-in rates), set
// at startup; nil = the built-in rates.
var teamReviewPrices atomic.Pointer[map[string]TokenPrice]

// SetTeamReviewPrices sets the rates used to rank stand-in reviewers by cost (the same table
// the usage page prices with, UsagePricesWithDefaults).
func SetTeamReviewPrices(p map[string]TokenPrice) {
	teamReviewPrices.Store(&p)
}

// reviewModelPrice: input+output rate per million tokens of the model e answers chat on;
// +Inf when it is unknown or unpriced, so a role of unknown cost ranks after priced ones.
func (e *Engine) reviewModelPrice(chat string) float64 {
	model := e.sessionSettingsFor(chat).Model
	if model == "" {
		if ms, ok := e.agent.(ModelSwitcher); ok {
			model = ms.GetModel()
		}
	}
	if model == "" {
		return math.Inf(1)
	}
	prices := defaultUsagePrices
	if p := teamReviewPrices.Load(); p != nil && *p != nil {
		prices = *p
	}
	if p, ok := lookupPrice(prices, model); ok {
		return p.Input + p.Output
	}
	return math.Inf(1)
}

// reviewModelListTimeout follows the settings page's model list fetch (management.go
// handleProjectModels, 10s).
const reviewModelListTimeout = 10 * time.Second

type reviewModelSupportEntry struct {
	at  time.Time
	ok  bool
	why string
}

var (
	reviewModelSupportMu    sync.Mutex
	reviewModelSupportCache = map[*Engine]map[string]reviewModelSupportEntry{}
)

// reviewModelSupport: whether e's backend can start a session on model, and why not. The list
// can come from the provider API, so a result is kept for one reconcile period
// (teamWorkspaceReconcileEvery) rather than fetched on every scan.
func (e *Engine) reviewModelSupport(model string) (bool, string) {
	now := time.Now()
	reviewModelSupportMu.Lock()
	if c, ok := reviewModelSupportCache[e][model]; ok && now.Sub(c.at) < teamWorkspaceReconcileEvery {
		reviewModelSupportMu.Unlock()
		return c.ok, c.why
	}
	reviewModelSupportMu.Unlock()
	ok, why := e.reviewModelSupportNow(model)
	reviewModelSupportMu.Lock()
	if reviewModelSupportCache[e] == nil {
		reviewModelSupportCache[e] = map[string]reviewModelSupportEntry{}
	}
	reviewModelSupportCache[e][model] = reviewModelSupportEntry{at: now, ok: ok, why: why}
	reviewModelSupportMu.Unlock()
	return ok, why
}

func (e *Engine) reviewModelSupportNow(model string) (bool, string) {
	ms, ok := e.agent.(ModelSwitcher)
	if !ok {
		return false, "这个角色的后端不支持换模型，会按它自己的模型跑"
	}
	if strings.EqualFold(ms.GetModel(), model) {
		return true, ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), reviewModelListTimeout)
	defer cancel()
	for _, o := range ms.AvailableModels(ctx) {
		if strings.EqualFold(o.Name, model) || (o.Alias != "" && strings.EqualFold(o.Alias, model)) {
			return true, ""
		}
	}
	return false, "这个模型不在该角色后端的模型列表里，后端可能忽略它"
}

// ReviewModelNotice is the latest case of a review model that would not take effect, for the
// settings page.
type ReviewModelNotice struct {
	At     time.Time `json:"at"`
	Board  int       `json:"board"`
	Tier   string    `json:"tier"` // "simple" or "complex"
	Role   string    `json:"role"`
	Model  string    `json:"model"`
	Reason string    `json:"reason"`
}

var teamReviewModelNotice atomic.Pointer[ReviewModelNotice]

// TeamReviewModelNotice: the latest ignored-model case, nil when none since startup.
func TeamReviewModelNotice() *ReviewModelNotice {
	return teamReviewModelNotice.Load()
}

func noteReviewModelIgnored(it teamTaskBoardItem, role, model, why string) {
	tier := "simple"
	if taskReviewComplex(it) {
		tier = "complex"
	}
	slog.Warn("task review: tier model will not take effect", "board", it.ID, "tier", tier, "role", role, "model", model, "reason", why)
	teamReviewModelNotice.Store(&ReviewModelNotice{At: time.Now(), Board: it.ID, Tier: tier, Role: role, Model: model, Reason: why})
}

// noteTurnModelIgnored: a side turn asked for a model its agent cannot switch to (checked again
// at run time; the role may have changed backend since the review was queued).
func noteTurnModelIgnored(job *TimerJob, agent Agent, role string) {
	if job.Model == "" {
		return
	}
	if _, ok := agent.(ModelSwitcher); ok {
		return
	}
	board := 0
	if job.TaskReview != nil {
		board = job.TaskReview.Board
	}
	tier := "simple"
	if job.TaskReview != nil && job.TaskReview.Tier == "complex" {
		tier = "complex"
	}
	why := fmt.Sprintf("%s 的后端不支持换模型，这一轮按它自己的模型跑", agent.Name())
	slog.Warn("timer: side turn model ignored by agent", "job", job.ID, "role", role, "model", job.Model, "agent", agent.Name())
	teamReviewModelNotice.Store(&ReviewModelNotice{At: time.Now(), Board: board, Tier: tier, Role: role, Model: job.Model, Reason: why})
}
