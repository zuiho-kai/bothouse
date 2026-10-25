package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestVoiceSentenceSplitter_IncrementalCompleteOnly(t *testing.T) {
	var s voiceSentenceSplitter
	steps := []struct {
		delta string
		want  []string
	}{
		{"你好，", nil},
		{"世界。", []string{"你好，世界。"}},
		{"今天", nil},
		{"下雨吗？！", []string{"今天下雨吗？！"}},
		{"”他说", nil},
		{"\n\n", []string{"”他说\n\n"}},
		{"Done!", []string{"Done!"}},
		{" ok", nil},
	}
	for i, step := range steps {
		if got := s.feed(step.delta); !reflect.DeepEqual(got, step.want) {
			t.Fatalf("step %d: got %q want %q", i, got, step.want)
		}
	}
	if s.rest() != " ok" {
		t.Fatalf("rest %q", s.rest())
	}
	// A tool call ends the assistant message: the tail is complete.
	if got := s.boundary(); !reflect.DeepEqual(got, []string{" ok"}) || s.rest() != "" {
		t.Fatalf("boundary %q rest %q", got, s.rest())
	}
}

func TestVoiceSentenceSplitter_SplitRuneWaits(t *testing.T) {
	var s voiceSentenceSplitter
	full := "你好。后"
	cut := strings.Index(full, "。") + 1 // inside the 3-byte "。"
	if got := s.feed(full[:cut]); got != nil {
		t.Fatalf("partial rune published %q", got)
	}
	if got := s.feed(full[cut:]); !reflect.DeepEqual(got, []string{"你好。"}) {
		t.Fatalf("got %q", got)
	}
}

func TestVoiceSentenceSplitter_RelayTagAndMarkupFreeze(t *testing.T) {
	for _, tail := range []string{"请帮我<待转达 to=\"x\">内容</待转达>。", "好<转达>x</转达>。", "看`code`。", "<think>私密。", "见[[链接]]。"} {
		var s voiceSentenceSplitter
		got := s.feed("第一句。" + tail + "第三句。后")
		if !reflect.DeepEqual(got, []string{"第一句。"}) || !s.frozen {
			t.Fatalf("%q: got %q frozen=%v", tail, got, s.frozen)
		}
		if got := s.feed("更多。还有"); got != nil || s.boundary() != nil {
			t.Fatalf("%q: frozen splitter resumed", tail)
		}
		if !strings.HasPrefix(s.rest(), tail) {
			t.Fatalf("%q: rest lost tagged text: %q", tail, s.rest())
		}
	}
}

func TestVoiceSentenceSplitter_Bounds(t *testing.T) {
	var s voiceSentenceSplitter
	got := s.feed(strings.Repeat("句。", voiceStreamMaxSentences+5) + "x")
	if len(got) != voiceStreamMaxSentences || !s.frozen {
		t.Fatalf("published %d frozen=%v", len(got), s.frozen)
	}
}

func voiceStreamReq(id string) RelayRequest {
	req := voiceReq(id)
	req.Stream = true
	return req
}

func voiceWaitSentences(t *testing.T, rm *RelayManager, id string, n int) voiceRelayResult {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		rm.voice.mu.Lock()
		r := rm.voice.Entries[id].Result
		r.Sentences = append([]string(nil), r.Sentences...)
		rm.voice.mu.Unlock()
		if len(r.Sentences) >= n {
			return r
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("relay did not publish %d sentences", n)
	return voiceRelayResult{}
}

func TestVoiceRelayStream_IncrementalPublicSentencesThenRest(t *testing.T) {
	rm, api, a, _ := voiceFixture(t, t.TempDir())
	if _, code, err := rm.submitVoice(voiceStreamReq("s1")); err != nil || code != 202 {
		t.Fatalf("%d %v", code, err)
	}
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventThinking, Content: "PRIVATE_FIXTURE。"}
	s.events <- Event{Type: EventText, Content: "我先查一下"}
	s.events <- Event{Type: EventToolUse, Content: "TOOL_FIXTURE。"}
	s.events <- Event{Type: EventToolResult, Content: "TOOL_OUTPUT。"}
	s.events <- Event{Type: EventText, Content: "结果是晴天。明"}
	r := voiceWaitSentences(t, rm, "s1", 2)
	if r.Status != "running" || !reflect.DeepEqual(r.Sentences, []string{"我先查一下", "结果是晴天。"}) || r.Text != "" || r.Rest != "" {
		t.Fatalf("running receipt %+v", r)
	}
	w := voiceHTTP(api, "GET", "/relay/voice/s1")
	if w.Code != 200 || strings.Contains(w.Body.String(), "FIXTURE") || strings.Contains(w.Body.String(), "OUTPUT") {
		t.Fatalf("receipt leaked private text: %s", w.Body.String())
	}
	s.events <- Event{Type: EventText, Content: "天也晴"}
	s.events <- Event{Type: EventResult, Done: true}
	r = voiceWait(t, rm, "s1")
	if r.Status != "completed" || r.Text != "我先查一下结果是晴天。明天也晴" || r.Rest != "明天也晴" ||
		!reflect.DeepEqual(r.Sentences, []string{"我先查一下", "结果是晴天。"}) {
		t.Fatalf("final %+v", r)
	}
	// Persisted receipt keeps the same, already-final sentence list.
	restored := NewRelayManager(filepath.Dir(rm.voice.path))
	if got := restored.voice.Entries["s1"].Result; !reflect.DeepEqual(got, r) {
		t.Fatalf("restored %+v", got)
	}
}

func TestVoiceRelayStream_TagLeftForFinal(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, "")
	rm.submitVoice(voiceStreamReq("tag"))
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventText, Content: "好的。我会<待转达 to=\"deep\">明早开会</待转达>。再见。"}
	s.events <- Event{Type: EventResult, Done: true}
	r := voiceWait(t, rm, "tag")
	if !reflect.DeepEqual(r.Sentences, []string{"好的。"}) || !strings.HasPrefix(r.Rest, "我会<待转达") {
		t.Fatalf("%+v", r)
	}
}

func TestVoiceRelayStream_FailureAndCancelClearSentences(t *testing.T) {
	for _, kind := range []string{"error", "cancel", "truncated"} {
		t.Run(kind, func(t *testing.T) {
			rm, api, a, _ := voiceFixture(t, "")
			rm.SetTimeout(time.Second)
			rm.submitVoice(voiceStreamReq("f"))
			s := <-a.sessions
			<-s.prompts
			s.events <- Event{Type: EventText, Content: "第一句。第"}
			voiceWaitSentences(t, rm, "f", 1)
			switch kind {
			case "error":
				s.events <- Event{Type: EventError, Error: errors.New("bad")}
			case "truncated": // backends report non end_turn as EventError
				s.events <- Event{Type: EventError, Content: "voice reply did not finish normally"}
			case "cancel":
				if w := voiceHTTP(api, "POST", "/relay/voice/f/cancel"); w.Code != 200 || strings.Contains(w.Body.String(), "sentences") {
					t.Fatalf("cancel %d %s", w.Code, w.Body.String())
				}
				// Late text after cancel can never revive the receipt.
				select {
				case s.events <- Event{Type: EventText, Content: "二句。第三句。"}:
				default:
				}
			}
			r := voiceWait(t, rm, "f")
			time.Sleep(10 * time.Millisecond)
			rm.voice.mu.Lock()
			r = rm.voice.Entries["f"].Result
			rm.voice.mu.Unlock()
			if r.Status != "failed" || r.Text != "" || r.Sentences != nil || r.Rest != "" {
				t.Fatalf("%+v", r)
			}
		})
	}
}

func TestVoiceRelayStream_OffIsUnchanged(t *testing.T) {
	data, _ := json.Marshal(voiceReq("x"))
	if strings.Contains(string(data), "stream") {
		t.Fatalf("request digest input changed: %s", data)
	}
	rm, api, a, _ := voiceFixture(t, "")
	rm.submitVoice(voiceReq("off"))
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventText, Content: "第一句。第二句。"}
	s.events <- Event{Type: EventToolUse, Content: "tool"}
	s.events <- Event{Type: EventText, Content: "尾巴"}
	s.events <- Event{Type: EventResult, Done: true}
	r := voiceWait(t, rm, "off")
	if r.Sentences != nil || r.Rest != "" || r.Text != "第一句。第二句。尾巴" {
		t.Fatalf("%+v", r)
	}
	body := voiceHTTP(api, "GET", "/relay/voice/off").Body.String()
	var keys map[string]any
	_ = json.Unmarshal([]byte(body), &keys)
	if _, ok := keys["sentences"]; ok || len(keys) != 6 {
		t.Fatalf("receipt shape changed: %s", body)
	}
}

// Local isolated replay (no model, no network): a fake backend streams a
// realistic answer in small deltas. Writes the receipt timeline for the
// companion replay. Run with VOICE_STREAM_REPLAY_OUT=<file>.
func TestVoiceRelayStreamReplay(t *testing.T) {
	out := os.Getenv("VOICE_STREAM_REPLAY_OUT")
	if out == "" {
		t.Skip("set VOICE_STREAM_REPLAY_OUT to record the replay timeline")
	}
	answer := "我看了一下，今天下午三点的会议已经改到明天上午十点了。" +
		"会议室还是原来的那间，参会人没有变化，资料我已经放在共享文件夹里。" +
		"你之前提的预算问题，财务那边说周四之前会给答复，到时候我再提醒你。" +
		"另外，晚上可能会下雨，出门记得带伞，路上注意安全"
	rm, _, a, _ := voiceFixture(t, "")
	rm.SetTimeout(time.Minute)
	start := time.Now()
	rm.submitVoice(voiceStreamReq("replay"))
	s := <-a.sessions
	<-s.prompts
	go func() {
		time.Sleep(2 * time.Second) // reasoning before the first public token
		runes := []rune(answer)
		for i := 0; i < len(runes); i += 3 {
			end := min(i+3, len(runes))
			s.events <- Event{Type: EventText, Content: string(runes[i:end])}
			time.Sleep(150 * time.Millisecond) // ~20 chars/s
		}
		s.events <- Event{Type: EventResult, Done: true}
	}()
	type point struct {
		Ms      int64            `json:"ms"`
		Receipt voiceRelayResult `json:"receipt"`
	}
	var timeline []point
	last := ""
	for {
		rm.voice.mu.Lock()
		r := rm.voice.Entries["replay"].Result
		r.Sentences = append([]string(nil), r.Sentences...)
		rm.voice.mu.Unlock()
		data, _ := json.Marshal(r)
		if string(data) != last {
			last = string(data)
			timeline = append(timeline, point{time.Since(start).Milliseconds(), r})
		}
		if r.Status != "running" {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	data, _ := json.MarshalIndent(timeline, "", " ")
	if err := os.WriteFile(out, data, 0600); err != nil {
		t.Fatal(err)
	}
	first := int64(-1)
	for _, p := range timeline {
		if len(p.Receipt.Sentences) > 0 {
			first = p.Ms
			break
		}
	}
	t.Logf("first sentence at %dms, completed at %dms, %d sentences", first, timeline[len(timeline)-1].Ms, len(timeline[len(timeline)-1].Receipt.Sentences))
}
