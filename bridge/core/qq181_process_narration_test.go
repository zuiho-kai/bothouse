package core

import (
	"context"
	"strings"
	"testing"
)

// #181 second failure, measured in BotHouse qq-bridge.log lines 11072-11075
// (2026-11-08 20:06): the turn's text "手滑了 别笑" went out at
// 20:06:52.492 (out_message_id=1675914320), its sticker at 20:06:52.874
// (out_message_id=1750422960, "[image image/jpeg 34840 bytes]"), and the final
// reply at 20:06:56.780 (out_message_id=281387825, content_len=27) was only
// "不好意思，我先把这条回复发出去，再把相关表情包发出去。". The stored session
// (s118 history[426]) keeps the model's raw line glued to the already-sent text:
//
//	手滑了 别笑不好意思，我先把这条回复发出去，再把相关表情包发出去。

type qq181NonTextPlatform struct {
	qq137RepeatPlatform
	images []ImageAttachment
}

func (p *qq181NonTextPlatform) SendImage(_ context.Context, _ any, img ImageAttachment) error {
	p.images = append(p.images, img)
	return nil
}

func qq181NonTextFixture(t *testing.T, key string) (*Engine, *interactiveState, *qq181NonTextPlatform) {
	t.Helper()
	p := &qq181NonTextPlatform{}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDisplayConfig(DisplayCfg{Mode: "compact"})
	e.sessions.GetOrCreateActive(key)
	a := &qq137FixtureSession{newControllableSession("qq181-nontext")}
	state := &interactiveState{agentSession: a, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state
	return e, state, p
}

// ① A turn that already pushed a sticker must not post the closing send-step
// narration, on both the normal and the channel-closed exit, and the text the
// script had already sent is not posted a second time.
func TestQQ181ProcessNarrationAfterNonTextIsDropped(t *testing.T) {
	const key = "test:qq181-narration-nontext"
	const glued = "手滑了 别笑不好意思，我先把这条回复发出去，再把相关表情包发出去。"
	sticker := []ImageAttachment{{MimeType: "image/jpeg", Data: []byte("sticker")}}

	cases := []struct {
		name    string
		message string
		reply   string
		want    []string
	}{
		{"measured turn, glued line", "手滑了 别笑", glued, []string{"手滑了 别笑"}},
		{"sticker only, narration only", "", "不好意思，我先把这条回复发出去，再把相关表情包发出去。", nil},
	}
	for _, tc := range cases {
		for _, closeOnly := range []bool{false, true} {
			e, state, p := qq181NonTextFixture(t, key)
			if err := e.SendToSessionWithAttachments(key, tc.message, sticker, nil, nil, false); err != nil {
				t.Fatalf("%s closeOnly=%v: sticker send: %v", tc.name, closeOnly, err)
			}
			qq181Turn(t, e, p, key, state, []string{tc.reply}, closeOnly)

			if got := p.getSent(); strings.Join(got, "\n") != strings.Join(tc.want, "\n") {
				t.Fatalf("%s closeOnly=%v: channel got %q, want %q", tc.name, closeOnly, got, tc.want)
			}
			if len(p.images) != 1 {
				t.Fatalf("%s closeOnly=%v: sticker not sent: %d", tc.name, closeOnly, len(p.images))
			}
		}
	}
}

// ② A turn that already pushed a sticker but ends with a real answer must still
// deliver it unchanged: the guard is clause-shaped, not a media flag that
// swallows the whole reply.
func TestQQ181NormalAnswerAfterNonTextStillSent(t *testing.T) {
	const key = "test:qq181-normal-nontext"
	answers := []string{
		"这张图挺好，我发给你了。",
		"哈哈 这张表情包太合适了",
		"图收到了，明天再聊",
	}
	for _, reply := range answers {
		e, state, p := qq181NonTextFixture(t, key)
		if err := e.SendToSessionWithAttachments(key, "", []ImageAttachment{{MimeType: "image/jpeg", Data: []byte("sticker")}}, nil, nil, false); err != nil {
			t.Fatalf("sticker send: %v", err)
		}
		qq181Turn(t, e, p, key, state, []string{reply}, false)
		if got := strings.Join(p.getSent(), "\n"); !strings.Contains(got, reply) {
			t.Fatalf("normal answer after a sticker was lost: got %q, want %q", p.getSent(), reply)
		}
	}
	// The same wording as an answer stays: a finished send or a plain apology
	// carries no pending step, so the guard leaves it alone.
	for _, text := range []string{
		"文件我已经发出去了，你看一下。",
		"这条回复发出去之后我就下线了",
		"刚才那张图片发出去没？",
		"不好意思，刚才看错了。",
	} {
		if got, ok := stripSendProcessNarration(text); ok && got != text {
			t.Fatalf("ordinary answer rewritten: %q -> %q", text, got)
		}
	}
}

// ③ A pure-text turn with no intermediate message keeps its old behaviour: the
// narration-shaped sentence is still posted, because the guard only applies once
// a non-text message went out this turn.
func TestQQ181PureTextTurnUnchanged(t *testing.T) {
	const key = "test:qq181-narration-textonly"
	const reply = "不好意思，我先把这条回复发出去，再把相关表情包发出去。"
	e, state, p := qq181NonTextFixture(t, key)
	qq181Turn(t, e, p, key, state, []string{reply}, false)
	if got := strings.Join(p.getSent(), "\n"); !strings.Contains(got, reply) {
		t.Fatalf("pure-text turn lost its reply: %q", p.getSent())
	}
	if len(p.images) != 0 {
		t.Fatalf("no sticker expected: %d", len(p.images))
	}
}
