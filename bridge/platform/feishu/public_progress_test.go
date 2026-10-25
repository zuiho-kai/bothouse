package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
)

// fakeFeishuIM is a fake Feishu IM API: it records sends, patches, replies and
// pins, and de-duplicates sends by uuid like the real API.
type fakeFeishuIM struct {
	mu         sync.Mutex
	nextID     int
	byUUID     map[string]string
	content    map[string]string // message ID -> card JSON
	gone       map[string]bool   // deleted message IDs
	expired    map[string]bool   // message IDs older than the 14-day edit window
	creates    []map[string]any
	patches    []string
	replies    []map[string]any
	pins       []string
	pinFail    bool
	createFail int          // fail this many creates with HTTP 500 before succeeding
	refuse     *fakeRefusal // when set, every create/patch/reply answers with it
}

type fakeRefusal struct {
	status, code int
	msg          string
}

func newFakeFeishuIM() *fakeFeishuIM {
	return &fakeFeishuIM{byUUID: map[string]string{}, content: map[string]string{}, gone: map[string]bool{}, expired: map[string]bool{}}
}

func (f *fakeFeishuIM) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		f.mu.Lock()
		defer f.mu.Unlock()
		ok := func(data map[string]any) { writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "data": data}) }
		if f.refuse != nil && strings.HasPrefix(r.URL.Path, "/open-apis/im/v1/messages") {
			w.WriteHeader(f.refuse.status)
			writeJSON(t, w, map[string]any{"code": f.refuse.code, "msg": f.refuse.msg})
			return
		}
		switch {
		case r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal":
			writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "expire": 7200, "tenant_access_token": "tok"})
		case r.Method == http.MethodPost && r.URL.Path == "/open-apis/im/v1/messages":
			if f.createFail > 0 {
				f.createFail--
				w.WriteHeader(http.StatusInternalServerError)
				writeJSON(t, w, map[string]any{"code": 1, "msg": "boom"})
				return
			}
			f.creates = append(f.creates, body)
			uuid, _ := body["uuid"].(string)
			if id, seen := f.byUUID[uuid]; seen && uuid != "" {
				ok(map[string]any{"message_id": id})
				return
			}
			f.nextID++
			id := "om_" + string(rune('a'+f.nextID))
			if uuid != "" {
				f.byUUID[uuid] = id
			}
			f.content[id], _ = body["content"].(string)
			ok(map[string]any{"message_id": id})
		case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/open-apis/im/v1/messages/"):
			id := strings.TrimPrefix(r.URL.Path, "/open-apis/im/v1/messages/")
			if f.gone[id] {
				writeJSON(t, w, map[string]any{"code": 230011, "msg": "The message was withdrawn."})
				return
			}
			if f.expired[id] {
				w.WriteHeader(http.StatusBadRequest)
				writeJSON(t, w, map[string]any{"code": feishuCardExpiredCode, "msg": "message can only be updated within 14 days"})
				return
			}
			f.patches = append(f.patches, id)
			f.content[id], _ = body["content"].(string)
			ok(map[string]any{})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/reply"):
			body["root"] = strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/open-apis/im/v1/messages/"), "/reply")
			f.replies = append(f.replies, body)
			ok(map[string]any{"message_id": "om_reply"})
		case r.Method == http.MethodPost && r.URL.Path == "/open-apis/im/v1/pins":
			if f.pinFail {
				writeJSON(t, w, map[string]any{"code": 99991672, "msg": "no permission"})
				return
			}
			id, _ := body["message_id"].(string)
			f.pins = append(f.pins, id)
			ok(map[string]any{})
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}
}

func newFakeFeishuPlatform(t *testing.T, f *fakeFeishuIM) *Platform {
	t.Helper()
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	const appID, appSecret = "cli_task_card", "secret"
	return &Platform{
		platformName: "feishu",
		domain:       srv.URL,
		appID:        appID,
		appSecret:    appSecret,
		client:       lark.NewClient(appID, appSecret, lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
		replayClient: lark.NewClient(appID, appSecret, lark.WithEnableTokenCache(false), lark.WithOpenBaseUrl(srv.URL), lark.WithHttpClient(srv.Client())),
	}
}

func TestFeishuTaskCardDestination(t *testing.T) {
	p := &Platform{platformName: "feishu"}
	if got, err := p.TaskCardDestination("feishu:oc_chat:ou_user"); err != nil || got != "oc_chat" {
		t.Fatalf("TaskCardDestination = %q, %v", got, err)
	}
	if _, err := p.TaskCardDestination("discord:123:456"); err == nil {
		t.Fatal("foreign session key accepted")
	}
}

func TestFeishuTaskCardPostThenEdit(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	task := &core.Task{ID: "task-1", Title: "整理周报", SessionKey: "feishu:oc_chat:ou_u", ChannelID: "oc_chat", State: core.TaskStateInProgress, LatestProgress: "开始读数据"}

	if err := p.EnsureTaskCard(ctx, task, core.LangChinese); err != nil {
		t.Fatalf("first EnsureTaskCard: %v", err)
	}
	if task.MessageID == "" || len(f.creates) != 1 || len(f.patches) != 0 {
		t.Fatalf("want one card posted, got id=%q creates=%d patches=%d", task.MessageID, len(f.creates), len(f.patches))
	}
	if c := f.creates[0]; c["msg_type"] != "interactive" || c["receive_id"] != "oc_chat" || c["uuid"] == "" {
		t.Fatalf("create body = %v", c)
	}
	if !strings.Contains(f.content[task.MessageID], "开始读数据") {
		t.Fatalf("card lacks progress: %s", f.content[task.MessageID])
	}

	first := task.MessageID
	task.LatestProgress = "写完第二节"
	task.State = core.TaskStateCompleted
	if err := p.EnsureTaskCard(ctx, task, core.LangChinese); err != nil {
		t.Fatalf("second EnsureTaskCard: %v", err)
	}
	if task.MessageID != first || len(f.creates) != 1 || len(f.patches) != 1 {
		t.Fatalf("want an in-place edit, got id=%q creates=%d patches=%d", task.MessageID, len(f.creates), len(f.patches))
	}
	if !strings.Contains(f.content[first], "写完第二节") {
		t.Fatalf("edited card lacks new progress: %s", f.content[first])
	}
}

// A lost response to the first post: core retries with no MessageID, and the
// uuid makes the fake (like Feishu) return the same card, not a second one.
func TestFeishuTaskCardLostAckDoesNotDuplicate(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	a := &core.Task{ID: "task-2", Title: "t", ChannelID: "oc_chat"}
	b := &core.Task{ID: "task-2", Title: "t", ChannelID: "oc_chat"}
	if err := p.EnsureTaskCard(ctx, a, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	if err := p.EnsureTaskCard(ctx, b, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	if a.MessageID != b.MessageID || len(f.content) != 1 {
		t.Fatalf("retry posted a second card: %q vs %q, messages=%d", a.MessageID, b.MessageID, len(f.content))
	}
}

func TestFeishuTaskCardDeletedIsPostedAgain(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	task := &core.Task{ID: "task-3", Title: "t", ChannelID: "oc_chat"}
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	old := task.MessageID
	f.gone[old] = true
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err != nil {
		t.Fatalf("EnsureTaskCard after delete: %v", err)
	}
	if task.MessageID == "" || task.MessageID == old {
		t.Fatalf("deleted card not reposted: %q (old %q)", task.MessageID, old)
	}
}

// Repost after delete fails (network): task.MessageID stays on the old card,
// so the retry uses the repost uuid again and does not get the deleted card
// back from the original uuid.
func TestFeishuTaskCardRepostFailureKeepsOldID(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	task := &core.Task{ID: "task-5", Title: "t", ChannelID: "oc_chat"}
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	old := task.MessageID
	f.mu.Lock()
	f.gone[old] = true
	f.createFail = 100
	f.mu.Unlock()
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err == nil {
		t.Fatal("want repost error")
	}
	if task.MessageID != old {
		t.Fatalf("MessageID changed before repost succeeded: %q (old %q)", task.MessageID, old)
	}
	f.mu.Lock()
	f.createFail = 0
	f.mu.Unlock()
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err != nil {
		t.Fatalf("retry repost: %v", err)
	}
	if task.MessageID == "" || task.MessageID == old {
		t.Fatalf("retry returned the deleted card: %q (old %q)", task.MessageID, old)
	}
}

func TestFeishuPublishTaskFactRepliesInThread(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	task := &core.Task{ID: "task-4", Title: "t", ChannelID: "oc_chat", MessageID: "om_card"}
	ev := core.TaskEvent{ID: "task-4:1", TaskID: "task-4", Seq: 1, Summary: "读完了数据"}
	if err := p.PublishTaskFact(ctx, task, ev, core.LangChinese); err != nil {
		t.Fatalf("PublishTaskFact: %v", err)
	}
	if len(f.replies) != 1 {
		t.Fatalf("replies = %d", len(f.replies))
	}
	r := f.replies[0]
	if r["root"] != "om_card" || r["reply_in_thread"] != true || r["uuid"] == "" {
		t.Fatalf("reply body = %v", r)
	}
	if err := p.PublishTaskFact(ctx, &core.Task{ID: "x"}, ev, core.LangChinese); err == nil {
		t.Fatal("fact before card accepted")
	}
}

func TestFeishuBoardPostPinThenEdit(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	id, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", "", "**团队任务板**\n龙娘 进行中")
	if err != nil || id == "" {
		t.Fatalf("UpsertBoard post: %q, %v", id, err)
	}
	if len(f.pins) != 1 || f.pins[0] != id {
		t.Fatalf("board not pinned: %v", f.pins)
	}
	if !strings.Contains(f.content[id], "团队任务板") || !strings.Contains(f.content[id], "龙娘 进行中") {
		t.Fatalf("board card = %s", f.content[id])
	}
	got, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", id, "**团队任务板**\n龙娘 已完成")
	if err != nil || got != id {
		t.Fatalf("UpsertBoard edit: %q, %v", got, err)
	}
	if len(f.creates) != 1 || len(f.patches) != 1 || !strings.Contains(f.content[id], "龙娘 已完成") {
		t.Fatalf("want in-place edit: creates=%d patches=%d content=%s", len(f.creates), len(f.patches), f.content[id])
	}

	// Board deleted by hand: post and pin a new one.
	f.gone[id] = true
	again, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", id, "**团队任务板**\n空")
	if err != nil || again == "" || again == id || len(f.pins) != 2 {
		t.Fatalf("deleted board not reposted: %q, %v, pins=%v", again, err, f.pins)
	}
}

// Pin refused (e.g. missing scope): the posted ID still comes back with the
// error, so core keeps it and edits that card next time.
func TestFeishuBoardPinFailureKeepsID(t *testing.T) {
	f := newFakeFeishuIM()
	f.pinFail = true
	p := newFakeFeishuPlatform(t, f)
	id, err := p.UpsertBoard(context.Background(), "feishu:oc_chat:ou_u", "", "**板**\nx")
	if err == nil || id == "" {
		t.Fatalf("want id with pin error, got %q, %v", id, err)
	}
	if errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatal("pin failure must not give up the board")
	}
	// Still refused next round: the edit succeeds, the pin failure is only logged.
	if got, err := p.UpsertBoard(context.Background(), "feishu:oc_chat:ou_u", id, "**板**\ny"); err != nil || got != id {
		t.Fatalf("edit with pin still refused: %q, %v", got, err)
	}
	// Scope granted: the next successful edit pins the board, once.
	f.mu.Lock()
	f.pinFail = false
	f.mu.Unlock()
	for _, body := range []string{"**板**\nz", "**板**\nw"} {
		if got, err := p.UpsertBoard(context.Background(), "feishu:oc_chat:ou_u", id, body); err != nil || got != id {
			t.Fatalf("edit after scope granted: %q, %v", got, err)
		}
	}
	if len(f.pins) != 1 || f.pins[0] != id {
		t.Fatalf("board not re-pinned exactly once: %v", f.pins)
	}
}

// Bot removed from the chat / scope missing: card, fact and board errors wrap
// core's give-up errors, so core stops retrying every tick.
func TestFeishuPermanentRefusalIsUnrecoverable(t *testing.T) {
	for _, ref := range []fakeRefusal{
		{status: http.StatusBadRequest, code: feishuBotNotInChatCode, msg: "Bot is not in the chat"},
		{status: http.StatusOK, code: feishuNoPermissionCode, msg: "no permission"},
	} {
		f := newFakeFeishuIM()
		f.refuse = &ref
		p := newFakeFeishuPlatform(t, f)
		ctx := context.Background()
		task := &core.Task{ID: "task-p", Title: "t", ChannelID: "oc_chat"}
		if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%v: create card err = %v", ref, err)
		}
		task.MessageID = "om_x"
		if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%v: patch card err = %v", ref, err)
		}
		if len(f.creates) != 0 {
			t.Fatalf("%v: chat-level refusal treated as deleted card, reposted", ref)
		}
		ev := core.TaskEvent{ID: "e", TaskID: task.ID, Seq: 1, Summary: "x"}
		if err := p.PublishTaskFact(ctx, task, ev, core.LangEnglish); !errors.Is(err, core.ErrTaskFactUndeliverable) || !errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%v: fact err = %v", ref, err)
		}
		if _, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", "om_b", "**板**\nx"); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%v: board edit err = %v", ref, err)
		}
		if _, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", "", "**板**\nx"); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%v: board send err = %v", ref, err)
		}
	}
}

// A server error stays retryable, and "chat not exist" text alone is not a
// deleted card.
func TestFeishuTransientRefusalIsRetryable(t *testing.T) {
	f := newFakeFeishuIM()
	f.refuse = &fakeRefusal{status: http.StatusInternalServerError, code: 1, msg: "chat not exist"}
	p := newFakeFeishuPlatform(t, f)
	task := &core.Task{ID: "task-t", Title: "t", ChannelID: "oc_chat", MessageID: "om_x"}
	err := p.EnsureTaskCard(context.Background(), task, core.LangEnglish)
	if err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) || isFeishuMessageGone(err) {
		t.Fatalf("err = %v", err)
	}
	if task.MessageID != "om_x" || len(f.creates) != 0 {
		t.Fatalf("transient patch error reposted the card")
	}
}

// Feishu rate limits (230020, 99991400) come back as HTTP 400: they stay
// retryable, not permanent.
func TestFeishuRateLimitHTTP400IsNotPermanent(t *testing.T) {
	for _, code := range []int{feishuIMRateLimitCode, feishuGenericRateLimitCode} {
		if feishuPermanent(http.StatusBadRequest, code) {
			t.Fatalf("code %d with HTTP 400 judged permanent", code)
		}
		f := newFakeFeishuIM()
		f.refuse = &fakeRefusal{status: http.StatusBadRequest, code: code, msg: "rate limited"}
		p := newFakeFeishuPlatform(t, f)
		ctx := context.Background()
		task := &core.Task{ID: "task-r", Title: "t", ChannelID: "oc_chat"}
		if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%d: create card err = %v", code, err)
		}
		task.MessageID = "om_x"
		if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%d: patch card err = %v", code, err)
		}
		if _, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", "om_b", "**板**\nx"); err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%d: board edit err = %v", code, err)
		}
		if _, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", "", "**板**\nx"); err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) {
			t.Fatalf("%d: board send err = %v", code, err)
		}
	}
}

// Board or card older than 14 days cannot be edited: post (and pin) a new one
// instead of failing every round.
func TestFeishuExpiredCardIsPostedAgain(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	id, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", "", "**板**\nx")
	if err != nil {
		t.Fatal(err)
	}
	f.expired[id] = true
	again, err := p.UpsertBoard(ctx, "feishu:oc_chat:ou_u", id, "**板**\ny")
	if err != nil || again == "" || again == id || len(f.pins) != 2 || f.pins[1] != again {
		t.Fatalf("expired board not reposted+pinned: %q, %v, pins=%v", again, err, f.pins)
	}
	task := &core.Task{ID: "task-e", Title: "t", ChannelID: "oc_chat"}
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	old := task.MessageID
	f.expired[old] = true
	if err := p.EnsureTaskCard(ctx, task, core.LangEnglish); err != nil || task.MessageID == old {
		t.Fatalf("expired task card not reposted: %q, %v", task.MessageID, err)
	}
}
