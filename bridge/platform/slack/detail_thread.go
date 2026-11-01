package slack

import (
	"context"
	"fmt"

	"github.com/slack-go/slack"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.DetailThreadSender = (*Platform)(nil)

// SendWithDetail implements core.DetailThreadSender: text goes to the channel, detail into the
// thread of that message (in a thread already, both go there).
func (p *Platform) SendWithDetail(ctx context.Context, rctx any, text, title, detail string) error {
	rc, ok := rctx.(replyContext)
	if !ok {
		return fmt.Errorf("slack: invalid reply context type %T", rctx)
	}
	post := func(content, thread string) (string, error) {
		opts := []slack.MsgOption{slack.MsgOptionText(core.MarkdownToSlackMrkdwn(content), false)}
		if thread != "" {
			opts = append(opts, slack.MsgOptionPostMessageParameters(slack.PostMessageParameters{ThreadTimestamp: thread}))
		}
		_, ts, err := p.client.PostMessageContext(ctx, rc.channel, opts...)
		if err != nil {
			return "", fmt.Errorf("slack: send: %w", err)
		}
		return ts, nil
	}
	ts, err := post(text, rc.timestamp)
	if err != nil {
		return err
	}
	thread := rc.timestamp
	if thread == "" {
		thread = ts
	}
	_, err = post(title+"\n"+detail, thread)
	return err
}
