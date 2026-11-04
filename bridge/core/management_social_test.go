package core

// #150 第 c 项（发说说 / 换说说 / 换头像）的管理接口证据：用的是真引擎 + 真
// 平台（一个只在本文件里存在的假平台），走真 HTTP，不 stub 掉 handler。

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	mu        sync.Mutex
	caps      *SocialCapabilities // nil = 全开
	moments   []Moment
	posted    []string
	deleted   []string
	avatarIn  []byte
	listErr   error
	postErr   error
	avatarErr error
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
	return SocialCapabilities{ListMoments: true, PostMoment: true, RemoveMoment: true, SetAvatar: true}
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

// socialPNG is a 1x1 transparent PNG: small enough to inline, real enough for
// http.DetectContentType to call it image/png.
func socialPNG() []byte {
	b, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	return b
}

// engineWithSocial builds the same management server testManagementServer
// builds, but with our fake platform on the engine.
func engineWithSocial(t *testing.T, plat *fakeSocialPlatform) (*httptest.Server, string) {
	t.Helper()
	_, ts, e := testManagementServer(t, "tok")
	if plat != nil {
		e.AddPlatform(plat)
	}
	return ts, "tok"
}

func socialGet(t *testing.T, url string, out any) int {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer tok")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
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
		{ID: "t1", Text: "最新一条", Time: time.Unix(1762300000, 0)},
		{ID: "t2", Text: "上一条", Time: time.Unix(1762200000, 0), Private: true},
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
