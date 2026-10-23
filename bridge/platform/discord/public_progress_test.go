package discord

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

type progressREST struct {
	botID       string
	seenAuth    []string
	messages    map[string][]*discordgo.Message
	thread      bool
	loseACK     bool
	failHistory bool
	postStatus  int // non-zero: reply to POST /messages with this HTTP status
	sends       int
	guild       string
	channelType discordgo.ChannelType
}

func (r *progressREST) RoundTrip(req *http.Request) (*http.Response, error) {
	r.seenAuth = append(r.seenAuth, req.Header.Get("Authorization"))
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	path := strings.Split(strings.Trim(req.URL.Path, "/"), "/")
	channel := ""
	for i, v := range path {
		if v == "channels" && i+1 < len(path) {
			channel = path[i+1]
		}
	}
	code := 200
	var body any = map[string]any{}
	switch {
	case req.Method == "GET" && strings.HasSuffix(req.URL.Path, "/messages"):
		if r.failHistory {
			return nil, errors.New("history unavailable")
		}
		body = r.messages[channel]
		if body == nil {
			body = []any{}
		}
	case req.Method == "POST" && strings.HasSuffix(req.URL.Path, "/messages"):
		var data discordgo.MessageSend
		if err := json.NewDecoder(req.Body).Decode(&data); err != nil {
			return nil, err
		}
		if data.AllowedMentions == nil || len(data.AllowedMentions.Parse) > 0 || len(data.AllowedMentions.Users) > 0 {
			return nil, errors.New("mentions not suppressed")
		}
		if r.postStatus != 0 {
			b, _ := json.Marshal(map[string]any{"code": 50001, "message": "Missing Access"})
			return &http.Response{StatusCode: r.postStatus, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(b))), Request: req}, nil
		}
		r.sends++
		m := &discordgo.Message{ID: fmt.Sprint(r.sends + 100), ChannelID: channel, Author: &discordgo.User{ID: "bot"}, Embeds: data.Embeds, Timestamp: time.Now()}
		if r.botID != "" {
			m.Author.ID = r.botID
		}
		r.messages[channel] = append([]*discordgo.Message{m}, r.messages[channel]...)
		body = m
		if r.loseACK {
			r.loseACK = false
			return nil, errors.New("lost successful POST response")
		}
	case req.Method == "PATCH":
		body = &discordgo.Message{ID: "101", ChannelID: channel}
	case strings.HasSuffix(req.URL.Path, "/threads"):
		r.thread = true
		body = &discordgo.Channel{ID: "101", Type: discordgo.ChannelTypeGuildPublicThread}
	case req.Method == "GET":
		if channel == "101" && !r.thread {
			code = 404
			body = map[string]any{"code": 10003, "message": "Unknown Channel"}
		} else {
			body = &discordgo.Channel{ID: channel, Type: r.channelType, GuildID: r.guild}
		}
	default:
		return nil, fmt.Errorf("unexpected API request %s %s", req.Method, req.URL.Path)
	}
	b, _ := json.Marshal(body)
	return &http.Response{StatusCode: code, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(b))), Request: req}, nil
}

func TestPublicTaskWorkerUsesOwnAccountSameThread(t *testing.T) {
	transport := &progressREST{messages: map[string][]*discordgo.Message{}}
	newPlatform := func(id, token string) *Platform {
		session, err := discordgo.New(token)
		if err != nil {
			t.Fatal(err)
		}
		session.Client = &http.Client{Transport: transport}
		session.MaxRestRetries = 0
		return &Platform{session: session, botID: id}
	}
	lead, worker := newPlatform("lead", "Bot fixture-lead"), newPlatform("worker", "Bot fixture-worker")
	task := &core.Task{ID: "task-member", Title: "Task", ChannelID: "room", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	transport.botID = "lead"
	if err := lead.EnsureTaskCard(context.Background(), task, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	for _, auth := range transport.seenAuth {
		if auth != "Bot fixture-lead" {
			t.Fatal("card used wrong account")
		}
	}
	transport.seenAuth = nil
	transport.botID, transport.loseACK = "worker", true
	ev := core.TaskEvent{ID: "task-member:2", Summary: "gjiang: Started", ReporterProject: "gjiang", Timestamp: time.Now(), IsKeyFact: true}
	if err := worker.PublishTaskFact(context.Background(), task, ev, core.LangEnglish); err == nil {
		t.Fatal("lost ACK was not surfaced")
	}
	if err := worker.PublishTaskFact(context.Background(), task, ev, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	if transport.sends != 2 || len(transport.messages[task.ThreadID]) != 1 || transport.messages[task.ThreadID][0].Author.ID != "worker" {
		t.Fatal("worker fact duplicated or sent outside shared thread")
	}
	for _, auth := range transport.seenAuth {
		if auth != "Bot fixture-worker" {
			t.Fatal("worker fact used creator account")
		}
	}
}

func TestPublicTaskWorkerDetailResumesAfterLostACK(t *testing.T) {
	transport := &progressREST{messages: map[string][]*discordgo.Message{}, botID: "worker"}
	session, _ := discordgo.New("Bot fixture-worker")
	session.Client = &http.Client{Transport: transport}
	session.MaxRestRetries = 0
	worker := &Platform{session: session, botID: "worker"}
	task := &core.Task{ID: "shared-task", ChannelID: "room", ThreadID: "shared-thread"}
	ev := core.TaskEvent{ID: "shared-task:result", Summary: "Worker result", Detail: strings.Repeat("进展🙂", maxDiscordLen), Timestamp: time.Now()}
	// Simulate a partial delivery: summary confirmed, first detail POST lost ACK.
	if err := worker.publishTaskFactPart(context.Background(), task, ev, core.LangEnglish, "cc-task-event:"+ev.ID, ev.Summary); err != nil {
		t.Fatal(err)
	}
	transport.loseACK = true
	if err := worker.PublishTaskFact(context.Background(), task, ev, core.LangEnglish); err == nil {
		t.Fatal("lost detail ACK was not surfaced")
	}
	if err := worker.PublishTaskFact(context.Background(), task, ev, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	parts := append([]string{ev.Summary}, core.SplitMessageCodeFenceAware(ev.Detail, maxDiscordLen)...)
	messages := transport.messages[task.ThreadID]
	if transport.sends != len(parts) || len(messages) != len(parts) || len(transport.messages[task.ChannelID]) != 0 {
		t.Fatal("missing detail, duplicate delivery, or escaped shared thread")
	}
	for i, part := range parts {
		m := messages[len(messages)-1-i]
		if m.Author.ID != "worker" || m.Embeds[0].Description != part {
			t.Fatal("worker identity or public result text lost")
		}
	}
	for _, auth := range transport.seenAuth {
		if auth != "Bot fixture-worker" {
			t.Fatal("detail used creator account")
		}
	}
}

func TestPublicTaskCardLostACKReconciliation(t *testing.T) {
	transport := &progressREST{messages: map[string][]*discordgo.Message{}, loseACK: true}
	session, _ := discordgo.New("Bot fixture")
	session.Client = &http.Client{Transport: transport}
	session.MaxRestRetries = 0
	p := &Platform{session: session, botID: "bot"}
	task := &core.Task{ID: "task-test", Title: "检查绑定", Agent: "fish", ChannelID: "room", CreatedAt: time.Now(), UpdatedAt: time.Now(), State: core.TaskStateInProgress, LatestProgress: "@everyone 公开进展"}
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err == nil {
		t.Fatal("lost ACK not reported")
	}
	if task.MessageID != "" {
		t.Fatal("pretended to have ACK")
	}
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
		t.Fatal(err)
	}
	if transport.sends != 1 || task.MessageID != "101" || task.ThreadID != "101" {
		t.Fatalf("duplicate card or missing mapping: sends=%d %+v", transport.sends, task)
	}
	ev := core.TaskEvent{ID: "task-test:1", Summary: "关键结果", Timestamp: time.Now(), IsKeyFact: true}
	transport.loseACK = true
	if err := p.PublishTaskFact(context.Background(), task, ev, core.LangChinese); err == nil {
		t.Fatal("lost fact ACK not reported")
	}
	// New Platform/manager mimics restart with no in-memory dedup map.
	p = &Platform{session: session, botID: "bot"}
	if err := p.PublishTaskFact(context.Background(), task, ev, core.LangChinese); err != nil {
		t.Fatal(err)
	}
	if transport.sends != 2 {
		t.Fatal("duplicate fact after restart")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := p.EnsureTaskCard(ctx, task, core.LangChinese); err == nil {
		t.Fatal("ignored context")
	}
}

func TestPublicTaskPermalinkUsesActualChannel(t *testing.T) {
	for _, tc := range []struct {
		name, guild, wantGuild string
		kind                   discordgo.ChannelType
	}{
		{"guild", "999", "999", discordgo.ChannelTypeGuildText},
		{"private-thread", "999", "999", discordgo.ChannelTypeGuildPrivateThread},
		{"dm", "", "@me", discordgo.ChannelTypeDM},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := &progressREST{messages: map[string][]*discordgo.Message{}, guild: tc.guild, channelType: tc.kind}
			session, _ := discordgo.New("Bot fixture")
			session.Client = &http.Client{Transport: transport}
			session.MaxRestRetries = 0
			p := &Platform{session: session, botID: "bot"}
			// Existing message/thread with no URL exercises old journal upgrades.
			task := &core.Task{ID: "task-old", ChannelID: "111", MessageID: "222", ThreadID: "333", CreatedAt: time.Now(), UpdatedAt: time.Now()}
			if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
				t.Fatal(err)
			}
			want := "https://discord.com/channels/" + tc.wantGuild + "/111/222"
			if task.CardURL != want || transport.sends != 0 {
				t.Fatalf("wrong permalink or duplicate: %+v sends=%d", task, transport.sends)
			}
		})
	}
}

func TestPublicTaskCardCannotEstablishAbsence(t *testing.T) {
	transport := &progressREST{messages: map[string][]*discordgo.Message{}, failHistory: true}
	session, _ := discordgo.New("Bot fixture")
	session.Client = &http.Client{Transport: transport}
	session.MaxRestRetries = 0
	p := &Platform{session: session, botID: "bot"}
	task := &core.Task{ID: "task-test", Title: "test", ChannelID: "room", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := p.EnsureTaskCard(context.Background(), task, core.LangEnglish); err == nil || transport.sends != 0 {
		t.Fatal("created blindly after history failure")
	}
}

func TestPublicTaskResultDoesNotClaimAcceptance(t *testing.T) {
	for _, lang := range []core.Language{core.LangEnglish, core.LangChinese, core.LangTraditionalChinese, core.LangJapanese, core.LangSpanish} {
		task := &core.Task{ID: "t", Title: "task", Agent: "fish", State: core.TaskStateResultReady, ResultSummary: "result"}
		embed := RenderTaskCardEmbed(task, string(lang))
		if embed.Fields[1].Value != core.NewI18n(lang).T(core.MsgTaskResultReady) {
			t.Fatalf("wrong state %s", lang)
		}
		for _, f := range embed.Fields {
			if strings.HasPrefix(f.Name, "task_") {
				t.Fatal("missing translation", lang, f.Name)
			}
		}
	}
}

// Regression (#108 review 2): only a permanent refusal is reported as
// undeliverable; transient failures keep retrying.
func TestPublicTaskFactPermanentRefusalClassified(t *testing.T) {
	for _, tc := range []struct {
		status    int
		permanent bool
	}{{403, true}, {404, true}, {500, false}} {
		transport := &progressREST{messages: map[string][]*discordgo.Message{}, botID: "worker", postStatus: tc.status}
		session, _ := discordgo.New("Bot fixture-worker")
		session.Client = &http.Client{Transport: transport}
		session.MaxRestRetries = 0
		p := &Platform{session: session, botID: "worker"}
		task := &core.Task{ID: "task-refused", ThreadID: "thread", ChannelID: "room"}
		err := p.PublishTaskFact(context.Background(), task, core.TaskEvent{ID: "task-refused:2", Summary: "x", Timestamp: time.Now(), IsKeyFact: true}, core.LangEnglish)
		if err == nil || errors.Is(err, core.ErrTaskFactUndeliverable) != tc.permanent {
			t.Fatalf("status %d: err=%v permanent=%v", tc.status, err, tc.permanent)
		}
	}
}
