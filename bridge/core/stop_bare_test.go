package core

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newStopFixture() *stopAllFixture {
	return &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
}

func newStopBot(t *testing.T, name, dataDir string) (*Engine, *stubPlatformEngine) {
	t.Helper()
	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine(name, &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetDataDir(dataDir)
	return e, p
}

func bareStop(sessionKey, content string) *Message {
	return &Message{SessionKey: sessionKey, Platform: "discord", MessageID: "m1",
		UserID: "u1", UserName: "user", Content: content, ReplyCtx: "ctx", StopAll: true}
}

// A stop word that calls no bot stops every bot's work in the channel, other
// channels keep going, and the channel gets exactly one confirmation.
func TestBareStopStopsEveryBotOnce(t *testing.T) {
	dir := t.TempDir()
	f := newStopFixture()
	a, pa := newStopBot(t, "bot-a", dir)
	b, pb := newStopBot(t, "bot-b", dir)
	addBusyState(a, f, "discord:room1:u1")
	addBusyState(a, f, "/ws/proj:discord:room1:u2")
	addBusyState(a, f, "discord:room2:u1")
	addBusyState(b, f, "discord:room1:u1")
	addBusyState(b, f, "discord:room2:u1")

	a.handleMessage(pa, bareStop("discord:room1:u1", "停"))
	b.handleMessage(pb, bareStop("discord:room1:u1", "停"))

	for _, id := range []string{"bot-a|discord:room1:u1", "bot-a|/ws/proj:discord:room1:u2", "bot-b|discord:room1:u1"} {
		if !f.stopped(t, id) {
			t.Errorf("%s not stopped", id)
		}
	}
	for _, id := range []string{"bot-a|discord:room2:u1", "bot-b|discord:room2:u1"} {
		if f.stopped(t, id) {
			t.Errorf("%s in another channel was stopped", id)
		}
	}
	if n := len(pa.getSent()) + len(pb.getSent()); n != 1 {
		t.Errorf("confirmations = %d (a=%#v b=%#v), want exactly 1", n, pa.getSent(), pb.getSent())
	}
}

// "/stop all" also confirms once across bots sharing the data dir.
func TestStopAllConfirmsOnceAcrossBots(t *testing.T) {
	dir := t.TempDir()
	f := newStopFixture()
	a, pa := newStopBot(t, "bot-a", dir)
	b, pb := newStopBot(t, "bot-b", dir)
	addBusyState(a, f, "discord:room1:u1")
	addBusyState(b, f, "discord:room1:u1")
	a.handleMessage(pa, bareStop("discord:room1:u1", "/stop all"))
	b.handleMessage(pb, bareStop("discord:room1:u1", "/stop all"))
	if !f.stopped(t, "bot-a|discord:room1:u1") || !f.stopped(t, "bot-b|discord:room1:u1") {
		t.Fatal("/stop all did not stop both bots")
	}
	if n := len(pa.getSent()) + len(pb.getSent()); n != 1 {
		t.Errorf("confirmations = %d, want 1", n)
	}
}

// A Discord thread has its own channel id (thread_isolation key
// "discord:<thread>"). A bare stop in a thread stops only that thread; a bare
// stop in the parent channel leaves its threads running.
func TestBareStopThreadAndParentAreSeparate(t *testing.T) {
	setup := func() (*stopAllFixture, *Engine, *stubPlatformEngine) {
		f := newStopFixture()
		e, p := newStopBot(t, "bot-a", t.TempDir())
		addBusyState(e, f, "discord:parent:u1")
		addBusyState(e, f, "/ws/proj:discord:parent:u2")
		addBusyState(e, f, "discord:thread1")
		addBusyState(e, f, "/ws/proj:discord:thread2")
		return f, e, p
	}

	t.Run("stop in thread", func(t *testing.T) {
		f, e, p := setup()
		msg := bareStop("discord:thread1", "停")
		msg.ChannelID, msg.ChannelKey = "thread1", "parent"
		e.handleMessage(p, msg)
		if !f.stopped(t, "bot-a|discord:thread1") {
			t.Error("thread session not stopped")
		}
		for _, id := range []string{"bot-a|discord:parent:u1", "bot-a|/ws/proj:discord:parent:u2", "bot-a|/ws/proj:discord:thread2"} {
			if f.stopped(t, id) {
				t.Errorf("%s stopped by a stop in another thread", id)
			}
		}
	})
	t.Run("stop in parent", func(t *testing.T) {
		f, e, p := setup()
		e.handleMessage(p, bareStop("discord:parent:u1", "停"))
		for _, id := range []string{"bot-a|discord:parent:u1", "bot-a|/ws/proj:discord:parent:u2"} {
			if !f.stopped(t, id) {
				t.Errorf("%s not stopped", id)
			}
		}
		for _, id := range []string{"bot-a|discord:thread1", "bot-a|/ws/proj:discord:thread2"} {
			if f.stopped(t, id) {
				t.Errorf("%s (thread) stopped by a stop in the parent channel", id)
			}
		}
	})
}

// A stop that names or @-s one bot never stops everyone: neither the bot it
// does not call, nor the other sessions of the bot it calls.
func TestAddressedStopDoesNotStopAll(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
	}{
		{"name call", "肥鱼，停"},
		{"at mention", "<@200> 停"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newStopFixture()
			other, po := newStopBot(t, "bot-other", t.TempDir())
			addBusyState(other, f, "discord:room1:u1")
			// The adapter marks a teammate named or @-ed at the start as AddressedOther.
			msg := bareStop("discord:room1:u1", tc.content)
			msg.AddressedOther = true
			other.handleMessage(po, msg)
			if f.stopped(t, "bot-other|discord:room1:u1") {
				t.Error("a bot that was not called was stopped")
			}
			// Even without AddressedOther the text is not a bare stop word.
			msg = bareStop("discord:room1:u1", tc.content)
			if other.isUnaddressedStop(msg) {
				t.Error("text with a name or mention counted as a bare stop")
			}
			// The called bot gets Mentioned and keeps the single-session path.
			msg = bareStop("discord:room1:u1", tc.content)
			msg.Mentioned = true
			if other.isUnaddressedStop(msg) {
				t.Error("a stop that calls this bot counted as channel-wide")
			}
		})
	}
	// Even "停" alone with Mentioned (e.g. a reply to the bot) is single-bot.
	e, _ := newStopBot(t, "bot-a", "")
	msg := bareStop("discord:room1:u1", "停")
	msg.Mentioned = true
	if e.isUnaddressedStop(msg) {
		t.Error("mentioned 停 counted as channel-wide")
	}
}

// Messages that look like a stop but are not an unaddressed one stop nothing.
func TestBareStopIgnored(t *testing.T) {
	for _, tc := range []struct {
		name string
		msg  func(*Message)
	}{
		{"from bot", func(m *Message) { m.FromBot = true }},
		{"with image", func(m *Message) { m.Images = []ImageAttachment{{MimeType: "image/png", Data: []byte{1}}} }},
		{"long sentence", func(m *Message) { m.Content = "停止一下吧我再看看" }},
		{"reply prefix", func(m *Message) { m.Content = "[replying to X: hi]\n停" }},
		{"direct", func(m *Message) { m.Direct = true }},
		{"stop then more words", func(m *Message) { m.Content = "停一下我看看" }},
		{"with file", func(m *Message) { m.Files = []FileAttachment{{FileName: "a.txt", Data: []byte{1}}} }},
		{"with voice", func(m *Message) { m.Audio = &AudioAttachment{Format: "ogg", Data: []byte{1}} }},
		{"platform did not mark it", func(m *Message) { m.StopAll = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newStopFixture()
			e, _ := newStopBot(t, "bot-a", t.TempDir())
			addBusyState(e, f, "discord:room1:u2")
			msg := bareStop("discord:room1:u1", "停")
			tc.msg(msg)
			if e.isUnaddressedStop(msg) {
				t.Fatal("counted as an unaddressed stop")
			}
		})
	}
}

// An idle bot stays quiet and does not take the confirmation.
func TestBareStopIdleBotSilentNoClaim(t *testing.T) {
	dir := t.TempDir()
	e, p := newStopBot(t, "bot-a", dir)
	e.handleMessage(p, bareStop("discord:room1:u1", "停"))
	if got := p.getSent(); len(got) != 0 {
		t.Errorf("idle bot replied %#v", got)
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "stop-ack")); len(entries) != 0 {
		t.Errorf("idle bot created claim files: %v", entries)
	}
}

func TestClaimStopAck(t *testing.T) {
	msg := bareStop("discord:room1:u1", "停")

	e, _ := newStopBot(t, "bot-a", "")
	if !e.claimStopAck(msg) || !e.claimStopAck(msg) {
		t.Error("no data dir: every bot should confirm")
	}

	dir := t.TempDir()
	e, _ = newStopBot(t, "bot-a", dir)
	if !e.claimStopAck(msg) {
		t.Fatal("first claim failed")
	}
	if e.claimStopAck(msg) {
		t.Error("second claim for the same message succeeded")
	}
	other := *msg
	other.MessageID = "m2"
	if !e.claimStopAck(&other) {
		t.Error("a new message could not be claimed")
	}

	// Claims older than stopAckMaxAge are pruned on the next claim.
	old := filepath.Join(dir, "stop-ack", "discord_room9_old")
	if err := os.WriteFile(old, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-2 * stopAckMaxAge)
	_ = os.Chtimes(old, past, past)
	other.MessageID = "m3"
	e.claimStopAck(&other)
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("old claim not pruned: %v", err)
	}

	// Unwritable: a file where the ack directory should be. Confirm anyway.
	bad := t.TempDir()
	if err := os.WriteFile(filepath.Join(bad, "stop-ack"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	e, _ = newStopBot(t, "bot-a", bad)
	if !e.claimStopAck(msg) {
		t.Error("claim error should fall back to confirming")
	}
}

type startRecordingAgent struct {
	stubAgent
	started chan string
}

func (a *startRecordingAgent) StartSession(ctx context.Context, id string) (AgentSession, error) {
	select {
	case a.started <- id:
	default:
	}
	return a.stubAgent.StartSession(ctx, id)
}

// Platforms other than discord never set StopAll, and weixin/qq/line do not
// fill Direct: a "停" in a weixin private chat reaches the agent as usual.
func TestBareStopWeixinPrivateChatReachesAgent(t *testing.T) {
	p := &stubPlatformEngine{n: "weixin"}
	a := &startRecordingAgent{started: make(chan string, 1)}
	e := NewEngine("bot-a", a, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	// Register after t.TempDir: cleanup runs LIFO, so Stop (which joins the
	// turn worker and its journal write) completes before the dir is removed.
	t.Cleanup(func() { _ = e.Stop() })
	msg := &Message{SessionKey: "weixin:u1:u1", Platform: "weixin", MessageID: "m1",
		UserID: "u1", UserName: "user", Content: "停", ReplyCtx: "ctx"}
	if e.isUnaddressedStop(msg) {
		t.Fatal("weixin private 停 counted as an unaddressed stop")
	}
	e.handleMessage(p, msg)
	select {
	case <-a.started:
	case <-time.After(3 * time.Second):
		t.Fatalf("weixin private 停 did not reach the agent; sent %#v", p.getSent())
	}
}
