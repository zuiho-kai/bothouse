package qq

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func recordSegment(file, url string) map[string]any {
	return map[string]any{"type": "record", "data": map[string]any{"file": file, "url": url}}
}

// QQ voice is silk, which ffmpeg cannot read, so the platform must hand core
// the mp3 NapCat transcodes via get_record (#646).
func TestRecord_UsesNapCatMP3(t *testing.T) {
	mp3 := []byte("ID3fake-mp3")
	f := newFakeOneBot(t)
	f.on("get_record", func(map[string]any) map[string]any {
		return map[string]any{"base64": base64.StdEncoding.EncodeToString(mp3)}
	})
	_, msgs := startTestPlatform(t, f)

	f.push(privateMessage(2001, 11, recordSegment("abc.amr", "")))

	m := awaitMessage(t, msgs)
	if m.Audio == nil {
		t.Fatal("Audio = nil, want the transcoded voice message")
	}
	if m.Audio.Format != "mp3" || string(m.Audio.Data) != string(mp3) {
		t.Errorf("Audio = %q/%q, want mp3 bytes from get_record", m.Audio.Format, m.Audio.Data)
	}
	params := f.paramsOf("get_record", 0)
	if params["file"] != "abc.amr" || params["out_format"] != "mp3" {
		t.Errorf("get_record params = %v, want file=abc.amr out_format=mp3", params)
	}
}

// Without a transcoded copy the segment URL is still downloaded.
func TestRecord_FallsBackToURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("#!SILK_V3raw"))
	}))
	defer srv.Close()

	f := newFakeOneBot(t)
	_, msgs := startTestPlatform(t, f) // get_record answers with no base64

	f.push(privateMessage(2001, 12, recordSegment("abc.silk", srv.URL)))

	m := awaitMessage(t, msgs)
	if m.Audio == nil || m.Audio.Format != "silk" || !strings.HasPrefix(string(m.Audio.Data), "#!SILK") {
		t.Fatalf("Audio = %+v, want the raw silk from the segment url", m.Audio)
	}
}

func TestSendAudio_PrivateRecordSegment(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("send_private_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 777}
	})
	p, _ := startTestPlatform(t, f)

	audio := []byte("mp3-bytes")
	if err := p.SendAudio(context.Background(), &replyContext{messageType: "private", userID: 2001}, audio, "mp3"); err != nil {
		t.Fatalf("SendAudio: %v", err)
	}
	params := f.paramsOf("send_private_msg", 0)
	if params["user_id"] != float64(2001) {
		t.Errorf("user_id = %v, want 2001", params["user_id"])
	}
	segs, _ := params["message"].([]any)
	if len(segs) != 1 {
		t.Fatalf("message = %v, want one record segment", params["message"])
	}
	seg := segs[0].(map[string]any)
	file, _ := seg["data"].(map[string]any)["file"].(string)
	if seg["type"] != "record" || file != "base64://"+base64.StdEncoding.EncodeToString(audio) {
		t.Errorf("segment = %v, want record with base64 audio", seg)
	}
}

func TestSendAudio_GroupNeedsMessageID(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f) // send_group_msg answers without message_id

	err := p.SendAudio(context.Background(), &replyContext{messageType: "group", groupID: 111}, []byte("x"), "mp3")
	if err == nil {
		t.Fatal("SendAudio succeeded without a message_id; a dropped voice must surface as an error")
	}
	if f.paramsOf("send_group_msg", 0)["group_id"] != float64(111) {
		t.Error("group voice not sent to group 111")
	}
}
