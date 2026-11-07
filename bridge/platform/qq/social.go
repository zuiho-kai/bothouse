package qq

// QQ 空间说说与改头像（#150 第 c 项 · 发说说 / 换说说 / 换头像）。
//
// 这两个动作都会以账号本人的身份对外生效：说说别人看得见，头像所有地方都
// 看得见。所以实现放在可选能力接口后面，而且必须由配置显式打开：
//
//	[[projects.platforms]]
//	type = "qq"
//	[projects.platforms.options]
//	allow_qzone  = true   # 允许查/发/删自己的说说
//	allow_avatar = true   # 允许换自己的头像
//
// 默认都是关的：老配置照常加载、照常跑，只是这两个接口回 ErrSocialDisabled。
//
// 说说相关的 OneBot action（send_qzone_msg / delete_qzone_msg /
// get_qzone_msg_list）不在 OneBot 11 规范里，是 NapCat 的扩展；换头像的
// set_qq_avatar 在 NapCat 账号接口里。上游没有这些 action 时，调用会带回
// 非 0 retcode，这里翻成一句人话而不是只扔 retcode。

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// socialMaxImage: 头像和说说配图的大小上限。
// 来源：沿用 core/library.go 的 libraryMaxImage（2 MiB，常见头像上传上限）。
const socialMaxImage = 2 << 20

// socialCallTimeout: 这些动作都要上游落盘/走 CDN，比普通发消息慢。
// 来源：沿用 core/imagegen.go 里对同一条链路的 240s 判断再收紧，这里只发
// 一张已经拿到的图，取 60s 足够覆盖慢网络又不至于挂住面板请求。
const socialCallTimeout = 60 * time.Second

var (
	_ core.MomentPoster             = (*Platform)(nil)
	_ core.MomentReplacer           = (*Platform)(nil)
	_ core.AvatarSetter             = (*Platform)(nil)
	_ core.SocialCapabilityReporter = (*Platform)(nil)
)

// qzoneHasTextEdit reports whether NapCat exposes an upstream call that edits
// the words of an existing 说说 in place. As of the NapCat build this was
// written against (2026-11-08, napcat-core/apis/qzone.ts) the action list has
// send/delete/list/detail/comments/like and SetQzoneMsgRight (visibility only);
// there is no text-edit action. Kept as a named constant so that when NapCat
// grows one, the replacement path below is the single place to change.
// 来源：NapCat apifox 文档与 napcat-core/apis/qzone.ts 的 WEB_METHODS/RPC_METHODS
// 两张表，都没有修改说说正文的入口；只有 emotion_cgi_update 改权限。
const qzoneHasTextEdit = false

// SocialCapabilities reports what this bot may do right now: the interface is
// implemented either way, the config decides whether it is turned on.
func (p *Platform) SocialCapabilities() core.SocialCapabilities {
	c := core.SocialCapabilities{}
	var reasons []string
	if p.allowQzone {
		c.ListMoments, c.PostMoment, c.RemoveMoment, c.ReplaceMoment = true, true, true, true
	} else {
		reasons = append(reasons, "allow_qzone is off in this project's qq options")
	}
	if p.allowAvatar {
		c.SetAvatar = true
	} else {
		reasons = append(reasons, "allow_avatar is off in this project's qq options")
	}
	c.DisabledReason = strings.Join(reasons, "; ")
	return c
}

func (p *Platform) qzoneOff() error {
	if !p.allowQzone {
		return fmt.Errorf("qq: 空间说说没有打开（配置里 allow_qzone = false）: %w", core.ErrSocialDisabled)
	}
	return nil
}

// ListMoments reads the bot's own recent posts, newest first.
func (p *Platform) ListMoments(ctx context.Context, limit int) ([]core.Moment, error) {
	if err := p.qzoneOff(); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20 // 来源：与面板「最近」列表默认条数一致，见 core/imagegen.go imageGenRecentDefault
	}
	ctx, cancel := context.WithTimeout(ctx, socialCallTimeout)
	defer cancel()
	data, err := p.callAPIContext(ctx, "get_qzone_msg_list", map[string]any{"num": limit})
	if err != nil {
		return nil, fmt.Errorf("qq: 读说说列表: %w", socialErrHint(err))
	}
	raw, _ := data["msglist"].([]any)
	out := make([]core.Moment, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, momentFromAPI(m))
	}
	return out, nil
}

// PostMoment publishes text (plus pictures) to the bot's own timeline.
func (p *Platform) PostMoment(ctx context.Context, text string, images []core.MomentImage) (core.Moment, error) {
	if err := p.qzoneOff(); err != nil {
		return core.Moment{}, err
	}
	if strings.TrimSpace(text) == "" && len(images) == 0 {
		return core.Moment{}, fmt.Errorf("qq: 说说需要文字或至少一张图")
	}
	// 一条说说最多 9 张图是 QQ 自己的限制，不是这里定的；给多了上游会拒，
	// 不如先拒并说清楚。
	const maxImages = 9 // 来源：QQ空间单条说说图片上限 9 张（客户端行为）
	if len(images) > maxImages {
		return core.Moment{}, fmt.Errorf("qq: 一条说说最多 %d 张图，这次给了 %d 张", maxImages, len(images))
	}
	params := map[string]any{"content": text}
	if len(images) > 0 {
		files := make([]string, 0, len(images))
		for _, img := range images {
			if len(img.Data) == 0 {
				continue
			}
			if len(img.Data) > socialMaxImage {
				return core.Moment{}, fmt.Errorf("qq: 图片 %s 有 %d 字节，超过 %d 上限",
					img.Name, len(img.Data), socialMaxImage)
			}
			files = append(files, "base64://"+base64.StdEncoding.EncodeToString(img.Data))
		}
		if len(files) > 0 {
			params["images"] = files
		}
	}
	ctx, cancel := context.WithTimeout(ctx, socialCallTimeout)
	defer cancel()
	data, err := p.callAPIContext(ctx, "send_qzone_msg", params)
	if err != nil {
		return core.Moment{}, fmt.Errorf("qq: 发说说: %w", socialErrHint(err))
	}
	id := stringOf(data["tid"])
	if id == "" {
		// 上游没说 tid，但请求确实发出去了：不重试，也不假装有 id。
		slog.Warn("qq: 说说已发出但上游没给 tid", "images", len(images))
	}
	// Images 总是数组：面板直接读 .length，nil 会让它算不出来。
	return core.Moment{ID: id, Text: text, Time: time.Now(), Images: []string{}, Private: false}, nil
}

// RemoveMoment deletes one of the bot's own posts.
func (p *Platform) RemoveMoment(ctx context.Context, id string) error {
	if err := p.qzoneOff(); err != nil {
		return err
	}
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("qq: 删除说说需要 tid")
	}
	ctx, cancel := context.WithTimeout(ctx, socialCallTimeout)
	defer cancel()
	if _, err := p.callAPIContext(ctx, "delete_qzone_msg", map[string]any{"tid": id}); err != nil {
		return fmt.Errorf("qq: 删说说 %s: %w", id, socialErrHint(err))
	}
	return nil
}

// ReplaceMoment replaces one of the bot's own posts with new words in a single
// call. QQ空间 has no text-edit upstream call (see qzoneHasTextEdit), so this is
// publish-then-delete: the new post goes out first, and only then is the old one
// deleted. That order is deliberate — if publishing fails, the old post is still
// there, so a caller never loses what it had. If publishing worked but the delete
// then failed, both posts exist and the error says so instead of pretending the
// replacement was clean.
func (p *Platform) ReplaceMoment(ctx context.Context, id, text string, images []core.MomentImage) (core.Moment, error) {
	if err := p.qzoneOff(); err != nil {
		return core.Moment{}, err
	}
	if strings.TrimSpace(id) == "" {
		return core.Moment{}, fmt.Errorf("qq: 换说说需要原来是哪一条（tid）")
	}
	if strings.TrimSpace(text) == "" && len(images) == 0 {
		return core.Moment{}, fmt.Errorf("qq: 换说说需要文字或至少一张图")
	}
	if qzoneHasTextEdit {
		// 上游将来若有正文编辑入口，在这里直接改那一条，不再发新删旧。
		return core.Moment{}, fmt.Errorf("qq: 换说说还没有接上正文编辑入口")
	}
	published, err := p.PostMoment(ctx, text, images)
	if err != nil {
		// 旧的那条没动：调用方可以照原样留着。
		return core.Moment{}, fmt.Errorf("qq: 换说说：新的没发出去，旧的原样保留: %w", err)
	}
	if err := p.RemoveMoment(ctx, id); err != nil {
		// 两条都在。如实说，别让调用方以为替换干净了。
		return published, fmt.Errorf("qq: 换说说：新的已经发出（tid=%s），但旧的 %s 没删掉，现在空间里有两条: %w", published.ID, id, err)
	}
	return published, nil
}

// SetAvatar replaces the bot account's avatar with the given picture.
func (p *Platform) SetAvatar(ctx context.Context, img core.ImageAttachment) error {
	if !p.allowAvatar {
		return fmt.Errorf("qq: 换头像没有打开（配置里 allow_avatar = false）: %w", core.ErrSocialDisabled)
	}
	if len(img.Data) == 0 {
		return fmt.Errorf("qq: 头像是空文件")
	}
	if len(img.Data) > socialMaxImage {
		return fmt.Errorf("qq: 头像 %d 字节，超过 %d 上限", len(img.Data), socialMaxImage)
	}
	ctx, cancel := context.WithTimeout(ctx, socialCallTimeout)
	defer cancel()
	params := map[string]any{"file": "base64://" + base64.StdEncoding.EncodeToString(img.Data)}
	if _, err := p.callAPIContext(ctx, "set_qq_avatar", params); err != nil {
		return fmt.Errorf("qq: 换头像: %w", socialErrHint(err))
	}
	return nil
}

// socialErrHint adds one sentence a person can act on when the OneBot
// implementation simply does not have the extension action.
func socialErrHint(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	// NapCat 对未知 action 回 retcode=1404 / "unsupported"，不同分支措辞不一，
	// 这里按最常见两种认。
	if strings.Contains(msg, "retcode=1404") || strings.Contains(strings.ToLower(msg), "unsupported") {
		return fmt.Errorf("%w（这个 OneBot 实现没有这个扩展接口：说说要 NapCat 的空间扩展，头像要 NapCat 账号接口；升级 NapCat 后重试）", err)
	}
	return err
}

func momentFromAPI(m map[string]any) core.Moment {
	out := core.Moment{
		ID:      stringOf(m["tid"]),
		Text:    stringOf(m["content"]),
		Images:  []string{},
		Private: boolOf(m["is_private"]),
	}
	if sec := jsonInt64(m, "time"); sec > 0 {
		out.Time = time.Unix(sec, 0)
	}
	switch images := m["images"].(type) {
	case []any:
		for _, one := range images {
			switch v := one.(type) {
			case string:
				if v != "" {
					out.Images = append(out.Images, v)
				}
			case map[string]any:
				if u := stringOf(v["url"]); u != "" {
					out.Images = append(out.Images, u)
				}
			}
		}
	}
	return out
}

// stringOf reads a value that may arrive as a string or a number (OneBot
// implementations disagree on tid/uin types).
func stringOf(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatInt(int64(t), 10)
	case int64:
		return strconv.FormatInt(t, 10)
	case bool:
		if t {
			return "true"
		}
		return "false"
	}
	return ""
}

func boolOf(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t == "true" || t == "1"
	}
	return false
}
