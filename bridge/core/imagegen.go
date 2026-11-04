package core

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Image generation (生图) for #150 item c: a small opt-in client for an
// OpenAI-compatible /images/generations endpoint.
//
// Deliberately narrow, because image generation costs the owner money:
//   - it does nothing unless [image_gen] enabled = true and an api_key is set;
//   - one picture at a time per process (a second request gets ErrImageGenBusy
//     instead of quietly buying another image);
//   - it only writes a file and reports where it is. Sending the picture is the
//     caller's separate, explicit step (bothouse send --image), so nothing goes
//     out to a channel behind the owner's back.
//
// The endpoint shape is the one every OpenAI-compatible relay speaks, and the
// one this machine's own image service already uses: POST {base}/images/generations
// with {"model","prompt","n"}, answering {"data":[{"b64_json"|"url"}]}.
const (
	// imageGenMaxBytes caps one downloaded picture. 来源：本机 media/gen 里 7 张实测
	// 1.2–2.4 MB（2026-10-31…11-03），留足余量取 20 MiB。
	imageGenMaxBytes int64 = 20 << 20
	// imageGenTimeout is the whole-request budget. 来源：沿用 pixel-avatar edit_image
	// 的 240s 超时（实测一张 1024x1024 需 20–60s，低质量档更短）。
	imageGenTimeout = 240 * time.Second
	// imageGenRecentDefault is how many finished pictures GET /image-gen lists.
	// 来源：页面一屏能放下的数量，沿用 library 列表的习惯值。
	imageGenRecentDefault = 20
)

var (
	// ErrImageGenDisabled: [image_gen] is off, or no api_key is configured.
	ErrImageGenDisabled = errors.New("image generation is not configured")
	// ErrImageGenBusy: the previous picture is still being drawn.
	ErrImageGenBusy = errors.New("another picture is still being generated")
)

// ImageGenConfig is the runtime form of [image_gen]: what main.go hands to
// NewImageGenerator after applying defaults.
type ImageGenConfig struct {
	Enabled  bool
	Provider string // "openai" (default) — the only endpoint shape supported
	APIKey   string
	BaseURL  string // default https://api.openai.com/v1
	Model    string // default gpt-image-1
	Size     string // optional, e.g. "1024x1024"; empty = provider default
	Quality  string // optional, e.g. "low"; empty = provider default
	OutDir   string // where pictures are written; default <data_dir>/images
}

// ImageGenResult describes one written picture: where it is on disk, the URL the
// panel loads it from, and how long the provider took.
type ImageGenResult struct {
	Name    string  `json:"name"`
	File    string  `json:"file"`
	URL     string  `json:"url"`
	Bytes   int     `json:"bytes"`
	Mime    string  `json:"mime"`
	Width   int     `json:"width,omitempty"`  // filled only when the provider says so
	Height  int     `json:"height,omitempty"` // filled only when the provider says so
	Seconds float64 `json:"seconds"`
	Model   string  `json:"model"`
}

// ImageGenerator turns one prompt into one picture file. The zero value is not
// usable; build it with NewImageGenerator.
type ImageGenerator struct {
	cfg    ImageGenConfig
	client *http.Client
	busy   sync.Mutex // held for the length of one provider call (single flight)
}

// NewImageGenerator applies the same defaults the docs promise, so an empty
// base_url/model still talks to a standard endpoint.
func NewImageGenerator(cfg ImageGenConfig) *ImageGenerator {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if strings.TrimSpace(cfg.Model) == "" {
		cfg.Model = "gpt-image-1"
	}
	if strings.TrimSpace(cfg.Provider) == "" {
		cfg.Provider = "openai"
	}
	cfg.OutDir = strings.TrimSpace(cfg.OutDir)
	return &ImageGenerator{cfg: cfg, client: &http.Client{Timeout: imageGenTimeout}}
}

// Config returns a copy of the effective configuration (no secrets are hidden
// here: the panel's status handler decides what to show).
func (g *ImageGenerator) Config() ImageGenConfig { return g.cfg }

// OutDir is where this generator writes and lists pictures from.
func (g *ImageGenerator) OutDir() string { return g.cfg.OutDir }

// Ready reports whether a generate request can succeed.
func (g *ImageGenerator) Ready() error {
	if !g.cfg.Enabled {
		return ErrImageGenDisabled
	}
	if g.cfg.Provider != "openai" {
		return fmt.Errorf("unsupported image_gen provider %q (only \"openai\")", g.cfg.Provider)
	}
	if strings.TrimSpace(g.cfg.APIKey) == "" {
		return fmt.Errorf("%w: [image_gen.openai] api_key is empty", ErrImageGenDisabled)
	}
	return nil
}

// Generate draws one picture and writes it under OutDir. It never sends the
// picture anywhere; the caller decides what to do with File.
func (g *ImageGenerator) Generate(ctx context.Context, prompt string) (*ImageGenResult, error) {
	if err := g.Ready(); err != nil {
		return nil, err
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, errors.New("prompt is empty")
	}
	if !g.busy.TryLock() {
		return nil, ErrImageGenBusy
	}
	defer g.busy.Unlock()

	started := time.Now()
	data, mime, err := g.fetch(ctx, prompt)
	if err != nil {
		return nil, err
	}
	took := time.Since(started).Seconds()

	if err := os.MkdirAll(g.cfg.OutDir, 0o755); err != nil {
		return nil, fmt.Errorf("image_gen: create out dir: %w", err)
	}
	name := fmt.Sprintf("gen-%s%s", time.Now().Format("20060102-150405"), imageExt(mime))
	file := filepath.Join(g.cfg.OutDir, name)
	// 0o644: the picture is served to the panel's <img>; no secrets live in it.
	if err := os.WriteFile(file, data, 0o644); err != nil {
		return nil, fmt.Errorf("image_gen: write picture: %w", err)
	}
	slog.Info("image_gen: wrote picture", "file", file, "bytes", len(data), "seconds", took)
	return &ImageGenResult{
		Name:    name,
		File:    file,
		URL:     "/api/v1/image-gen/file/" + name,
		Bytes:   len(data),
		Mime:    mime,
		Seconds: took,
		Model:   g.cfg.Model,
	}, nil
}

// fetch calls the provider and returns the picture bytes plus their mime type.
func (g *ImageGenerator) fetch(ctx context.Context, prompt string) ([]byte, string, error) {
	body := map[string]any{"model": g.cfg.Model, "prompt": prompt, "n": 1}
	if g.cfg.Size != "" {
		body["size"] = g.cfg.Size
	}
	if g.cfg.Quality != "" {
		body["quality"] = g.cfg.Quality
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, "", fmt.Errorf("image_gen: encode request: %w", err)
	}
	url := g.cfg.BaseURL + "/images/generations"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, "", fmt.Errorf("image_gen: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+g.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	// Cloudflare-fronted relays reject Go's default user agent; the same string
	// this machine's image service sends (pixel-avatar ai.py).
	req.Header.Set("User-Agent", "bothouse-image/0.1 (+curl-compatible)")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("image_gen: request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, imageGenMaxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("image_gen: read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("image_gen: provider returned %d: %s", resp.StatusCode, truncateForError(raw))
	}

	var parsed struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, "", fmt.Errorf("image_gen: parse response: %w", err)
	}
	if len(parsed.Data) == 0 {
		return nil, "", errors.New("image_gen: provider returned no picture")
	}
	item := parsed.Data[0]
	var data []byte
	switch {
	case item.B64JSON != "":
		data, err = base64.StdEncoding.DecodeString(item.B64JSON)
		if err != nil {
			return nil, "", fmt.Errorf("image_gen: decode b64_json: %w", err)
		}
	case item.URL != "":
		data, err = g.download(ctx, item.URL)
		if err != nil {
			return nil, "", err
		}
	default:
		return nil, "", errors.New("image_gen: provider returned neither b64_json nor url")
	}
	if len(data) == 0 {
		return nil, "", errors.New("image_gen: provider returned an empty picture")
	}
	if int64(len(data)) > imageGenMaxBytes {
		return nil, "", fmt.Errorf("image_gen: picture is larger than %d MiB", imageGenMaxBytes>>20)
	}
	mime := http.DetectContentType(data)
	if !strings.HasPrefix(mime, "image/") {
		return nil, "", fmt.Errorf("image_gen: provider returned %s, not a picture", mime)
	}
	return data, mime, nil
}

func (g *ImageGenerator) download(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("image_gen: build download: %w", err)
	}
	req.Header.Set("User-Agent", "bothouse-image/0.1 (+curl-compatible)")
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("image_gen: download picture: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("image_gen: download returned %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, imageGenMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("image_gen: read download: %w", err)
	}
	return data, nil
}

// List returns finished pictures, newest first.
func (g *ImageGenerator) List(limit int) []ImageGenResult {
	if limit <= 0 {
		limit = imageGenRecentDefault
	}
	out := make([]ImageGenResult, 0, limit)
	entries, err := os.ReadDir(g.cfg.OutDir)
	if err != nil {
		// No picture drawn yet: an empty list, not null, so the panel and the API agree.
		return out
	}
	type dated struct {
		res  ImageGenResult
		mod  time.Time
		size int64
	}
	all := make([]dated, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		mime := imageMimeForName(name)
		if mime == "" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		all = append(all, dated{
			res:  ImageGenResult{Name: name, File: filepath.Join(g.cfg.OutDir, name), URL: "/api/v1/image-gen/file/" + name, Mime: mime},
			mod:  info.ModTime(),
			size: info.Size(),
		})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].mod.After(all[j].mod) })
	if len(all) > limit {
		all = all[:limit]
	}
	list := make([]ImageGenResult, len(all))
	for i, d := range all {
		d.res.Bytes = int(d.size)
		list[i] = d.res
	}
	return list
}

// Open reads one picture by file name for the panel's <img>. The name must be a
// plain file name from this generator's own list — no path separators, no "..".
func (g *ImageGenerator) Open(name string) ([]byte, string, error) {
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		return nil, "", errors.New("invalid picture name")
	}
	mime := imageMimeForName(name)
	if mime == "" {
		return nil, "", errors.New("invalid picture name")
	}
	b, err := os.ReadFile(filepath.Join(g.cfg.OutDir, name))
	if err != nil {
		return nil, "", err
	}
	return b, http.DetectContentType(b), nil
}

func imageMimeForName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	}
	return ""
}

func imageExt(mime string) string {
	switch mime {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

// truncateForError keeps provider error bodies short enough for a log line.
func truncateForError(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	if s == "" {
		return "(empty body)"
	}
	return s
}