package core

// #150 第 c 项（发说说 / 换说说 / 换头像）的管理接口证据：用的是真引擎 + 真
// 平台（一个只在本文件里存在的假平台），走真 HTTP，不 stub 掉 handler。

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSocialPlatform 实现 Platform + MomentPoster + AvatarSetter，并记录调用。
type fakeSocialPlatform struct {
	mu         sync.Mutex
	caps       *SocialCapabilities // nil = 全开
	moments    []Moment
	posted     []string
	deleted    []string
	avatarIn   []byte
	listErr    error
	postErr    error
	replaceErr error
	// replacePartial 设了就是「新的发出去了、旧的没删掉」：返回这条 Moment
	// 外加一个 MomentReplacePartialError。
	replacePartial *Moment
	avatarErr      error
	replaced       []string
	// replaceAccepted 记下每次换说说调用里调用方有没有确认「可能改变可见范围」，
	// 用来断言这个选择真的从 HTTP 层传到了平台层。
	replaceAccepted []bool
}

func (f *fakeSocialPlatform) Name() string                                   { return "qq" }
func (f *fakeSocialPlatform) Start(_ MessageHandler) error                   { return nil }
func (f *fakeSocialPlatform) Stop() error                                    { return nil }
func (f *fakeSocialPlatform) Reply(_ context.Context, _ any, _ string) error { return nil }
func (f *fakeSocialPlatform) Send(_ context.Context, _ any, _ string) error  { return nil }

func (f *fakeSocialPlatform) SocialCapabilities() SocialCapabilities {
	if f.caps != nil {
		return *f.caps
	}
	return SocialCapabilities{ListMoments: true, PostMoment: true, RemoveMoment: true, ReplaceMoment: true, SetAvatar: true}
}

func (f *fakeSocialPlatform) ListMoments(_ context.Context, limit int) ([]Moment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := append([]Moment(nil), f.moments...)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeSocialPlatform) PostMoment(_ context.Context, text string, images []MomentImage) (Moment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.postErr != nil {
		return Moment{}, f.postErr
	}
	f.posted = append(f.posted, text)
	return Moment{ID: fmt.Sprintf("tid-%d", len(f.posted)), Text: text, Time: time.Now()}, nil
}

func (f *fakeSocialPlatform) ReplaceMoment(_ context.Context, id, text string, opts MomentReplaceOptions) (Moment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.replaceAccepted = append(f.replaceAccepted, opts.AcceptAudienceChange)
	if f.replacePartial != nil {
		return *f.replacePartial, &MomentReplacePartialError{Moment: *f.replacePartial, Err: f.replaceErr}
	}
	if f.replaceErr != nil {
		return Moment{}, f.replaceErr
	}
	f.replaced = append(f.replaced, id+"|"+text)
	return Moment{ID: fmt.Sprintf("tid-replaced-%d", len(f.replaced)), Text: text, Time: time.Now()}, nil
}

func (f *fakeSocialPlatform) RemoveMoment(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleted = append(f.deleted, id)
	return nil
}

func (f *fakeSocialPlatform) SetAvatar(_ context.Context, img ImageAttachment) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.avatarErr != nil {
		return f.avatarErr
	}
	f.avatarIn = img.Data
	return nil
}

// fakeSocialPosterOnly 只有发说说的接口，没有 MomentReplacer：用来证明换说说的
// 能力是按接口报的，不是按平台名猜的。嵌入的是接口而不是 fakeSocialPlatform，
// 否则 ReplaceMoment 会被一起提升上来，这条用例就白测了。
type fakeSocialPosterOnly struct {
	Platform
	MomentPoster
}

func newSocialPosterOnly() *fakeSocialPosterOnly {
	f := &fakeSocialPlatform{}
	return &fakeSocialPosterOnly{Platform: f, MomentPoster: f}
}

// socialPNG is a 1x1 transparent PNG: small enough to inline, real enough for
// http.DetectContentType to call it image/png.
func socialPNG() []byte {
	b, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	return b
}

// engineWithSocial builds the same management server testManagementServer
// builds, but with our fake platform on the engine.
func engineWithSocial(t *testing.T, plat Platform) (*httptest.Server, string) {
	t.Helper()
	_, ts, e := testManagementServer(t, "tok")
	if plat != nil {
		e.AddPlatform(plat)
	}
	return ts, "tok"
}

func socialGet(t *testing.T, url string, out any) int {
	t.Helper()
	code, _ := socialGetRaw(t, url, out)
	return code
}

// socialGetRaw 除了 decode，还把原始响应体交回：有些断言必须看字节
// （例：JSON 里那个键到底叫 private_known 还是被改了名字），decode 会把这类
// 错误一起吃掉。
func socialGetRaw(t *testing.T, url string, out any) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer tok")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("读 %s 的响应体: %v", url, err)
	}
	if out != nil {
		_ = json.Unmarshal(raw, out)
	}
	return resp.StatusCode, raw
}

// socialPostRaw 与 socialPostJSON 相同，但把整个响应体按 map 交回，用来核对
// 失败响应里除了 error 还带回来的字段（换说说的部分成功会带 moment）。
func socialPostRaw(t *testing.T, url string, body any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer tok")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func socialPostJSON(t *testing.T, url string, body any) (int, mgmtResponse) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer tok")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	var r mgmtResponse
	_ = json.NewDecoder(resp.Body).Decode(&r)
	return resp.StatusCode, r
}

// TestMgmt_SocialListsMoments：GET 给出能力与列表。
func TestMgmt_SocialListsMoments(t *testing.T) {
	plat := &fakeSocialPlatform{moments: []Moment{
		{ID: "t1", Text: "最新一条", Time: time.Unix(1762300000, 0), PrivateKnown: true},
		{ID: "t2", Text: "上一条", Time: time.Unix(1762200000, 0), Private: true, PrivateKnown: true},
	}}
	ts, _ := engineWithSocial(t, plat)

	var body struct {
		OK   bool `json:"ok"`
		Data struct {
			Status       string             `json:"status"`
			Platform     string             `json:"platform"`
			Capabilities SocialCapabilities `json:"capabilities"`
			Moments      []Moment           `json:"moments"`
		} `json:"data"`
	}
	if code := socialGet(t, ts.URL+"/api/v1/projects/test-project/social", &body); code != 200 {
		t.Fatalf("GET social 状态码 %d", code)
	}
	if body.Data.Status != "ready" || body.Data.Platform != "qq" {
		t.Fatalf("状态不对：%+v", body.Data)
	}
	if !body.Data.Capabilities.PostMoment || !body.Data.Capabilities.SetAvatar {
		t.Fatalf("能力没报出来：%+v", body.Data.Capabilities)
	}
	if len(body.Data.Moments) != 2 || body.Data.Moments[0].ID != "t1" {
		t.Fatalf("列表不对：%+v", body.Data.Moments)
	}
	// private_known 要跟着 JSON 出去：面板靠它区分「公开」和「没读到」。
	if !body.Data.Moments[1].PrivateKnown || !body.Data.Moments[1].Private {
		t.Fatalf("private/private_known 没带出去：%+v", body.Data.Moments[1])
	}

	// 上面那条 decode 回的是同一个 Moment 结构体，tag 改成 camelCase 也照样过；
	// 面板（和任何第三方调用方）认的是字面键名，所以在字节上看一眼。
	code, raw := socialGetRaw(t, ts.URL+"/api/v1/projects/test-project/social", nil)
	if code != 200 {
		t.Fatalf("GET social 状态码 %d", code)
	}
	if !bytes.Contains(raw, []byte(`"private_known":true`)) {
		t.Fatalf("响应体里没有 \"private_known\":true 这个字面键：%s", raw)
	}
	// 两个字段都得在：只发 private 会让调用方把「没读到」当成「公开」。
	if !bytes.Contains(raw, []byte(`"private":true`)) {
		t.Fatalf("响应体里没有 \"private\":true：%s", raw)
	}
}

// TestMgmt_SocialSaysOffWhenConfigIsOff：「关着」要能被面板读出来，而不是
// 让人点了按钮才看到 403。
func TestMgmt_SocialSaysOffWhenConfigIsOff(t *testing.T) {
	off := SocialCapabilities{DisabledReason: "allow_qzone is off in this project's qq options"}
	ts, _ := engineWithSocial(t, &fakeSocialPlatform{caps: &off})

	var body struct {
		Data struct {
			Status       string             `json:"status"`
			Capabilities SocialCapabilities `json:"capabilities"`
			Message      string             `json:"message"`
		} `json:"data"`
	}
	if code := socialGet(t, ts.URL+"/api/v1/projects/test-project/social", &body); code != 200 {
		t.Fatalf("GET social 状态码 %d", code)
	}
	if body.Data.Status != "off" {
		t.Fatalf("关着时状态该是 off，实际 %q", body.Data.Status)
	}
	if !strings.Contains(body.Data.Message, "allow_qzone") {
		t.Fatalf("原因要点名配置项，实际 %q", body.Data.Message)
	}

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment", map[string]string{"text": "hi"})
	if code != http.StatusForbidden {
		t.Fatalf("关着时发说说该 403，实际 %d", code)
	}
	if resp.OK {
		t.Fatal("403 不该是 ok:true")
	}
}

// TestMgmt_SocialPostsAndDeletes：发与删都要真的落到平台上。
func TestMgmt_SocialPostsAndDeletes(t *testing.T) {
	plat := &fakeSocialPlatform{}
	ts, _ := engineWithSocial(t, plat)

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment", map[string]string{"text": "今天画了张图"})
	if code != 200 || !resp.OK {
		t.Fatalf("发说说失败：%d %s", code, resp.Error)
	}
	if len(plat.posted) != 1 || plat.posted[0] != "今天画了张图" {
		t.Fatalf("平台没收到文字：%v", plat.posted)
	}

	code, resp = socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/delete", map[string]string{"id": "tid-1"})
	if code != 200 || !resp.OK {
		t.Fatalf("删说说失败：%d %s", code, resp.Error)
	}
	if len(plat.deleted) != 1 || plat.deleted[0] != "tid-1" {
		t.Fatalf("平台没收到删除：%v", plat.deleted)
	}

	if code, _ = socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment", map[string]string{"text": "  "}); code != http.StatusBadRequest {
		t.Fatalf("空文字该 400，实际 %d", code)
	}
	if code, _ = socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/delete", map[string]string{}); code != http.StatusBadRequest {
		t.Fatalf("缺 id 该 400，实际 %d", code)
	}
}

// TestMgmt_SocialReplacesInOneCall：换说说是一个动作，不是面板自己发一条再删一条。
// 面板只发一次请求，平台收到的是 id + 新文字；图片不经过接口层，由平台自己从旧
// 那条上带过来。
func TestMgmt_SocialReplacesInOneCall(t *testing.T) {
	plat := &fakeSocialPlatform{}
	ts, _ := engineWithSocial(t, plat)

	code, raw := socialPostRaw(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]any{"id": "tid-old", "text": "换了个说法", "accept_audience_change": true})
	if code != 200 || raw["ok"] != true {
		t.Fatalf("换说说失败：%d %v", code, raw["error"])
	}
	if len(plat.replaced) != 1 || plat.replaced[0] != "tid-old|换了个说法" {
		t.Fatalf("平台没收到换说说：%v", plat.replaced)
	}
	// 换说说不该顺手发新的或删旧的：那条路径由平台内部决定，接口层只调一次。
	if len(plat.posted) != 0 || len(plat.deleted) != 0 {
		t.Fatalf("接口层不该自己发/删：posted=%v deleted=%v", plat.posted, plat.deleted)
	}
	data, _ := raw["data"].(map[string]any)
	moment, _ := data["moment"].(map[string]any)
	if moment["id"] != "tid-replaced-1" {
		t.Fatalf("新说说没带回来：%v", data)
	}

	if code, _ = socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]string{"text": "没给 id"}); code != http.StatusBadRequest {
		t.Fatalf("缺 id 该 400，实际 %d", code)
	}
	if code, _ = socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]string{"id": "tid-old", "text": "   "}); code != http.StatusBadRequest {
		t.Fatalf("空文字该 400，实际 %d", code)
	}
	// 这个选择真的从 HTTP 层传到了平台层：上面那次传了 true。
	if len(plat.replaceAccepted) != 1 || !plat.replaceAccepted[0] {
		t.Fatalf("accept_audience_change 没传到平台：%v", plat.replaceAccepted)
	}
}

// TestMgmt_SocialReplaceNeedsTheAudienceAcknowledgement：不传 accept_audience_change
// 就不换，而且接口这一层就挡回去——平台层连列表都不用去读。
//
// 这是第四轮退回来的那条边界：上游缺失 secret 时会把 is_private 补成 false，
// 「所有人可见」这个值于是有两个来源，桥接分不开。既然分不开，就把「可能改宽」
// 这个决定交回给人，默认答案是「不换」。
func TestMgmt_SocialReplaceNeedsTheAudienceAcknowledgement(t *testing.T) {
	cases := []struct {
		name string
		body map[string]any
		// want 是错误里必须有的一段话。三种差不多的写法要求不同：前两种是真的
		// 「没确认」，要说清为什么、以及可以怎么继续；第三种（用字符串冒充布尔）
		// 在解码那一步就被拒了，一样是 400、一样一条都不发，但话是解码器的话。
		want string
	}{
		{"字段完全不传", map[string]any{"id": "tid-old", "text": "新的"}, "不可逆"},
		{"传了 false", map[string]any{"id": "tid-old", "text": "新的", "accept_audience_change": false}, "不可逆"},
		{"传了字符串 true", map[string]any{"id": "tid-old", "text": "新的", "accept_audience_change": "true"}, "accept_audience_change"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plat := &fakeSocialPlatform{}
			ts, _ := engineWithSocial(t, plat)

			code, raw := socialPostRaw(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace", tc.body)
			if code != http.StatusBadRequest {
				t.Fatalf("没确认可见范围该 400，实际 %d %v", code, raw["error"])
			}
			if raw["ok"] != false {
				t.Fatalf("400 不该是 ok:true：%v", raw)
			}
			msg, _ := raw["error"].(string)
			if !strings.Contains(msg, tc.want) {
				t.Fatalf("错误里该有 %q，实际 %q", tc.want, msg)
			}
			// 平台层一次都没被调：没确认连读列表都不做。
			if len(plat.replaceAccepted) != 0 || len(plat.replaced) != 0 {
				t.Fatalf("没确认却调到了平台：accepted=%v replaced=%v", plat.replaceAccepted, plat.replaced)
			}
		})
	}

	// 真正的「没确认」那句话要点名接口字段，否则调用方不知道要补什么。
	ts, _ := engineWithSocial(t, &fakeSocialPlatform{})
	_, raw := socialPostRaw(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]any{"id": "tid-old", "text": "新的"})
	msg, _ := raw["error"].(string)
	if !strings.Contains(msg, "accept_audience_change") {
		t.Fatalf("错误要点名那个字段：%q", msg)
	}
}

// TestMgmt_SocialReplaceOffWinsOverTheMissingAcknowledgement：什么都没打开时，
// 该报的是「这台机器没打开」（403），不是「你还没确认」（400）——确认了也换不成的
// 那种情况要先说清楚。
func TestMgmt_SocialReplaceOffWinsOverTheMissingAcknowledgement(t *testing.T) {
	off := SocialCapabilities{DisabledReason: "allow_qzone is off in this project's qq options"}
	ts, _ := engineWithSocial(t, &fakeSocialPlatform{caps: &off})

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]string{"id": "tid-old", "text": "新的"})
	if code != http.StatusForbidden {
		t.Fatalf("关着时该 403（不是 400 的「没确认」），实际 %d %s", code, resp.Error)
	}
}

// TestMgmt_SocialReplaceSaysBothExistWhenDeleteFails：平台报「新的发了、旧的没删」时，
// 那句人话要原样到面板，而且要把新那条一起带回去——否则人只看到失败，不知道空间里
// 已经多了一条，也不知道该删哪条。
func TestMgmt_SocialReplaceSaysBothExistWhenDeleteFails(t *testing.T) {
	published := Moment{ID: "tid-new", Text: "新的", Time: time.Unix(1762300000, 0)}
	plat := &fakeSocialPlatform{
		replacePartial: &published,
		replaceErr:     fmt.Errorf("新的已经发出（tid=tid-new），但旧的 tid-old 没删掉，现在空间里有两条"),
	}
	ts, _ := engineWithSocial(t, plat)

	code, raw := socialPostRaw(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]any{"id": "tid-old", "text": "新的", "accept_audience_change": true})
	if code == 200 || raw["ok"] != false {
		t.Fatalf("该报失败，实际 %d ok=%v", code, raw["ok"])
	}
	msg, _ := raw["error"].(string)
	if !strings.Contains(msg, "两条") {
		t.Fatalf("丢掉了「有两条」这句：%q", msg)
	}
	moment, _ := raw["moment"].(map[string]any)
	if moment["id"] != "tid-new" {
		t.Fatalf("失败响应里该带上新那条，实际 %v", raw["moment"])
	}
}

// TestMgmt_SocialReplaceOffIsForbidden：接口在、配置没打开时，换说说和发说说一样是
// 403（不是「平台做不到」的 501），消息里点名配置项。
func TestMgmt_SocialReplaceOffIsForbidden(t *testing.T) {
	off := SocialCapabilities{DisabledReason: "allow_qzone is off in this project's qq options"}
	ts, _ := engineWithSocial(t, &fakeSocialPlatform{caps: &off})

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]any{"id": "tid-old", "text": "新的", "accept_audience_change": true})
	if code != http.StatusForbidden {
		t.Fatalf("关着时该 403，实际 %d %s", code, resp.Error)
	}
	if !strings.Contains(resp.Error, "allow_qzone") {
		t.Fatalf("消息要点名配置项：%q", resp.Error)
	}
}

// TestMgmt_SocialReplaceRefusedBecauseOfVisibilityIs400：平台拒绝（例：旧条仅部分人可见）
// 不是上游坏了，是这条说说不能这么换，该回 400 而不是 502，并且说明是哪儿的问题。
func TestMgmt_SocialReplaceRefusedBecauseOfVisibilityIs400(t *testing.T) {
	plat := &fakeSocialPlatform{
		replaceErr: fmt.Errorf("换说说：原来那条是「仅部分人可见」，先不动它: %w", ErrSocialCannotReplace),
	}
	ts, _ := engineWithSocial(t, plat)

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]any{"id": "tid-old", "text": "新的", "accept_audience_change": true})
	if code != http.StatusBadRequest {
		t.Fatalf("可见范围导致不能换时该 400，实际 %d %s", code, resp.Error)
	}
	if !strings.Contains(resp.Error, "仅部分人可见") {
		t.Fatalf("错误要说清为什么：%q", resp.Error)
	}
	if len(plat.replaced) != 0 {
		t.Fatalf("拒绝了还改了 %d 条", len(plat.replaced))
	}
}

// TestMgmt_SocialReplaceWithoutInterfaceIs501：只实现 MomentPoster、没有
// MomentReplacer 的平台不能换，接口回 501 且能力报 false，面板因此不摆那个按钮。
func TestMgmt_SocialReplaceWithoutInterfaceIs501(t *testing.T) {
	ts, _ := engineWithSocial(t, newSocialPosterOnly())

	var body struct {
		Data struct {
			Capabilities SocialCapabilities `json:"capabilities"`
		} `json:"data"`
	}
	if code := socialGet(t, ts.URL+"/api/v1/projects/test-project/social", &body); code != 200 {
		t.Fatalf("GET social 状态码 %d", code)
	}
	if body.Data.Capabilities.ReplaceMoment {
		t.Fatal("平台没有 MomentReplacer 却报了 replace_moment=true")
	}
	if !body.Data.Capabilities.PostMoment {
		t.Fatal("发说说还在，不该被一起关掉")
	}

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/replace",
		map[string]any{"id": "tid-old", "text": "新的", "accept_audience_change": true})
	if code != http.StatusNotImplemented {
		t.Fatalf("平台不能换时该 501，实际 %d %s", code, resp.Error)
	}
}

// TestMgmt_SocialAvatarUploadKeepsBytes：multipart 上传的图片原样交给平台，
// 非图片文件在本地就拒。
func TestMgmt_SocialAvatarUploadKeepsBytes(t *testing.T) {
	plat := &fakeSocialPlatform{}
	ts, _ := engineWithSocial(t, plat)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "avatar.png")
	_, _ = fw.Write(socialPNG())
	_ = mw.Close()

	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/projects/test-project/social/avatar", &buf)
	req.Header.Set("Authorization", "Bearer tok")
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST avatar: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("换头像状态码 %d", resp.StatusCode)
	}
	if !bytes.Equal(plat.avatarIn, socialPNG()) {
		t.Fatalf("平台收到的字节不对：%d 字节", len(plat.avatarIn))
	}

	var buf2 bytes.Buffer
	mw2 := multipart.NewWriter(&buf2)
	fw2, _ := mw2.CreateFormFile("file", "notes.txt")
	_, _ = fw2.Write([]byte("this is not a picture"))
	_ = mw2.Close()
	req2, _ := http.NewRequest("POST", ts.URL+"/api/v1/projects/test-project/social/avatar", &buf2)
	req2.Header.Set("Authorization", "Bearer tok")
	req2.Header.Set("Content-Type", mw2.FormDataContentType())
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("POST avatar (text): %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusBadRequest {
		t.Fatalf("非图片该 400，实际 %d", resp2.StatusCode)
	}
	var r mgmtResponse
	_ = json.NewDecoder(resp2.Body).Decode(&r)
	if !strings.Contains(r.Error, "not an image") {
		t.Fatalf("要说清不是图片，实际 %q", r.Error)
	}
}

// TestMgmt_SocialWithoutQQSaysSo：项目里没有能发说说的平台时，如实说
// not_supported，而不是 500 或空卡。
func TestMgmt_SocialWithoutQQSaysSo(t *testing.T) {
	ts, _ := engineWithSocial(t, nil)

	var body struct {
		Data struct {
			Status  string   `json:"status"`
			Message string   `json:"message"`
			Moments []Moment `json:"moments"`
		} `json:"data"`
	}
	if code := socialGet(t, ts.URL+"/api/v1/projects/test-project/social", &body); code != 200 {
		t.Fatalf("状态码 %d", code)
	}
	if body.Data.Status != "not_supported" {
		t.Fatalf("状态该是 not_supported，实际 %q", body.Data.Status)
	}
	if body.Data.Moments == nil {
		t.Fatal("moments 该是空数组而不是 null（面板会读它）")
	}
	code, _ := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment", map[string]string{"text": "hi"})
	if code != http.StatusNotImplemented {
		t.Fatalf("没有平台时发说说该 501，实际 %d", code)
	}
}

// TestMgmt_SocialReadErrorDoesNotBlockThePage：读列表失败只让列表空着并说
// 原因，发/删按钮仍按能力走。
func TestMgmt_SocialReadErrorDoesNotBlockThePage(t *testing.T) {
	plat := &fakeSocialPlatform{listErr: fmt.Errorf("qq: 读说说列表: %w", ErrSocialUnsupported)}
	ts, _ := engineWithSocial(t, plat)

	var body struct {
		Data struct {
			Status       string             `json:"status"`
			Message      string             `json:"message"`
			Capabilities SocialCapabilities `json:"capabilities"`
		} `json:"data"`
	}
	if code := socialGet(t, ts.URL+"/api/v1/projects/test-project/social", &body); code != 200 {
		t.Fatalf("状态码 %d", code)
	}
	if body.Data.Status != "error" || body.Data.Message == "" {
		t.Fatalf("读失败要说原因：%+v", body.Data)
	}
	if !body.Data.Capabilities.PostMoment {
		t.Fatalf("读失败不该把发说说也关掉：%+v", body.Data.Capabilities)
	}
}

// socialPostAvatar 发一次真 multipart 换头像请求，返回状态码。
func socialPostAvatar(t *testing.T, url string) (int, mgmtResponse) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "avatar.png")
	_, _ = fw.Write(socialPNG())
	_ = mw.Close()
	req, _ := http.NewRequest("POST", url, &buf)
	req.Header.Set("Authorization", "Bearer tok")
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	var r mgmtResponse
	_ = json.NewDecoder(resp.Body).Decode(&r)
	return resp.StatusCode, r
}

// TestMgmt_SocialWritesRequireToken：管理 API 没设 token 时，三条写路由都要 403，
// 一条都不能落到平台上；读路由照开。空 token 时 authenticate() 放行一切，而
// management 默认监听所有网卡，这里是拦住"谁都能用机器人真号发说说/换头像"的那道闸。
func TestMgmt_SocialWritesRequireToken(t *testing.T) {
	plat := &fakeSocialPlatform{}
	_, ts, e := testManagementServer(t, "")
	e.AddPlatform(plat)

	// 读路由不能被这道闸关掉：没 token 时列表照常可读。
	if code := socialGet(t, ts.URL+"/api/v1/projects/test-project/social", nil); code != 200 {
		t.Fatalf("没 token 时读列表该照常 200，实际 %d", code)
	}

	code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment", map[string]string{"text": "hi"})
	if code != http.StatusForbidden {
		t.Fatalf("没 token 时发说说该 403，实际 %d", code)
	}
	if resp.OK || !strings.Contains(resp.Error, "token") {
		t.Fatalf("403 要说清没设 token：%+v", resp)
	}
	if len(plat.posted) != 0 {
		t.Fatalf("没 token 时不该发到平台：%v", plat.posted)
	}

	code, resp = socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/delete", map[string]string{"id": "tid-1"})
	if code != http.StatusForbidden {
		t.Fatalf("没 token 时删说说该 403，实际 %d", code)
	}
	if resp.OK || !strings.Contains(resp.Error, "token") {
		t.Fatalf("403 要说清没设 token：%+v", resp)
	}
	if len(plat.deleted) != 0 {
		t.Fatalf("没 token 时不该删到平台：%v", plat.deleted)
	}

	code, resp = socialPostAvatar(t, ts.URL+"/api/v1/projects/test-project/social/avatar")
	if code != http.StatusForbidden {
		t.Fatalf("没 token 时换头像该 403，实际 %d", code)
	}
	if resp.OK || !strings.Contains(resp.Error, "token") {
		t.Fatalf("403 要说清没设 token：%+v", resp)
	}
	if plat.avatarIn != nil {
		t.Fatalf("没 token 时不该换到平台：%d 字节", len(plat.avatarIn))
	}
}

// TestMgmt_SocialWritesPassWithToken：配了 token 且带对 token 时，三条写路由照常通过。
func TestMgmt_SocialWritesPassWithToken(t *testing.T) {
	plat := &fakeSocialPlatform{}
	ts, tok := engineWithSocial(t, plat)
	if tok == "" {
		t.Fatal("测试用 token 不该为空")
	}

	if code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment", map[string]string{"text": "今天画了张图"}); code != 200 || !resp.OK {
		t.Fatalf("带 token 发说说该 200，实际 %d %s", code, resp.Error)
	}
	if code, resp := socialPostJSON(t, ts.URL+"/api/v1/projects/test-project/social/moment/delete", map[string]string{"id": "tid-1"}); code != 200 || !resp.OK {
		t.Fatalf("带 token 删说说该 200，实际 %d %s", code, resp.Error)
	}
	if code, resp := socialPostAvatar(t, ts.URL+"/api/v1/projects/test-project/social/avatar"); code != 200 || !resp.OK {
		t.Fatalf("带 token 换头像该 200，实际 %d %s", code, resp.Error)
	}
	if len(plat.posted) != 1 || len(plat.deleted) != 1 || plat.avatarIn == nil {
		t.Fatalf("三次写都要落到平台：posted=%v deleted=%v avatar=%d", plat.posted, plat.deleted, len(plat.avatarIn))
	}
}

// TestMgmt_SocialWritesRejectWrongToken：有 token 时带错 token 仍是 401，闸不会放宽鉴权。
func TestMgmt_SocialWritesRejectWrongToken(t *testing.T) {
	plat := &fakeSocialPlatform{}
	ts, _ := engineWithSocial(t, plat)

	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/projects/test-project/social/moment", strings.NewReader(`{"text":"hi"}`))
	req.Header.Set("Authorization", "Bearer wrong")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST moment: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("带错 token 该 401，实际 %d", resp.StatusCode)
	}
	if len(plat.posted) != 0 {
		t.Fatalf("带错 token 不该发到平台：%v", plat.posted)
	}
}
