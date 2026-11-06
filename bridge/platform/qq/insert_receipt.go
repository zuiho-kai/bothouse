package qq

import (
	"context"
	"fmt"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// This file confirms a mid-turn insert by reacting to the person's own message
// instead of posting "↪ 已插入" into the chat (user 2026-11-05 15:2x「点表情可以
// 考虑加上 回头可以加」). The text receipt stays as the fallback; core decides that
// (core/quiet_notice.go insertNotice).

// insertReceiptEmoji is the QQ face id put on the message that was inserted.
// 来源: NapCat 的 face_config.json 里 QSid 76 = /赞（点赞手势），是 QQ 自带表情、
// 不需要订阅或表情包。2026-11-06 在测试群实拍：set_msg_emoji_like 返回 result 0，
// get_emoji_likes 能读回本号那一条。
const insertReceiptEmoji = "76"

// insertReceiptTimeout bounds the reaction call on the gate's hot path: the insert
// itself has already been delivered to the running turn and must not wait on this
// acknowledgment. 来源: 2026-11-06 实测一次 set_msg_emoji_like 耗时 116ms（NapCat
// 4.18.42），5s 是留足慢链路后仍不会拖住一条插入消息的上限；超时即按失败降级。
const insertReceiptTimeout = 5 * time.Second

var _ core.InsertReceiptReactor = (*Platform)(nil)

// ReactInsertReceipt puts a QQ face on the message that was just folded into the
// running turn. A nil return means the person got the acknowledgment; any error
// means core must fall back to the old receipt rule (silent in QQ chats, text
// elsewhere), which is why no error here ever changes whether the message itself
// was delivered.
//
// Two limits are known from NapCat 4.18.42 (2026-11-06, test group + own private
// chat):
//   - private chats: the call answers retcode 0 but result=65011「操作失败」 and no
//     reaction appears, so private chats are not attempted at all;
//   - the reply carries no inbound message id (proactive sends), so there is
//     nothing to react to.
//
// NapCat also reports business failures inside data (result/errMsg) while retcode
// stays 0, so the data payload is checked, not only the retcode.
func (p *Platform) ReactInsertReceipt(replyCtx any) error {
	rc, ok := replyCtx.(*replyContext)
	if !ok || rc == nil {
		return fmt.Errorf("qq: reaction: invalid reply context type %T", replyCtx)
	}
	if rc.messageType != "group" {
		return fmt.Errorf("qq: reaction: NapCat cannot react in a %s chat (result 65011)", rc.messageType)
	}
	if rc.inMessageID == "" {
		return fmt.Errorf("qq: reaction: no inbound message id to react to")
	}

	ctx, cancel := context.WithTimeout(context.Background(), insertReceiptTimeout)
	defer cancel()
	result, err := p.callAPIContext(ctx, "set_msg_emoji_like", map[string]any{
		"message_id": rc.inMessageID,
		"emoji_id":   insertReceiptEmoji,
	})
	if err != nil {
		return fmt.Errorf("qq: reaction: %w", err)
	}
	if code, msg := reactionFailure(result); code != 0 {
		return fmt.Errorf("qq: reaction: NapCat result %d: %s", code, msg)
	}
	return nil
}

// reactionFailure reads NapCat's business result: 0/absent means the reaction was
// set, anything else is a failure with the upstream wording (65011「操作失败，请稍后
// 再试哦」, 65003「未设置过该表情」).
func reactionFailure(result map[string]any) (int, string) {
	if result == nil {
		return 0, ""
	}
	code := int(jsonInt64(result, "result"))
	msg, _ := result["errMsg"].(string)
	if code == 0 {
		return 0, ""
	}
	return code, msg
}
