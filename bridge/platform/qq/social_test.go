package qq

// #150 第 c 项（发说说 / 换说说 / 换头像）的平台层证据。
// 自带一个最小 OneBot v11 正向 WS 服务器，只回答本文件用到的那几个 action，
// 不复用本包其它 fake 的断言；不动真实账号、不连真实 NapCat。

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// socialBotID 是模拟机器人 QQ 号（假号，仅测试用）。
const socialBotID int64 = 20000

type socialOneBot struct {
	ts   *httptest.Server
	mu   sync.Mutex
	conn *websocket.Conn
	sent map[string][]map[string]any
	// respond lets a test decide the reply per action; nil means "ok".
	respond func(action string) (retcode int, data map[string]any)
}

func newSocialOneBot(t *testing.T) *socialOneBot {
	t.Helper()
	f := &socialOneBot{sent: map[string][]map[string]any{}}
	f.ts = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.ts.Close)
	return f
}

func (f *socialOneBot) serve(w http.ResponseWriter, r *http.Request) {
	up := websocket.Upgrader{}
	c, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	f.mu.Lock()
	f.conn = c
	f.mu.Unlock()
	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			return
		}
		var req map[string]any
		if json.Unmarshal(raw, &req) != nil {
			continue
		}
		action, _ := req["action"].(string)
		params, _ := req["params"].(map[string]any)
		f.mu.Lock()
		f.sent[action] = append(f.sent[action], params)
		respond := f.respond
		f.mu.Unlock()

		retcode, data := 0, map[string]any{}
		if action == "get_login_info" {
			data = map[string]any{"user_id": socialBotID, "nickname": "SocialBot"}
		} else if respond != nil {
			retcode, data = respond(action)
		}
		status := "ok"
		if retcode != 0 {
			status = "failed"
		}
		raw2, _ := json.Marshal(map[string]any{
			"status": status, "retcode": retcode, "echo": req["echo"], "data": data,
		})
		f.mu.Lock()
		_ = c.WriteMessage(websocket.TextMessage, raw2)
		f.mu.Unlock()
	}
}

func (f *socialOneBot) calls(action string) []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.sent[action]...)
}

func (f *socialOneBot) start(t *testing.T, opts map[string]any) *Platform {
	t.Helper()
	all := map[string]any{"ws_url": "ws" + strings.TrimPrefix(f.ts.URL, "http")}
	for k, v := range opts {
		all[k] = v
	}
	p, err := New(all)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	plat := p.(*Platform)
	if err := plat.Start(func(_ core.Platform, _ *core.Message) {}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = plat.Stop() })
	return plat
}

// TestSocial_TurnedOffByDefault：不给 allow_qzone/allow_avatar 时，两个能力
// 都存在但都回 ErrSocialDisabled，且一个请求都不发出去。
func TestSocial_TurnedOffByDefault(t *testing.T) {
	f := newSocialOneBot(t)
	p := f.start(t, nil)

	caps := p.SocialCapabilities()
	if caps.ListMoments || caps.PostMoment || caps.RemoveMoment || caps.ReplaceMoment || caps.SetAvatar {
		t.Fatalf("默认应当是关的，实际 %+v", caps)
	}
	if !strings.Contains(caps.DisabledReason, "allow_qzone") {
		t.Fatalf("关掉的原因要能指向配置项，实际 %q", caps.DisabledReason)
	}

	if _, err := p.ListMoments(context.Background(), 5); !errors.Is(err, core.ErrSocialDisabled) {
		t.Fatalf("ListMoments 应当回 ErrSocialDisabled，实际 %v", err)
	}
	if _, err := p.PostMoment(context.Background(), "不该发出去", nil); !errors.Is(err, core.ErrSocialDisabled) {
		t.Fatalf("PostMoment 应当回 ErrSocialDisabled，实际 %v", err)
	}
	if err := p.RemoveMoment(context.Background(), "tid-1"); !errors.Is(err, core.ErrSocialDisabled) {
		t.Fatalf("RemoveMoment 应当回 ErrSocialDisabled，实际 %v", err)
	}
	if _, err := p.ReplaceMoment(context.Background(), "tid-1", "换一下", nil); !errors.Is(err, core.ErrSocialDisabled) {
		t.Fatalf("ReplaceMoment 应当回 ErrSocialDisabled，实际 %v", err)
	}
	if err := p.SetAvatar(context.Background(), core.ImageAttachment{Data: []byte("x")}); !errors.Is(err, core.ErrSocialDisabled) {
		t.Fatalf("SetAvatar 应当回 ErrSocialDisabled，实际 %v", err)
	}

	for _, action := range []string{"send_qzone_msg", "delete_qzone_msg", "get_qzone_msg_list", "set_qq_avatar"} {
		if n := len(f.calls(action)); n != 0 {
			t.Fatalf("关着的时候不该请求 %s，实际 %d 次", action, n)
		}
	}
}

// TestSocial_PostsReadsAndDeletes：打开 allow_qzone 后，三个动作用的是
// 说好的那几个 action 和参数，回来的列表被翻成 Moment。
func TestSocial_PostsReadsAndDeletes(t *testing.T) {
	f := newSocialOneBot(t)
	f.respond = func(action string) (int, map[string]any) {
		switch action {
		case "send_qzone_msg":
			return 0, map[string]any{"tid": "new-tid"}
		case "get_qzone_msg_list":
			return 0, map[string]any{"total": 2, "msglist": []any{
				map[string]any{"tid": "t2", "content": "今天也在", "time": 1762300000, "is_private": true,
					"images": []any{"https://example.invalid/a.png"}},
				map[string]any{"tid": 7001, "content": "更早的一条", "time": 1762200000,
					"images": []any{map[string]any{"url": "https://example.invalid/b.png"}}},
			}}
		}
		return 0, map[string]any{}
	}
	p := f.start(t, map[string]any{"allow_qzone": true})

	caps := p.SocialCapabilities()
	if !caps.ListMoments || !caps.PostMoment || !caps.RemoveMoment {
		t.Fatalf("打开 allow_qzone 后三个说说能力都该有，实际 %+v", caps)
	}
	if caps.SetAvatar {
		t.Fatalf("allow_avatar 没开，不该说能换头像：%+v", caps)
	}

	posted, err := p.PostMoment(context.Background(), "你好，世界", []core.MomentImage{{Data: []byte("png"), Name: "a.png"}})
	if err != nil {
		t.Fatalf("PostMoment: %v", err)
	}
	if posted.ID != "new-tid" {
		t.Fatalf("tid 没接住：%q", posted.ID)
	}
	calls := f.calls("send_qzone_msg")
	if len(calls) != 1 {
		t.Fatalf("send_qzone_msg 次数 %d", len(calls))
	}
	if got := calls[0]["content"]; got != "你好，世界" {
		t.Fatalf("content 传错：%v", got)
	}
	imgs, _ := calls[0]["images"].([]any)
	if len(imgs) != 1 || !strings.HasPrefix(imgs[0].(string), "base64://") {
		t.Fatalf("图片没按 base64:// 传：%v", calls[0]["images"])
	}

	list, err := p.ListMoments(context.Background(), 10)
	if err != nil {
		t.Fatalf("ListMoments: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("列表条数 %d", len(list))
	}
	if list[0].ID != "t2" || list[0].Text != "今天也在" || !list[0].Private {
		t.Fatalf("第一条翻错：%+v", list[0])
	}
	if list[0].Time.IsZero() || len(list[0].Images) != 1 {
		t.Fatalf("时间/图片没接住：%+v", list[0])
	}
	if list[1].ID != "7001" {
		t.Fatalf("数字 tid 没转成字符串：%+v", list[1])
	}
	if len(list[1].Images) != 1 || list[1].Images[0] != "https://example.invalid/b.png" {
		t.Fatalf("对象形态的图片没接住：%+v", list[1].Images)
	}

	if err := p.RemoveMoment(context.Background(), "new-tid"); err != nil {
		t.Fatalf("RemoveMoment: %v", err)
	}
	if calls := f.calls("delete_qzone_msg"); len(calls) != 1 || calls[0]["tid"] != "new-tid" {
		t.Fatalf("delete_qzone_msg 参数不对：%v", calls)
	}
}

// TestSocial_ReplacePublishesThenDeletes：换说说不是「发一条再删一条」两个独立动作，
// 而是一次调用里的有序两步：新的先发出去，成功了才删旧的。顺序也不能反。
func TestSocial_ReplacePublishesThenDeletes(t *testing.T) {
	f := newSocialOneBot(t)
	f.respond = func(action string) (int, map[string]any) {
		if action == "send_qzone_msg" {
			return 0, map[string]any{"tid": "new-tid"}
		}
		return 0, map[string]any{}
	}
	p := f.start(t, map[string]any{"allow_qzone": true})

	if !p.SocialCapabilities().ReplaceMoment {
		t.Fatalf("allow_qzone 打开后换说说该可用：%+v", p.SocialCapabilities())
	}
	m, err := p.ReplaceMoment(context.Background(), "old-tid", "换个说法", nil)
	if err != nil {
		t.Fatalf("ReplaceMoment: %v", err)
	}
	if m.ID != "new-tid" || m.Text != "换个说法" {
		t.Fatalf("返回的新说说不对：%+v", m)
	}
	sends := f.calls("send_qzone_msg")
	dels := f.calls("delete_qzone_msg")
	if len(sends) != 1 || sends[0]["content"] != "换个说法" {
		t.Fatalf("send_qzone_msg 不对：%v", sends)
	}
	if len(dels) != 1 || dels[0]["tid"] != "old-tid" {
		t.Fatalf("delete_qzone_msg 该删旧的那条：%v", dels)
	}
}

// TestSocial_ReplaceKeepsOldPostWhenPublishFails：发新的失败时，旧的一条绝不能动。
func TestSocial_ReplaceKeepsOldPostWhenPublishFails(t *testing.T) {
	f := newSocialOneBot(t)
	f.respond = func(action string) (int, map[string]any) {
		if action == "send_qzone_msg" {
			return 1400, nil // 上游拒绝发布
		}
		return 0, map[string]any{}
	}
	p := f.start(t, map[string]any{"allow_qzone": true})

	_, err := p.ReplaceMoment(context.Background(), "old-tid", "新的发不出去", nil)
	if err == nil {
		t.Fatal("发新的失败时该报错")
	}
	if n := len(f.calls("delete_qzone_msg")); n != 0 {
		t.Fatalf("发新的都失败了还去删旧的 %d 次，会把原话弄丢", n)
	}
	if !strings.Contains(err.Error(), "旧的原样保留") {
		t.Fatalf("错误里要说清旧的没动：%q", err.Error())
	}
}

// TestSocial_ReplaceSaysBothExistWhenDeleteFails：新的发出去了、旧的删不掉时，
// 不能假装替换成功，要把「现在有两条」带回去。
func TestSocial_ReplaceSaysBothExistWhenDeleteFails(t *testing.T) {
	f := newSocialOneBot(t)
	f.respond = func(action string) (int, map[string]any) {
		switch action {
		case "send_qzone_msg":
			return 0, map[string]any{"tid": "new-tid"}
		case "delete_qzone_msg":
			return 1404, nil
		}
		return 0, map[string]any{}
	}
	p := f.start(t, map[string]any{"allow_qzone": true})

	m, err := p.ReplaceMoment(context.Background(), "old-tid", "新的", nil)
	if err == nil {
		t.Fatal("旧的没删掉时该报错")
	}
	if m.ID != "new-tid" {
		t.Fatalf("新的已经发出去了，要把它带回：%+v", m)
	}
	if !strings.Contains(err.Error(), "两条") {
		t.Fatalf("错误里要说清现在有两条：%q", err.Error())
	}
}

// TestSocial_EmptyPostIsRefusedBeforeItGoesOut：空说说在本地就拒，不浪费一次
// 对外发布。
func TestSocial_EmptyPostIsRefusedBeforeItGoesOut(t *testing.T) {
	f := newSocialOneBot(t)
	p := f.start(t, map[string]any{"allow_qzone": true})

	if _, err := p.PostMoment(context.Background(), "   ", nil); err == nil {
		t.Fatal("空说说应当被拒")
	}
	if n := len(f.calls("send_qzone_msg")); n != 0 {
		t.Fatalf("空说说还是发出去了 %d 次", n)
	}
}

// TestSocial_AvatarGoesOutOnlyWhenAllowed：allow_avatar 打开时才调
// set_qq_avatar，且图片走 base64://。
func TestSocial_AvatarGoesOutOnlyWhenAllowed(t *testing.T) {
	f := newSocialOneBot(t)
	p := f.start(t, map[string]any{"allow_avatar": true})

	if err := p.SetAvatar(context.Background(), core.ImageAttachment{Data: []byte("png-bytes"), MimeType: "image/png"}); err != nil {
		t.Fatalf("SetAvatar: %v", err)
	}
	calls := f.calls("set_qq_avatar")
	if len(calls) != 1 {
		t.Fatalf("set_qq_avatar 次数 %d", len(calls))
	}
	file, _ := calls[0]["file"].(string)
	if !strings.HasPrefix(file, "base64://") {
		t.Fatalf("头像没按 base64:// 传：%q", file)
	}
	if err := p.SetAvatar(context.Background(), core.ImageAttachment{}); err == nil {
		t.Fatal("空文件应当被拒")
	}
}

// TestSocial_UnsupportedExtensionSaysWhatToDo：上游没有这个扩展 action 时，
// 错误里要能看懂该升级 NapCat，而不是只扔 retcode。
func TestSocial_UnsupportedExtensionSaysWhatToDo(t *testing.T) {
	f := newSocialOneBot(t)
	f.respond = func(action string) (int, map[string]any) {
		if action == "send_qzone_msg" {
			return 1404, map[string]any{"message": "unsupported action"}
		}
		return 0, map[string]any{}
	}
	p := f.start(t, map[string]any{"allow_qzone": true})

	_, err := p.PostMoment(context.Background(), "试试", nil)
	if err == nil {
		t.Fatal("上游拒了，这里不该报成功")
	}
	if !strings.Contains(err.Error(), "NapCat") {
		t.Fatalf("错误里要提到上游实现，实际 %q", err.Error())
	}
}
