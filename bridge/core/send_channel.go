package core

// `bothouse send --channel <name>`: send to another channel of the same server by its name, and
// say where a cross-channel send went. User 11-11「我说转给jiuwen，怎么转到这来了」: the role had
// no way to look a channel up by name, took a channel ID from an old conversation, and `send`
// only printed "Message sent successfully", so the wrong channel went unnoticed.

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// NamedChannel is a channel a message can be sent to, with the category it sits in.
type NamedChannel struct {
	ID       string
	Name     string
	Category string // "" = no category
}

// GuildChannelLister is implemented by platforms that can list the channels of the server a
// channel is in (Discord). Only channels that take ordinary messages: no categories, voice
// channels, forums or threads.
type GuildChannelLister interface {
	GuildMessageChannels(ctx context.Context, besideChannelID string) ([]NamedChannel, error)
}

func channelNameKey(name string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(name), "#"))
}

func describeChannels(list []NamedChannel) string {
	parts := make([]string, 0, len(list))
	for _, c := range list {
		cat := c.Category
		if cat == "" {
			cat = "无分类"
		}
		parts = append(parts, fmt.Sprintf("#%s（%s，分类「%s」）", c.Name, c.ID, cat))
	}
	return strings.Join(parts, "；")
}

// pickChannelByName returns the one channel named name (case-insensitive, a leading # ignored).
// No match or more than one is an error that lists the candidates; it never picks for the caller.
func pickChannelByName(list []NamedChannel, name string) (NamedChannel, error) {
	want := channelNameKey(name)
	if want == "" {
		return NamedChannel{}, fmt.Errorf("--channel requires a channel name")
	}
	var exact, near []NamedChannel
	for _, c := range list {
		key := channelNameKey(c.Name)
		switch {
		case key == want:
			exact = append(exact, c)
		case strings.Contains(key, want) || strings.Contains(want, key):
			near = append(near, c)
		}
	}
	switch {
	case len(exact) == 1:
		return exact[0], nil
	case len(exact) > 1:
		return NamedChannel{}, fmt.Errorf("没发：本服务器有 %d 个叫「%s」的频道：%s。问清用户要哪一个，再用 --session <平台>:<编号> 发", len(exact), want, describeChannels(exact))
	case len(near) > 0:
		if len(near) > 10 {
			near = near[:10]
		}
		return NamedChannel{}, fmt.Errorf("没发：本服务器没有叫「%s」的频道。名字相近的：%s。不要猜，对不上就问用户", want, describeChannels(near))
	}
	return NamedChannel{}, fmt.Errorf("没发：本服务器没有叫「%s」的频道，也没有名字相近的。不要猜编号，问用户", want)
}

// ChannelSessionByName finds the channel called name in the server of fromSession (the caller's
// own session) and returns the session key to send to and the channel.
func (e *Engine) ChannelSessionByName(fromSession, name string) (string, NamedChannel, error) {
	chat := chatOf(strings.TrimSpace(fromSession))
	plat, id, found := strings.Cut(chat, ":")
	if !found || plat == "" || id == "" {
		return "", NamedChannel{}, fmt.Errorf("--channel looks the name up in the server of the current conversation: run it inside a bothouse agent session (CC_SESSION_KEY)")
	}
	l, ok := e.platformForName(plat).(GuildChannelLister)
	if !ok {
		return "", NamedChannel{}, fmt.Errorf("platform %q cannot find channels by name (Discord only)", plat)
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	list, err := l.GuildMessageChannels(ctx, id)
	if err != nil {
		return "", NamedChannel{}, fmt.Errorf("list channels: %w", err)
	}
	ch, err := pickChannelByName(list, name)
	if err != nil {
		return "", NamedChannel{}, err
	}
	return plat + ":" + ch.ID, ch, nil
}

// sentChannel names the channel of sessionKey for the send echo; ok is false when the platform
// cannot tell (then nothing is echoed rather than a guess).
func (e *Engine) sentChannel(sessionKey string) (id, name string, ok bool) {
	plat, id, found := strings.Cut(chatOf(sessionKey), ":")
	if !found || id == "" {
		return "", "", false
	}
	r, isResolver := e.platformForName(plat).(ChannelNameResolver)
	if !isResolver {
		return "", "", false
	}
	name, err := r.ResolveChannelName(id)
	if err != nil || name == "" || name == id {
		return "", "", false
	}
	return id, name, true
}
