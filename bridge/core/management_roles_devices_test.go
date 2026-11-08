package core

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestManagementRolesAndDevices(t *testing.T) {
	mgmt := NewManagementServer(0, "test-token", nil)

	plat1 := &stubPlatform{n: "discord"}
	plat2 := &stubPlatform{n: "telegram"}

	// Create a dummy engine
	e := &Engine{
		name:              "caihongmao",
		agent:             &stubAgent{},
		sessions:          NewSessionManager(""),
		interactiveStates: make(map[string]*interactiveState),
		platforms:         []Platform{plat1, plat2},
		platformReady:     map[Platform]bool{plat1: true, plat2: false},
	}
	mgmt.RegisterEngine("caihongmao", e)

	handler := mgmt.buildHandler(http.NewServeMux())

	// 1. GET /api/v1/roles (initially idle, plat1 ready, plat2 not ready)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /roles status = %d, want 200", w.Code)
	}

	var rolesResp struct {
		Ok   bool `json:"ok"`
		Data struct {
			Roles []RoleInfo `json:"roles"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if len(rolesResp.Data.Roles) != 1 {
		t.Fatalf("expected 1 role, got %d", len(rolesResp.Data.Roles))
	}
	role := rolesResp.Data.Roles[0]
	if role.Name != "caihongmao" || role.CurrentTask != "空闲" || role.Paused || !role.Online {
		t.Fatalf("unexpected role data: %+v", role)
	}
	if role.DisplayName != "caihongmao" {
		t.Fatalf("display_name without team_name = %q, want the project name", role.DisplayName)
	}
	if len(role.Platforms) != 2 {
		t.Fatalf("expected 2 platforms, got %d", len(role.Platforms))
	}
	if !role.Platforms[0].Ready || role.Platforms[1].Ready {
		t.Fatalf("unexpected platform readiness: %+v", role.Platforms)
	}

	// 2. POST /api/v1/roles/caihongmao/pause (set paused = true)
	pausePayload := []byte(`{"paused":true}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/pause", bytes.NewReader(pausePayload))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/pause status = %d, want 200", w.Code)
	}
	if !e.IsPaused() {
		t.Fatalf("expected engine to be paused")
	}

	// Verify GET /roles reports paused: true
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if !rolesResp.Data.Roles[0].Paused {
		t.Fatalf("expected role paused = true")
	}

	// Verify engine true pause behavior: handleMessage returns early without work
	msg := &Message{Platform: "discord", Content: "hello"}
	e.handleMessage(plat1, msg) // should drop message immediately because e.IsPaused() == true

	// Verify scheduled jobs, timer jobs and heartbeats are rejected while paused
	timerErr := e.ExecuteTimerJob(&TimerJob{ID: "t1", SessionKey: "discord:c1", Prompt: "test prompt"})
	if timerErr == nil || !strings.Contains(timerErr.Error(), "paused") {
		t.Fatalf("expected ExecuteTimerJob on paused engine to fail with paused error, got: %v", timerErr)
	}

	cronErr := e.ExecuteCronJob(&CronJob{ID: "c1", SessionKey: "discord:c1", Prompt: "test prompt"})
	if cronErr == nil || !strings.Contains(cronErr.Error(), "paused") {
		t.Fatalf("expected ExecuteCronJob on paused engine to fail with paused error, got: %v", cronErr)
	}

	hbErr := e.ExecuteHeartbeat("discord:c1", "ping", true)
	if hbErr == nil || !strings.Contains(hbErr.Error(), "paused") {
		t.Fatalf("expected ExecuteHeartbeat on paused engine to fail with paused error, got: %v", hbErr)
	}

	// POST /roles/caihongmao/pause (set paused = false)
	pausePayload = []byte(`{"paused":false}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/pause", bytes.NewReader(pausePayload))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/pause (resume) status = %d, want 200", w.Code)
	}
	if e.IsPaused() {
		t.Fatalf("expected engine to be resumed")
	}

	// 3. Test Busy reporting via Session.Busy()
	sess := e.sessions.GetOrCreateActive("test-session")
	if !sess.TryLock() {
		t.Fatalf("failed to lock session")
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if !rolesResp.Data.Roles[0].Busy || rolesResp.Data.Roles[0].CurrentTask != "处理会话消息中" {
		t.Fatalf("expected busy=true with task, got %+v", rolesResp.Data.Roles[0])
	}
	sess.Unlock()

	// The card shows the configured name (team_name) when there is one.
	e.SetTeam("", "彩虹猫", false)
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if got := rolesResp.Data.Roles[0]; got.DisplayName != "彩虹猫" || got.Name != "caihongmao" {
		t.Fatalf("display_name/name = %q/%q, want 彩虹猫/caihongmao", got.DisplayName, got.Name)
	}

	// 4. POST /api/v1/roles/caihongmao/restart
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/restart", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/restart status = %d, want 200", w.Code)
	}

	// 5. GET /api/v1/devices
	req = httptest.NewRequest(http.MethodGet, "/api/v1/devices", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /devices status = %d, want 200", w.Code)
	}
}

type mockQuotaAgent struct {
	stubAgent
	getUsageCalled    bool
	cachedUsageCalled bool
}

func (a *mockQuotaAgent) GetUsage(ctx context.Context) (*UsageReport, error) {
	a.getUsageCalled = true
	return nil, nil
}

func (a *mockQuotaAgent) CachedUsage() *UsageReport {
	a.cachedUsageCalled = true
	return roleQuotaTestReport()
}

func TestManagementRoles_Quota(t *testing.T) {
	mgmt := NewManagementServer(0, "test-token", nil)

	// 1. Full quota (5h and weekly)
	reportFull := &UsageReport{
		ObservedAt: time.Now(),
		Buckets: []UsageBucket{
			{
				Windows: []UsageWindow{
					{Name: "5h", WindowSeconds: 18000, UsedPercent: 20},
					{Name: "weekly", WindowSeconds: 604800, UsedPercent: 40},
				},
			},
		},
	}
	eFull := &Engine{
		name:     "full",
		agent:    &stubAgent{},
		sessions: NewSessionManager(""),
		interactiveStates: map[string]*interactiveState{
			"s1": {agentSession: codexFooterSession(reportFull)},
		},
	}
	eFull.i18n = NewI18n(LangChinese)
	eFull.observeQuotaEventFor(Event{Type: EventResult}, "", codexFooterSession(reportFull), eFull.quotaScopeFor(eFull.agent, "gpt-6.1-sol"))
	mgmt.RegisterEngine("full", eFull)

	// 2. Partial quota (only 5h)
	reportPartial := &UsageReport{
		ObservedAt: time.Now(),
		Buckets: []UsageBucket{
			{
				Windows: []UsageWindow{
					{Name: "5h", WindowSeconds: 18000, UsedPercent: 25},
				},
			},
		},
	}
	ePartial := &Engine{
		name:     "partial",
		agent:    &stubAgent{},
		sessions: NewSessionManager(""),
		interactiveStates: map[string]*interactiveState{
			"s2": {agentSession: codexFooterSession(reportPartial)},
		},
	}
	ePartial.i18n = NewI18n(LangChinese)
	ePartial.observeQuotaEventFor(Event{Type: EventResult}, "", codexFooterSession(reportPartial), ePartial.quotaScopeFor(ePartial.agent, "gpt-6.1-sol"))
	mgmt.RegisterEngine("partial", ePartial)

	// 3. True zero remaining quota (used 100%, remaining 0%)
	reportZero := &UsageReport{
		ObservedAt: time.Now(),
		Buckets: []UsageBucket{
			{
				Windows: []UsageWindow{
					{Name: "5h", WindowSeconds: 18000, UsedPercent: 100},
				},
			},
		},
	}
	eZero := &Engine{
		name:     "zero",
		agent:    &stubAgent{},
		sessions: NewSessionManager(""),
		interactiveStates: map[string]*interactiveState{
			"s3": {agentSession: codexFooterSession(reportZero)},
		},
	}
	eZero.i18n = NewI18n(LangChinese)
	eZero.observeQuotaEventFor(Event{Type: EventResult}, "", codexFooterSession(reportZero), eZero.quotaScopeFor(eZero.agent, "gpt-6.1-sol"))
	mgmt.RegisterEngine("zero", eZero)

	// 4. No quota at all
	agentNoProbe := &mockQuotaAgent{}
	eNone := &Engine{
		name:              "none",
		agent:             agentNoProbe,
		sessions:          NewSessionManager(""),
		interactiveStates: make(map[string]*interactiveState),
	}
	mgmt.RegisterEngine("none", eNone)

	handler := mgmt.buildHandler(http.NewServeMux())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /roles status = %d, want 200", w.Code)
	}

	// Verify no I/O / GetUsage was triggered
	if agentNoProbe.getUsageCalled || agentNoProbe.cachedUsageCalled {
		t.Fatalf("handleRoles triggered GetUsage I/O; expected in-memory cached read only")
	}

	rawBody := w.Body.String()

	var rolesResp struct {
		Ok   bool `json:"ok"`
		Data struct {
			Roles []RoleInfo `json:"roles"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}

	roleMap := make(map[string]RoleInfo)
	for _, r := range rolesResp.Data.Roles {
		roleMap[r.Name] = r
	}

	// Verify full
	rFull, ok := roleMap["full"]
	if !ok || rFull.Quota == nil || len(rFull.Quota.Windows) != 2 {
		t.Fatalf("full role quota = %+v, want 2 windows", rFull.Quota)
	}
	if rFull.Quota.Windows[0].Label != "5h" || rFull.Quota.Windows[0].RemainingPercent != 80 || rFull.Quota.Windows[0].UsedPercent != 20 {
		t.Fatalf("full role window[0] = %+v, want 5h 80%% rem / 20%% used", rFull.Quota.Windows[0])
	}
	if rFull.Quota.Windows[1].Label != "周" || rFull.Quota.Windows[1].RemainingPercent != 60 || rFull.Quota.Windows[1].UsedPercent != 40 {
		t.Fatalf("full role window[1] = %+v, want 周 60%% rem / 40%% used", rFull.Quota.Windows[1])
	}

	// Verify partial
	rPartial, ok := roleMap["partial"]
	if !ok || rPartial.Quota == nil || len(rPartial.Quota.Windows) != 1 {
		t.Fatalf("partial role quota = %+v, want 1 window", rPartial.Quota)
	}
	if rPartial.Quota.Windows[0].Label != "5h" || rPartial.Quota.Windows[0].RemainingPercent != 75 || rPartial.Quota.Windows[0].UsedPercent != 25 {
		t.Fatalf("partial role window[0] = %+v, want 5h 75%% rem / 25%% used", rPartial.Quota.Windows[0])
	}

	// Verify true zero
	rZero, ok := roleMap["zero"]
	if !ok || rZero.Quota == nil || len(rZero.Quota.Windows) != 1 {
		t.Fatalf("zero role quota = %+v, want 1 window", rZero.Quota)
	}
	if rZero.Quota.Windows[0].RemainingPercent != 0 || rZero.Quota.Windows[0].UsedPercent != 100 {
		t.Fatalf("zero role window[0] = %+v, want remaining=0 used=100", rZero.Quota.Windows[0])
	}
	// Check raw JSON for zero: ensure "remaining_percent":0 is not omitted
	if !strings.Contains(rawBody, `"remaining_percent":0`) {
		t.Fatalf("raw JSON does not contain '\"remaining_percent\":0': %s", rawBody)
	}

	// Verify none
	rNone, ok := roleMap["none"]
	if !ok {
		t.Fatalf("missing none role")
	}
	if rNone.Quota != nil {
		t.Fatalf("none role quota = %+v, want nil", rNone.Quota)
	}
}

type stubModelQuotaAgent struct {
	stubAgent
	model string
}

func (a *stubModelQuotaAgent) GetModel() string {
	return a.model
}

func TestManagementRoles_ModelSwitchQuotaIsolation(t *testing.T) {
	mgmt := NewManagementServer(0, "test-token", nil)

	agent := &stubModelQuotaAgent{model: "model-a"}
	reportA := &UsageReport{
		ObservedAt: time.Now(),
		Buckets: []UsageBucket{
			{
				Windows: []UsageWindow{
					{Name: "5h", WindowSeconds: 18000, UsedPercent: 90},
				},
			},
		},
	}
	reportB := &UsageReport{
		ObservedAt: time.Now(),
		Buckets: []UsageBucket{
			{
				Windows: []UsageWindow{
					{Name: "5h", WindowSeconds: 18000, UsedPercent: 10},
				},
			},
		},
	}

	e := &Engine{
		name:              "switcher",
		agent:             agent,
		sessions:          NewSessionManager(""),
		interactiveStates: make(map[string]*interactiveState),
	}
	e.cacheRoleQuotaReport(agent, "model-a", e.quotaScopeFor(agent, "model-a"), reportA)
	mgmt.RegisterEngine("switcher", e)
	handler := mgmt.buildHandler(http.NewServeMux())

	// 1. Initial query: model-a with 90% used
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /roles status = %d, want 200", w.Code)
	}
	var resp struct {
		Data struct {
			Roles []RoleInfo `json:"roles"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Data.Roles) != 1 || resp.Data.Roles[0].Model != "model-a" {
		t.Fatalf("role model = %q, want model-a", resp.Data.Roles[0].Model)
	}
	if resp.Data.Roles[0].Quota == nil || resp.Data.Roles[0].Quota.Windows[0].UsedPercent != 90 {
		t.Fatalf("role quota = %+v, want used 90%%", resp.Data.Roles[0].Quota)
	}

	// 2. Switch model to model-b without cache: must hide quota and not leak model-a
	agent.model = "model-b"
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	resp.Data.Roles = nil
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Data.Roles) != 1 || resp.Data.Roles[0].Model != "model-b" {
		t.Fatalf("role model = %q, want model-b", resp.Data.Roles[0].Model)
	}
	if resp.Data.Roles[0].Quota != nil {
		t.Fatalf("after switch to model-b without cache, quota = %+v, want nil (hidden)", resp.Data.Roles[0].Quota)
	}

	// 3. Add cache for model-b: exact match returns model-b's report (10% used)
	e.cacheRoleQuotaReport(agent, "model-b", e.quotaScopeFor(agent, "model-b"), reportB)

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	resp.Data.Roles = nil
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data.Roles[0].Quota == nil || resp.Data.Roles[0].Quota.Windows[0].UsedPercent != 10 {
		t.Fatalf("role quota after model-b cache = %+v, want used 10%%", resp.Data.Roles[0].Quota)
	}

	// 4. Repeated deterministic lookups: 200 calls must always return exact model
	for i := 0; i < 200; i++ {
		gotB := e.CachedQuotaReport(nil, "model-b")
		if gotB == nil || gotB.Buckets[0].Windows[0].UsedPercent != 10 {
			t.Fatalf("iteration %d: CachedQuotaReport(model-b) returned unexpected report: %+v", i, gotB)
		}
		gotA := e.CachedQuotaReport(nil, "model-a")
		if gotA == nil || gotA.Buckets[0].Windows[0].UsedPercent != 90 {
			t.Fatalf("iteration %d: CachedQuotaReport(model-a) returned unexpected report: %+v", i, gotA)
		}
		gotUnknown := e.CachedQuotaReport(nil, "unseen-model")
		if gotUnknown != nil {
			t.Fatalf("iteration %d: CachedQuotaReport(unseen-model) returned non-nil: %+v", i, gotUnknown)
		}
	}

	// 5. Expiry: entries older than replyFooterUsageMaxAge must be hidden
	e.replyFooterMu.Lock()
	e.replyFooterUsage[replyFooterUsageKey{agent: replyFooterAgentID(agent), model: "model-b"}].reportAt = time.Now().Add(-35 * time.Minute)
	e.replyFooterMu.Unlock()

	if expired := e.CachedQuotaReport(nil, "model-b"); expired != nil {
		t.Fatalf("expired cache returned non-nil report: %+v", expired)
	}
}

// Adapter cache methods can trigger background refreshes. A roles GET must not
// call even the session variant, including after its retained snapshot expires.
type roleQuotaSideEffectSession struct {
	*cachedQuotaSession
	called bool
}

func (s *roleQuotaSideEffectSession) CachedUsage() *UsageReport {
	s.called = true
	return s.cached
}

func TestManagementRoles_QuotaReadOnlyScopeAndExpiry(t *testing.T) {
	agent := &stubModelModeAgent{model: "same-model", active: "a", providers: []ProviderConfig{
		{Name: "a", APIKey: "fixture-a"}, {Name: "b", APIKey: "fixture-b"},
	}}
	session := &roleQuotaSideEffectSession{cachedQuotaSession: codexFooterSession(roleQuotaTestReport())}
	session.model = "same-model"
	e := &Engine{agent: agent, sessions: NewSessionManager(""), interactiveStates: map[string]*interactiveState{"s": {agentSession: session}}}
	m := NewManagementServer(0, "test-token", nil)
	m.RegisterEngine("fixture", e)
	scope := e.quotaScopeFor(agent, "same-model")
	e.cacheRoleQuotaReport(agent, "same-model", scope, roleQuotaTestReport())
	if got := m.bridgeRoles()[0].Quota; got == nil {
		t.Fatal("normal cached report was hidden")
	}
	agent.active = "b"
	if got := m.bridgeRoles()[0].Quota; got != nil {
		t.Fatal("provider B inherited provider A snapshot")
	}
	agent.active = "a"
	key := replyFooterUsageKey{agent: replyFooterAgentID(agent), model: "same-model"}
	e.replyFooterUsage[key].reportAt = time.Now().Add(-replyFooterUsageMaxAge)
	if got := m.bridgeRoles()[0].Quota; got != nil {
		t.Fatal("expired snapshot was revived from session")
	}
	if session.called {
		t.Fatal("roles GET called the adapter cache method")
	}

	// A late result from A must not be attributed to B, even on the same model.
	agent.active = "b"
	e.cacheRoleQuotaReport(agent, "same-model", scope, roleQuotaTestReport())
	if got := m.bridgeRoles()[0].Quota; got != nil {
		t.Fatal("late provider A report appeared on B")
	}

	agent.active = "a"
	report := roleQuotaTestReport()
	report.Buckets[0].Windows[0].ResetAtUnix = time.Now().Add(-time.Second).Unix()
	e.cacheRoleQuotaReport(agent, "same-model", scope, report)
	if got := m.bridgeRoles()[0].Quota; got != nil {
		t.Fatal("snapshot remained visible after provider reset")
	}
}

func TestManagementRoles_QuotaModelGroupAndSnapshotCopy(t *testing.T) {
	agent := &quotaDomainTestAgent{stubModelModeAgent: stubModelModeAgent{model: "A"}, account: "fixture", groups: map[string]string{"A": "pool-a", "B": "pool-b"}}
	e := &Engine{agent: agent}
	report := roleQuotaTestReport()
	report.QuotaGroup = "pool-a"
	report.Buckets[0].QuotaGroup = "pool-a"
	e.cacheRoleQuotaReport(agent, "B", e.quotaScopeFor(agent, "B"), report)
	if got := e.CachedQuotaReport(nil, "B"); got != nil {
		t.Fatal("default-model pool A was attributed to session-model B")
	}
	e.cacheRoleQuotaReport(agent, "A", e.quotaScopeFor(agent, "A"), report)
	report.Buckets[0].Windows[0].UsedPercent = 100
	if got := e.CachedQuotaReport(nil, "A"); got == nil || got.Buckets[0].Windows[0].UsedPercent != 9 {
		t.Fatalf("retained snapshot changed with adapter data: %+v", got)
	}
}

func roleQuotaTestReport() *UsageReport {
	r := plusQuotaReport()
	r.ObservedAt = time.Now()
	return r
}

func TestManagementRoles_QuotaSessionAttributionAndStaleRead(t *testing.T) {
	agent := &stubModelModeAgent{model: "same-model", active: "a", providers: []ProviderConfig{
		{Name: "a", APIKey: "fixture-a"}, {Name: "b", APIKey: "fixture-b"},
	}}
	e := &Engine{agent: agent, i18n: NewI18n(LangChinese)}
	session := codexFooterSession(roleQuotaTestReport())
	session.model = "same-model"
	// The production event path receives the immutable interactiveState scope.
	scopeA := e.quotaScopeOfSession(agent, session)
	agent.active = "b"
	e.observeQuotaEventFor(Event{Type: EventResult}, "", session, scopeA)
	e.replyFooterQuota(session, agent)
	if got := e.CachedQuotaReport(session, "same-model"); got != nil {
		t.Fatal("old session's report was reattributed by its footer to provider B")
	}
	agent.active = "a"
	if got := e.CachedQuotaReport(session, "same-model"); got == nil {
		t.Fatal("provider A lost its own session snapshot")
	}
	session.cached.ObservedAt = time.Now().Add(-replyFooterUsageMaxAge)
	e.observeQuotaEventFor(Event{Type: EventResult}, "", session, scopeA)
	e.replyFooterQuota(session, agent)
	if got := e.CachedQuotaReport(session, "same-model"); got != nil {
		t.Fatal("reading the same stale report renewed its observation time")
	}
}
