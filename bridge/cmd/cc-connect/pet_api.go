package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// The pet's own local API (#1296). `bothouse pet run` serves it on 127.0.0.1 and hands its address to the
// bundled pet (plugins/desktop-pet, a fork of dsh-pet) as BOTHOUSE_PET_API / BOTHOUSE_PET_TOKEN; the pet's
// right-click menu calls it instead of its own model, balance provider and todo file
// (plugins/desktop-pet/src/host/bothouse.ts):
//
//	POST /chat    {"text"}  → the bound role runs one turn on it; answers {"ok","text"} with its reply
//	GET  /whisper           → a line a bound role said lately
//	GET  /balance           → {"rows": [...]} bothouse usage today / this month (/api/v1/usage/roles)
//	GET  /todos             → {"items": [{"id","text"}]} open team task board items (/api/v1/team/board)

// petChatTimeout bounds one 对话 turn; a role that takes longer still answers in its chat.
const petChatTimeout = 5 * time.Minute

// petTalk keeps what the API needs from the role event stream.
type petTalk struct {
	mu      sync.Mutex
	session map[string]string // role_key → session it last spoke or worked in
	recent  []string          // final lines of bound roles, newest last
	waiting map[string]chan string
}

func newPetTalk() *petTalk {
	return &petTalk{session: map[string]string{}, waiting: map[string]chan string{}}
}

func (t *petTalk) seen(role, session string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.session[role] = session
	t.mu.Unlock()
}

// spoke records a final line; it reports whether a pending 对话 took it as its reply.
func (t *petTalk) spoke(role, session, text string) bool {
	if t == nil {
		return false
	}
	text = strings.TrimSpace(text)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.recent = append(t.recent, text)
	if len(t.recent) > 30 {
		t.recent = t.recent[len(t.recent)-30:]
	}
	if ch, ok := t.waiting[role+"\x00"+session]; ok {
		delete(t.waiting, role+"\x00"+session)
		ch <- text
		return true
	}
	return false
}

type petAPI struct {
	relay   *petRelay
	bridge  string // management base URL
	token   string // management token
	socket  string // bothouse local API socket (POST /wake)
	secret  string // bearer token of this API
	http    *http.Client
	wakeFn  func(project, session, text string) error // tests replace the socket call
	chatMax time.Duration
}

func newPetAPI(relay *petRelay, bridge, token, socket string) *petAPI {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	a := &petAPI{relay: relay, bridge: bridge, token: token, socket: socket, secret: hex.EncodeToString(b),
		http: &http.Client{Timeout: 10 * time.Second}, chatMax: petChatTimeout}
	a.wakeFn = a.wake
	return a
}

// serve listens on a free loopback port and returns its base URL.
func (a *petAPI) serve(ctx context.Context) (string, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	srv := &http.Server{Handler: a.handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(l) }()
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	return "http://" + l.Addr().String(), nil
}

func (a *petAPI) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/chat", a.handleChat)
	mux.HandleFunc("/whisper", a.handleWhisper)
	mux.HandleFunc("/balance", a.handleBalance)
	mux.HandleFunc("/todos", a.handleTodos)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+a.secret {
			petAPIFail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func petAPIJSON(w http.ResponseWriter, v map[string]any) {
	v["ok"] = true
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func petAPIFail(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "message": msg})
}

// chatTarget picks the bound role to talk to: the first (by key) whose session is known. DSH roles
// (dsh:…) are skipped: a turn can only be started for a bothouse project.
func (a *petAPI) chatTarget() (role, session, name string, err error) {
	r := a.relay
	r.mu.Lock()
	keys := make([]string, 0, len(r.bound))
	for k := range r.bound {
		keys = append(keys, k)
	}
	names := map[string]string{}
	for k, v := range r.names {
		names[k] = v
	}
	r.mu.Unlock()
	sort.Strings(keys)
	if len(keys) == 0 {
		return "", "", "", fmt.Errorf("还没有角色绑定桌宠：在管理页「插件」里给角色打开桌宠")
	}
	t := r.talk
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, k := range keys {
		if s := t.session[k]; s != "" && !strings.HasPrefix(k, "dsh:") {
			return k, s, names[k], nil
		}
	}
	return "", "", "", fmt.Errorf("绑定的角色这次启动后还没在哪个会话里说过话，先在聊天里跟它说一句")
}

func (a *petAPI) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		petAPIFail(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil || strings.TrimSpace(body.Text) == "" {
		petAPIFail(w, http.StatusBadRequest, "text is required")
		return
	}
	role, session, name, err := a.chatTarget()
	if err != nil {
		petAPIFail(w, http.StatusConflict, err.Error())
		return
	}
	ch := make(chan string, 1)
	key := role + "\x00" + session
	t := a.relay.talk
	t.mu.Lock()
	t.waiting[key] = ch
	t.mu.Unlock()
	drop := func() {
		t.mu.Lock()
		if t.waiting[key] == ch {
			delete(t.waiting, key)
		}
		t.mu.Unlock()
	}
	text := "（主人在桌面桌宠里对你说，你的回复会显示在桌宠的对话框里）\n" + strings.TrimSpace(body.Text)
	// role keys are "bridge:<project>" (role-bindings); /wake wants the bare project name.
	if err := a.wakeFn(strings.TrimPrefix(role, "bridge:"), session, text); err != nil {
		drop()
		petAPIFail(w, http.StatusBadGateway, "叫醒 "+name+" 失败："+err.Error())
		return
	}
	select {
	case reply := <-ch:
		petAPIJSON(w, map[string]any{"text": reply, "role": name})
	case <-time.After(a.chatMax):
		drop()
		petAPIFail(w, http.StatusGatewayTimeout, name+" 还在想，回话会出现在它的聊天里")
	case <-r.Context().Done():
		drop()
	}
}

// wake starts a turn in the role's session through the local API socket (same call as `bothouse wake`).
func (a *petAPI) wake(project, session, text string) error {
	payload, _ := json.Marshal(map[string]string{"project": project, "session_key": session, "text": text})
	c := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		return net.Dial("unix", a.socket)
	}}}
	resp, err := c.Post("http://unix/wake", "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		var b bytes.Buffer
		_, _ = b.ReadFrom(resp.Body)
		return fmt.Errorf("HTTP %d %s", resp.StatusCode, strings.TrimSpace(b.String()))
	}
	return nil
}

func (a *petAPI) handleWhisper(w http.ResponseWriter, r *http.Request) {
	t := a.relay.talk
	t.mu.Lock()
	lines := append([]string(nil), t.recent...)
	t.mu.Unlock()
	if len(lines) == 0 {
		petAPIFail(w, http.StatusConflict, "绑定的角色这次启动后还没说过话")
		return
	}
	n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(lines))))
	line := []rune(lines[n.Int64()])
	if len(line) > 120 {
		line = append(line[:120], '…')
	}
	petAPIJSON(w, map[string]any{"text": string(line)})
}

// mgmtGet reads a management API endpoint's data field into out.
func (a *petAPI) mgmtGet(path string, out any) error {
	req, _ := http.NewRequest("GET", a.bridge+path, nil)
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("%s: HTTP %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(&struct {
		Data any `json:"data"`
	}{Data: out})
}

type petUsageRow struct {
	Role    string   `json:"role"`
	Total   int64    `json:"total_tokens"`
	Replies int64    `json:"replies"`
	Cost    *float64 `json:"estimated_cost"`
}

func petUsageLine(label string, rows []petUsageRow) string {
	var tokens, replies int64
	var cost float64
	priced := false
	for _, r := range rows {
		tokens += r.Total
		replies += r.Replies
		if r.Cost != nil {
			cost += *r.Cost
			priced = true
		}
	}
	s := fmt.Sprintf("%s：%d 次回复 · %s tokens", label, replies, petTokens(tokens))
	if priced {
		s += fmt.Sprintf(" · 约 $%.2f", cost)
	}
	return s
}

func petTokens(n int64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1e6)
	case n >= 1_000:
		return fmt.Sprintf("%.1fk", float64(n)/1e3)
	}
	return fmt.Sprint(n)
}

func (a *petAPI) handleBalance(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	day := now.Format("2006-01-02")
	month := now.Format("2006-01") + "-01"
	var today, mon struct {
		Items []petUsageRow `json:"items"`
	}
	if err := a.mgmtGet("/api/v1/usage/roles?from="+day+"&to="+day, &today); err != nil {
		petAPIFail(w, http.StatusBadGateway, "读 bothouse 用量失败："+err.Error())
		return
	}
	if err := a.mgmtGet("/api/v1/usage/roles?from="+month+"&to="+day, &mon); err != nil {
		petAPIFail(w, http.StatusBadGateway, "读 bothouse 用量失败："+err.Error())
		return
	}
	petAPIJSON(w, map[string]any{"rows": []string{petUsageLine("今天", today.Items), petUsageLine("本月", mon.Items)}})
}

func (a *petAPI) handleTodos(w http.ResponseWriter, r *http.Request) {
	var board struct {
		Team  bool `json:"team"`
		Items []struct {
			ID     int    `json:"id"`
			Name   string `json:"name"`
			Status string `json:"status"`
			Who    string `json:"who"`
			Paused bool   `json:"paused"`
		} `json:"items"`
	}
	if err := a.mgmtGet("/api/v1/team/board", &board); err != nil {
		petAPIFail(w, http.StatusBadGateway, "读任务板失败："+err.Error())
		return
	}
	items := make([]map[string]any, 0, len(board.Items))
	for _, it := range board.Items {
		text := fmt.Sprintf("#%d %s", it.ID, it.Name)
		if it.Who != "" {
			text += " · " + it.Who
		}
		if it.Paused {
			text += " · 暂停"
		}
		if r := []rune(text); len(r) > 200 { // the pet's todo text limit (TODO_TEXT_MAX)
			text = string(r[:199]) + "…"
		}
		items = append(items, map[string]any{"id": it.ID, "text": text})
	}
	petAPIJSON(w, map[string]any{"items": items})
}
