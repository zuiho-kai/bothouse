package discord

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"mime/multipart"
	"net/textproto"
	"os/exec"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// discordVoiceMessageFlag marks a message as a native voice message
// (IS_VOICE_MESSAGE, SPEC: Discord message flags 1<<13). Discord requires
// exactly one ogg/opus attachment carrying duration_secs and a base64 waveform.
const discordVoiceMessageFlag = 1 << 13

// 沿用已有做法：~/.bothouse/roles/jingyu/bin/say 发 Discord 语音消息用 64 段波形。
const voiceWaveformBins = 64

var _ core.AudioSender = (*Platform)(nil)

// SendAudio sends audio as a Discord voice message bubble. When the voice
// message cannot be built or is rejected, it falls back to a plain file.
func (p *Platform) SendAudio(ctx context.Context, rctx any, audio []byte, format string) error {
	var channelID string
	switch rc := rctx.(type) {
	case *interactionReplyCtx:
		channelID = rc.channelID
	case replyContext:
		channelID = rc.targetChannelID()
	default:
		return fmt.Errorf("discord: SendAudio: invalid reply context type %T", rctx)
	}
	sent, err := p.sendVoiceMessage(ctx, channelID, audio, format)
	if err != nil {
		slog.Warn("discord: voice message failed, sending as file", "error", err)
		if format == "" {
			format = "mp3"
		}
		return p.SendFile(ctx, rctx, core.FileAttachment{FileName: "voice." + format, MimeType: "audio/" + format, Data: audio})
	}
	switch rc := rctx.(type) {
	case replyContext:
		p.noteTurnSent(rc, sent)
	case *interactionReplyCtx:
		p.noteInteractionSent(rc, sent)
	}
	return nil
}

func (p *Platform) sendVoiceMessage(ctx context.Context, channelID string, audio []byte, format string) (*discordgo.Message, error) {
	if channelID == "" {
		return nil, fmt.Errorf("empty channel id")
	}
	dur, waveform, err := voiceWaveform(ctx, audio, format)
	if err != nil {
		return nil, err
	}
	ogg, err := encodeVoiceOgg(ctx, audio, format)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"flags": discordVoiceMessageFlag,
		"attachments": []map[string]any{{
			"id":            0,
			"filename":      "voice-message.ogg",
			"duration_secs": dur,
			"waveform":      waveform,
		}},
	}
	pj, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	ph := textproto.MIMEHeader{}
	ph.Set("Content-Disposition", `form-data; name="payload_json"`)
	ph.Set("Content-Type", "application/json")
	pw, _ := mw.CreatePart(ph)
	_, _ = pw.Write(pj)
	fh := textproto.MIMEHeader{}
	fh.Set("Content-Disposition", `form-data; name="files[0]"; filename="voice-message.ogg"`)
	fh.Set("Content-Type", "audio/ogg")
	fw, _ := mw.CreatePart(fh)
	_, _ = fw.Write(ogg)
	if err := mw.Close(); err != nil {
		return nil, err
	}
	endpoint := discordgo.EndpointChannelMessages(channelID)
	resp, err := p.session.RequestRaw("POST", endpoint, mw.FormDataContentType(), body.Bytes(), endpoint, 0, discordgo.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	var msg discordgo.Message
	if err := json.Unmarshal(resp, &msg); err != nil {
		return nil, fmt.Errorf("decode voice message response: %w", err)
	}
	return &msg, nil
}

func ffmpegPipe(ctx context.Context, audio []byte, format string, out ...string) ([]byte, error) {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found in PATH")
	}
	args := []string{"-loglevel", "error"}
	if format == "amr" || format == "silk" {
		args = append(args, "-f", format)
	}
	args = append(args, "-i", "pipe:0")
	args = append(args, out...)
	args = append(args, "-y", "pipe:1")
	cmd := exec.CommandContext(ctx, ff, args...)
	cmd.Stdin = bytes.NewReader(audio)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg: %w (%s)", err, stderr.String())
	}
	return stdout.Bytes(), nil
}

// 编码参数沿用 ~/.bothouse/roles/jingyu/bin/say（单声道 48k opus 64k，已在 Discord 实发成语音气泡）。
func encodeVoiceOgg(ctx context.Context, audio []byte, format string) ([]byte, error) {
	return ffmpegPipe(ctx, audio, format, "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "64k", "-f", "ogg")
}

// voiceWaveform decodes audio to mono PCM and returns its duration (seconds)
// and a base64 waveform of voiceWaveformBins peak bytes (0–255).
func voiceWaveform(ctx context.Context, audio []byte, format string) (float64, string, error) {
	// 沿用 core.ConvertAudioToMP3 的 16k 单声道。
	const rate = 16000
	pcm, err := ffmpegPipe(ctx, audio, format, "-ac", "1", "-ar", "16000", "-f", "s16le")
	if err != nil {
		return 0, "", err
	}
	n := len(pcm) / 2
	if n == 0 {
		return 0, "", fmt.Errorf("decoded audio is empty")
	}
	samples := make([]float64, n)
	for i := 0; i < n; i++ {
		samples[i] = math.Abs(float64(int16(binary.LittleEndian.Uint16(pcm[2*i:]))))
	}
	return float64(n) / rate, base64.StdEncoding.EncodeToString(waveformPeaks(samples, voiceWaveformBins)), nil
}

func waveformPeaks(samples []float64, bins int) []byte {
	peaks := make([]float64, bins)
	top := 0.0
	for b := 0; b < bins; b++ {
		lo, hi := b*len(samples)/bins, (b+1)*len(samples)/bins
		for _, s := range samples[lo:hi] {
			if s > peaks[b] {
				peaks[b] = s
			}
		}
		if peaks[b] > top {
			top = peaks[b]
		}
	}
	out := make([]byte, bins)
	if top == 0 {
		return out
	}
	for i, v := range peaks {
		out[i] = byte(v * 255 / top)
	}
	return out
}
