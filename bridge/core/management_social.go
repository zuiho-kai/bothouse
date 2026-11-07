package core

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

// QQ 说说与头像的管理接口（#150 第 c 项）。都挂在项目下面，因为这些能力属于
// 某个项目里的某个平台连接，不是全局的：
//
//	GET  /projects/<name>/social               → {status, platform, capabilities, moments}
//	POST /projects/<name>/social/moment        {text} → Moment
//	POST /projects/<name>/social/moment/replace {id, text} → {moment}
//	POST /projects/<name>/social/moment/delete {id}   → {result}
//	POST /projects/<name>/social/avatar        multipart file → {result}
//
// 三个写动作都要平台配置里显式打开（qq 的 allow_qzone / allow_avatar），没打开
// 的时候 GET 里如实说"关着"并给原因，面板据此禁用按钮，不会让人点了才发现。

// socialMomentTimeout bounds one panel request. 来源：沿用 platform/qq social.go
// 的 socialCallTimeout（同一个上游链路），面板侧再多留 15s 等读图。
const socialMomentTimeout = 75 * time.Second

// socialMaxAvatar bounds the uploaded avatar bytes. 来源：沿用
// platform/qq social.go 的 socialMaxImage（2 MiB，常见头像上限）。
const socialMaxAvatar = 2 << 20

// socialBodySlack 是 multipart 里表单字段与边界占的余量。
const socialBodySlack = 64 << 10

// requireSocialWrites 拒绝在管理 API 没设 token 时发说说、删说说、换头像。空 token 时
// authenticate() 放行一切，而 management 默认 host 为空即监听所有网卡，所以"没 token"
// 等于"这个网段里谁都能用机器人真号发公开内容和改头像"（复审 1033）。
// 写法沿用 #1032 management_imagegen.go 的 requireImageGenSpend 与 #1027
// management_plugins.go 的 requirePluginWrites：读路由照开，对外发声的写路由才拦。
func (m *ManagementServer) requireSocialWrites(w http.ResponseWriter) bool {
	if m.token == "" {
		mgmtError(w, http.StatusForbidden, "管理 API 没设 token：这台机器上谁都能开这个端口，发说说、删说说、换头像会以机器人真号对外发声，先设 management token 再操作。")
		return false
	}
	return true
}

// socialPlatform returns the project's platform that can talk to a timeline,
// and what it currently allows. nil means "this project has no such platform".
func socialPlatform(engine *Engine) (Platform, SocialCapabilities) {
	for _, p := range engine.Platforms() {
		if _, ok := p.(MomentPoster); !ok {
			if _, ok := p.(AvatarSetter); !ok {
				continue
			}
		}
		caps := SocialCapabilities{ListMoments: true, PostMoment: true, RemoveMoment: true, SetAvatar: true}
		// 换说说需要平台真能一次换掉；没有这个接口就报 false，面板不摆一个必然 501 的按钮。
		if _, ok := p.(MomentReplacer); ok {
			caps.ReplaceMoment = true
		}
		if rep, ok := p.(SocialCapabilityReporter); ok {
			caps = rep.SocialCapabilities()
		}
		return p, caps
	}
	return nil, SocialCapabilities{}
}

// handleProjectSocial serves GET /projects/<name>/social[/...].
func (m *ManagementServer) handleProjectSocial(w http.ResponseWriter, r *http.Request, engine *Engine, rest string) {
	rest = strings.Trim(rest, "/")
	switch rest {
	case "":
		m.socialStatus(w, r, engine)
	case "moment":
		m.socialPostMoment(w, r, engine)
	case "moment/replace":
		m.socialReplaceMoment(w, r, engine)
	case "moment/delete":
		m.socialDeleteMoment(w, r, engine)
	case "avatar":
		m.socialSetAvatar(w, r, engine)
	default:
		mgmtError(w, http.StatusNotFound, "not found")
	}
}

func (m *ManagementServer) socialStatus(w http.ResponseWriter, r *http.Request, engine *Engine) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	plat, caps := socialPlatform(engine)
	if plat == nil {
		mgmtJSON(w, http.StatusOK, map[string]any{
			"status":       "not_supported",
			"platform":     "",
			"capabilities": caps,
			"moments":      []Moment{},
			"message":      "this project's platform cannot post to a timeline; 说说 and 头像 are QQ (NapCat) only for now",
		})
		return
	}
	out := map[string]any{
		"status":       "ready",
		"platform":     plat.Name(),
		"capabilities": caps,
		"moments":      []Moment{},
	}
	if !caps.ListMoments {
		out["status"] = "off"
		out["message"] = caps.DisabledReason
		mgmtJSON(w, http.StatusOK, out)
		return
	}
	poster := plat.(MomentPoster)
	ctx, cancel := context.WithTimeout(r.Context(), socialMomentTimeout)
	defer cancel()
	moments, err := poster.ListMoments(ctx, socialMomentLimit(r))
	if err != nil {
		// 列表读不到不影响另外两个动作，照实说，不整页 5xx。
		out["status"] = "error"
		out["message"] = socialMessage(err)
		mgmtJSON(w, http.StatusOK, out)
		return
	}
	out["moments"] = moments
	if caps.DisabledReason != "" {
		out["message"] = caps.DisabledReason
	}
	mgmtJSON(w, http.StatusOK, out)
}

func socialMomentLimit(r *http.Request) int {
	const def, max = 20, 50 // 来源：面板一屏能看到的大约条数；上限防止一次拉太多
	n := def
	if v := r.URL.Query().Get("limit"); v != "" {
		if parsed, err := atoiPositive(v); err == nil && parsed > 0 {
			n = parsed
		}
	}
	if n > max {
		n = max
	}
	return n
}

func atoiPositive(s string) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errors.New("not a number")
		}
		n = n*10 + int(c-'0')
		if n > 1_000_000 {
			return 0, errors.New("too large")
		}
	}
	if n == 0 {
		return 0, errors.New("zero")
	}
	return n, nil
}

func (m *ManagementServer) socialPostMoment(w http.ResponseWriter, r *http.Request, engine *Engine) {
	if !m.requireSocialWrites(w) {
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	plat, caps := socialPlatform(engine)
	if plat == nil {
		mgmtError(w, http.StatusNotImplemented, "this project's platform cannot post to a timeline")
		return
	}
	if !caps.PostMoment {
		mgmtError(w, http.StatusForbidden, "说说 is turned off: "+caps.DisabledReason)
		return
	}
	if strings.TrimSpace(body.Text) == "" {
		mgmtError(w, http.StatusBadRequest, "text required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), socialMomentTimeout)
	defer cancel()
	moment, err := plat.(MomentPoster).PostMoment(ctx, body.Text, nil)
	if err != nil {
		mgmtError(w, socialStatus(err), socialMessage(err))
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"moment": moment})
}

// socialReplaceMoment 换说说：把这一条换成新的文字，只发一次请求，不是让面板
// 自己「先发一条再删一条」——那样中途失败就会留下两条或零条。语义与失败顺序写在
// core.MomentReplacer 上：先发新的，成功了才删旧的。
//
// 这里不发图片参数：旧说说带的图由平台自己读回来并带过去（见 MomentReplacer 的
// 注释）。接口层拿不到那些图，也就不该假装能传。
func (m *ManagementServer) socialReplaceMoment(w http.ResponseWriter, r *http.Request, engine *Engine) {
	if !m.requireSocialWrites(w) {
		return
	}
	var body struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.ID) == "" {
		mgmtError(w, http.StatusBadRequest, "id required")
		return
	}
	if strings.TrimSpace(body.Text) == "" {
		mgmtError(w, http.StatusBadRequest, "text required")
		return
	}
	plat, caps := socialPlatform(engine)
	if plat == nil {
		mgmtError(w, http.StatusNotImplemented, "this project's platform cannot post to a timeline")
		return
	}
	replacer, ok := plat.(MomentReplacer)
	if !ok {
		mgmtError(w, http.StatusNotImplemented, "换说说 is not available here: this platform cannot replace a moment")
		return
	}
	if !caps.ReplaceMoment {
		// 和发说说一样：接口在、但这台机器上的配置没打开，是 403 不是 501。
		reason := caps.DisabledReason
		if reason == "" {
			reason = "replace is turned off"
		}
		mgmtError(w, http.StatusForbidden, "换说说 is turned off: "+reason)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), socialMomentTimeout)
	defer cancel()
	moment, err := replacer.ReplaceMoment(ctx, body.ID, body.Text)
	if err != nil {
		// 部分成功（新的发出去了、旧的还在）必须把新那条一起带回去，否则人只看
		// 到一句失败，不知道空间里已经多了一条，也不知道该删哪条。
		var partial *MomentReplacePartialError
		if errors.As(err, &partial) {
			mgmtErrorWithMoment(w, socialStatus(partial), socialMessage(partial), partial.Moment)
			return
		}
		mgmtError(w, socialStatus(err), socialMessage(err))
		return
	}
	if moment.ID == "" {
		// 走了干净路径却没有 id：不能算换完（也没法确认删对了哪条）。
		mgmtErrorWithMoment(w, http.StatusBadGateway,
			"换说说没有完成：新的已经发出，但平台没给新的 id，旧的没有动", moment)
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"moment": moment})
}

func (m *ManagementServer) socialDeleteMoment(w http.ResponseWriter, r *http.Request, engine *Engine) {
	if !m.requireSocialWrites(w) {
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.ID) == "" {
		mgmtError(w, http.StatusBadRequest, "id required")
		return
	}
	plat, caps := socialPlatform(engine)
	if plat == nil {
		mgmtError(w, http.StatusNotImplemented, "this project's platform cannot post to a timeline")
		return
	}
	if !caps.RemoveMoment {
		mgmtError(w, http.StatusForbidden, "说说 is turned off: "+caps.DisabledReason)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), socialMomentTimeout)
	defer cancel()
	if err := plat.(MomentPoster).RemoveMoment(ctx, body.ID); err != nil {
		mgmtError(w, socialStatus(err), socialMessage(err))
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]string{"result": "deleted"})
}

func (m *ManagementServer) socialSetAvatar(w http.ResponseWriter, r *http.Request, engine *Engine) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !m.requireSocialWrites(w) {
		return
	}
	plat, caps := socialPlatform(engine)
	if plat == nil {
		mgmtError(w, http.StatusNotImplemented, "this project's platform cannot change its avatar")
		return
	}
	if !caps.SetAvatar {
		mgmtError(w, http.StatusForbidden, "换头像 is turned off: "+caps.DisabledReason)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, socialMaxAvatar+socialBodySlack)
	if err := r.ParseMultipartForm(socialMaxAvatar + socialBodySlack); err != nil {
		mgmtError(w, http.StatusBadRequest, "multipart form with a file field expected: "+err.Error())
		return
	}
	f, header, err := r.FormFile("file")
	if err != nil {
		mgmtError(w, http.StatusBadRequest, "file required")
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, socialMaxAvatar+1))
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(b) == 0 {
		mgmtError(w, http.StatusBadRequest, "the file is empty")
		return
	}
	if len(b) > socialMaxAvatar {
		mgmtError(w, http.StatusRequestEntityTooLarge, "the picture is larger than 2 MiB")
		return
	}
	mime := http.DetectContentType(b)
	if !strings.HasPrefix(mime, "image/") {
		mgmtError(w, http.StatusBadRequest, "that file is not an image ("+mime+")")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), socialMomentTimeout)
	defer cancel()
	name := ""
	if header != nil {
		name = header.Filename
	}
	if err := plat.(AvatarSetter).SetAvatar(ctx, ImageAttachment{MimeType: mime, Data: b, FileName: name}); err != nil {
		mgmtError(w, socialStatus(err), socialMessage(err))
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"result": "changed", "mime": mime, "bytes": len(b)})
}

// socialStatus maps a platform error to an HTTP status: "not turned on" is the
// caller's config, "not supported" is the platform's ability, everything else
// is the upstream's failure.
func socialStatus(err error) int {
	switch {
	case errors.Is(err, ErrSocialDisabled):
		return http.StatusForbidden
	case errors.Is(err, ErrSocialUnsupported):
		return http.StatusNotImplemented
	case errors.Is(err, ErrSocialCannotReplace):
		// 不是上游坏了，是这条说说本身不能这么换（例：仅部分人可见）。
		return http.StatusBadRequest
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return http.StatusGatewayTimeout
	}
	return http.StatusBadGateway
}

// socialMessage keeps the platform's sentence (it names the config key or the
// upstream action) and drops the wrapping noise.
func socialMessage(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	msg = strings.TrimPrefix(msg, "qq: ")
	return msg
}
