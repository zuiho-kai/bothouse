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
	// format 固定要 snowluma：get_qzone_msg_list 不传 format 时，上游只要带了 cursor
	// 就改走 native（napcat-onebot/action/extends/qzone/common-snowluma.ts:174
	// normalizeQzoneListPayload）。native 那份 QzoneFeedItem
	// （napcat-core/data/qzone-rpc.ts:89-100）既没有可见范围字段，图片又是另一种形状
	// （media_items[].image.photo_url[].url.url，见 :202-225），换说说需要的那两样
	// 它都不给。传了 cursor 上游还会报「好友动态游标不能用于说说列表」，所以在
	// snowluma 下也别指望 cursor，分页靠 num。
	data, err := p.callAPIContext(ctx, "get_qzone_msg_list", map[string]any{
		"format": "snowluma",
		"num":    limit,
	})
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
			// 换说说把旧说说自带的图原样带过来时是 URL：NapCat 的 send_qzone_msg
			// 支持 http(s)://，让它自己去取，这里不必下载再传一遍。
			if u := strings.TrimSpace(img.URL); u != "" {
				files = append(files, u)
				continue
			}
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
	// Private 这里是真的知道的：这条是刚刚发出去的，没带 ugc_right，上游缺省 1 =
	// 所有人可见（napcat-onebot/action/extends/SendQzoneMsg.ts:16-17）。
	return core.Moment{ID: id, Text: text, Time: time.Now(), Images: []string{}, Private: false, PrivateKnown: true}, nil
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
//
// 可见范围不在这里替你决定：见 replaceAudienceBlocked。
func (p *Platform) ReplaceMoment(ctx context.Context, id, text string, opts core.MomentReplaceOptions) (core.Moment, error) {
	if err := p.qzoneOff(); err != nil {
		return core.Moment{}, err
	}
	if strings.TrimSpace(id) == "" {
		return core.Moment{}, fmt.Errorf("qq: 换说说需要原来是哪一条（tid）")
	}
	if strings.TrimSpace(text) == "" {
		return core.Moment{}, fmt.Errorf("qq: 换说说需要新的文字")
	}
	if qzoneHasTextEdit {
		// 上游将来若有正文编辑入口，在这里直接改那一条，不再发新删旧。
		return core.Moment{}, fmt.Errorf("qq: 换说说还没有接上正文编辑入口")
	}
	old, err := p.momentByID(ctx, id)
	if err != nil {
		// 读不回原来那条就不知道它带没带图。宁可什么都不发，也不发一条
		// 丢了图的「新版」再把原来的删掉。
		return core.Moment{}, fmt.Errorf("qq: 换说说：读不回原来那条，先不动它: %w", err)
	}
	if reason, blocked := replaceAudienceBlocked(old, opts); blocked {
		// 一个请求都不发：不发新的、更不删旧的。
		return core.Moment{}, fmt.Errorf("%s: %w", reason, core.ErrSocialCannotReplace)
	}
	carry, err := imagesForCarryOver(old)
	if err != nil {
		// 旧说说上的图带不过去（不是 http(s) 链接），同样不能发个没图的再删原的。
		return core.Moment{}, fmt.Errorf("qq: 换说说：旧说说的图带不过去，先不动它: %w", err)
	}
	published, err := p.PostMoment(ctx, text, carry)
	if err != nil {
		// 旧的那条没动：调用方可以照原样留着。
		return core.Moment{}, fmt.Errorf("qq: 换说说：新的没发出去，旧的原样保留: %w", err)
	}
	if published.ID == "" {
		// 新的发出去了，但上游没给 tid：既没法确认是哪一条，也没法保证删对了
		// 旧的。这时不能算换完，更不能去删旧的，只能如实说可能两条。
		return published, &core.MomentReplacePartialError{Moment: published, Err: fmt.Errorf(
			"qq: 换说说：新的已经发出，但上游没给 tid，没法确认是哪一条；旧的 %s 原样保留，空间里可能现在有两条", id)}
	}
	if err := p.RemoveMoment(ctx, id); err != nil {
		// 部分成功：两条都在。如实说，别让调用方以为替换干净了。
		return published, &core.MomentReplacePartialError{Moment: published, Err: fmt.Errorf(
			"qq: 换说说：新的已经发出（tid=%q），但旧的 %s 没删掉，现在空间里有两条；不要直接再点一次换，会再多一条: %w", published.ID, id, err)}
	}
	return published, nil
}

// replaceAudienceBlocked 决定「换这一条会不会动到谁能看见」，以及要不要为它停下。
//
// 分三种回不了头的情形。前两种和第三种的区别重要，它们是两个不同的「不知道」：
//
//  1. 上游根本没说可见范围（PrivateKnown 为假）——这份响应不是我们认识的形状。
//  2. 上游说是「仅部分人可见」（Private 为真）——只知道是或不是，说不出是哪一种，
//     而 send_qzone_msg 不传 ugc_right 时的缺省值是 1 = 所有人可见
//     （napcat-onebot/action/extends/SendQzoneMsg.ts:16）。换一条就是把有范围的说
//     说变公开，再删掉旧的，不可逆。
//  3. 上游说是「所有人可见」，但这个值有两种来源，桥接分不开：真的 secret == 0，
//     和 secret 缺失时 privateFlag 兜出来的 false（napcat-core/data/qzone-snowluma.ts:138-143）。
//     SnowLuma 那条路径的 is_private 是必填布尔（napcat-onebot/action/extends/
//     qzone/common-snowluma.ts:31），所以这里拿到的永远是一个规规矩矩的 false，
//     与「真的公开」逐字节相同——没有第二份证据能补（detail 不带可见范围，native
//     形状也没有这个字段）。这种 false 不能当授权用。
//
// 所以第 3 种不是靠猜来决策，而是把它交回给人：只有调用方明确说了「我知道这可能
// 改变可见范围」（opts.AcceptAudienceChange），才走发新删旧。默认值是「不换」。
// 前两种连人确认也不行——那两种是「已经确定会改宽」，不是「可能」。
//
// 返回的 reason 是给人看的那句话；blocked 为真时调用方一个上游请求都不要发。
func replaceAudienceBlocked(old core.Moment, opts core.MomentReplaceOptions) (reason string, blocked bool) {
	if !old.PrivateKnown {
		return "qq: 换说说：上游没说原来那条的可见范围（不是认识的响应形状），换一条有可能把它变成所有人可见，所以先不动它", true
	}
	if old.Private {
		return "qq: 换说说：原来那条是「仅部分人可见」，上游只能告诉我们是或不是、说不出具体范围，换一条会把它变成所有人可见，所以先不动它（要改的话在 QQ 里手动改）", true
	}
	if !opts.AcceptAudienceChange {
		return "qq: 换说说：读到的「所有人可见」也可能只是上游没读到可见范围时补的缺省值，换一条有可能把它变成所有人可见、而且删掉旧的之后不可逆，所以要先确认一次（没确认就不动它）", true
	}
	return "", false
}

// qzoneReplaceLookback 是换说说回读旧说说时翻的最近条数。
// 来源：沿用 core/management_social.go socialMomentLimit 的上限 50（面板一次最多拉
// 50 条），再老的说说不在这批里，此时按「读不回」处理，宁可不换也不丢图。
const qzoneReplaceLookback = 50

// momentByID 读回自己的一条说说。换说说要靠它拿到旧说说自带的图和可见范围，
// 才能决定「能不能换」并把图原样带到新的一条上；读不到就是读不到，不做猜测。
func (p *Platform) momentByID(ctx context.Context, id string) (core.Moment, error) {
	moments, err := p.ListMoments(ctx, qzoneReplaceLookback)
	if err != nil {
		return core.Moment{}, err
	}
	for _, m := range moments {
		if m.ID == id {
			return m, nil
		}
	}
	return core.Moment{}, fmt.Errorf("最近 %d 条说心里没有 %s（太老的那条读不回来）", qzoneReplaceLookback, id)
}

// imagesForCarryOver turns the picture URLs read back from an existing post into
// the images of the new one. They stay URLs: NapCat accepts http(s):// and
// fetches them itself, so the picture is not downloaded and re-uploaded here.
//
// Only http(s) is accepted. NapCat would also take file://, and handing it a path
// that came out of an upstream response would let that response name a local
// file; an old post's pictures are always http(s) in practice, so anything else
// is treated as "cannot carry the pictures over" rather than as a special case.
func imagesForCarryOver(m core.Moment) ([]core.MomentImage, error) {
	if len(m.Images) == 0 {
		return nil, nil
	}
	out := make([]core.MomentImage, 0, len(m.Images))
	total := len(m.Images)
	for _, u := range m.Images {
		u = strings.TrimSpace(u)
		if u == "" {
			// 上游给了几张图，其中一张没有地址。跳过它就会让新的一条比旧的一条少图：
			// 旧的一删，那张图就真没了，而调用方还以为「带过去了」。少一张也算丢图，
			// 所以按「带不过去」处理，一个请求都不发。
			return nil, fmt.Errorf("旧说说上有 %d 张图，其中一张没有地址（上游响应不完整），带过去会少一张", total)
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			return nil, fmt.Errorf("图片地址不是 http(s) 链接：%q", u)
		}
		out = append(out, core.MomentImage{URL: u})
	}
	return out, nil
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
		ID:     stringOf(m["tid"]),
		Text:   stringOf(m["content"]),
		Images: []string{},
	}
	out.Private, out.PrivateKnown = privateOf(m)
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

// privateOf reads the audience flag off one row of get_qzone_msg_list and says
// whether it actually got an answer.
//
// 两个返回值都要：第二个为 false 表示「上游什么都没说 / 说了个不认识的值」，
// 而不是「公开」。把它当公开就是在拿别人的可见范围做赌注（见 ReplaceMoment）。
// 取值照 NapCat 的 privateFlag（napcat-core/data/qzone-snowluma.ts:138-143）认：
// 布尔、数字、纯数字字符串；其它形状不猜。
func privateOf(m map[string]any) (private bool, known bool) {
	switch v := m["is_private"].(type) {
	case bool:
		return v, true
	case float64:
		return v != 0, true
	case string:
		if v == "" {
			return false, false
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return false, false
		}
		return n != 0, true
	}
	return false, false
}
