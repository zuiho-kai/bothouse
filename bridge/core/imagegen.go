package core

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
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
	// ErrImageGenMisconfigured: [image_gen] is on but a local setting cannot be honoured,
	// e.g. out_dir pointing outside data_dir. Same class as "not configured": nothing was
	// sent to the provider, so the page must not blame the endpoint (502).
	ErrImageGenMisconfigured = errors.New("image generation is misconfigured")
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
	// DataDir is the root OutDir must stay under. The bytes route that serves a picture
	// carries no token (an <img> cannot send a Bearer header), so letting OutDir point at
	// any directory would turn this into "read any picture on this machine by name":
	// pointed at a workspace root, it served eight PNGs it never drew (review 1032, 06:33).
	// Empty means "no root known": OutDir is taken as written, and the caller is
	// responsible for it (tests do this).
	DataDir string
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
	// outDir is where pictures are written and served from, resolved once against DataDir.
	outDir string
	// outDirErr says why out_dir was refused; every route reports it instead of guessing.
	outDirErr error
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
	cfg.DataDir = strings.TrimSpace(cfg.DataDir)
	outDir, outDirErr := resolveImageOutDir(cfg)
	return &ImageGenerator{cfg: cfg, client: &http.Client{Timeout: imageGenTimeout}, outDir: outDir, outDirErr: outDirErr}
}

// resolveImageOutDir answers where pictures may live. With a DataDir known, OutDir must sit
// under it: the serving route is unauthenticated, so the directory it can reach is the
// security boundary, not a preference.
func resolveImageOutDir(cfg ImageGenConfig) (string, error) {
	if cfg.OutDir == "" && cfg.DataDir == "" {
		return "", fmt.Errorf("%w: out_dir 没配置，data_dir 也不知道，无从确定放图目录", ErrImageGenMisconfigured)
	}
	if cfg.OutDir == "" {
		return filepath.Join(cfg.DataDir, "images"), nil
	}
	out, err := filepath.Abs(cfg.OutDir)
	if err != nil {
		return "", fmt.Errorf("%w: out_dir %q 解析不了: %v", ErrImageGenMisconfigured, cfg.OutDir, err)
	}
	if cfg.DataDir == "" {
		return out, nil
	}
	root, err := filepath.Abs(cfg.DataDir)
	if err != nil {
		return "", fmt.Errorf("%w: data_dir %q 解析不了: %v", ErrImageGenMisconfigured, cfg.DataDir, err)
	}
	// Compare real paths, so a symlink inside data_dir cannot stand for an outside directory.
	// The paths need not exist yet (a fresh install has drawn nothing): resolve the deepest
	// ancestor that does and keep the rest as written, so /var vs /private/var on macOS does
	// not read as "outside".
	root = resolveRealPath(root)
	out = resolveRealPath(out)
	rel, err := filepath.Rel(root, out)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: out_dir %s 不在 data_dir %s 下；看图路由免 token，只服务这个目录里的图", ErrImageGenMisconfigured, cfg.OutDir, cfg.DataDir)
	}
	return out, nil
}

// Config returns a copy of the effective configuration (no secrets are hidden
// here: the panel's status handler decides what to show).
func (g *ImageGenerator) Config() ImageGenConfig { return g.cfg }

// resolveRealPath resolves symlinks in the part of p that exists, and appends the part that
// does not. filepath.EvalSymlinks alone fails on a directory that is not created yet.
func resolveRealPath(p string) string {
	if real, err := filepath.EvalSymlinks(p); err == nil {
		return real
	}
	parent, base := filepath.Split(filepath.Clean(p))
	if base == "" || parent == "" {
		return filepath.Clean(p)
	}
	return filepath.Join(resolveRealPath(filepath.Clean(parent)), base)
}

// OutDir is where this generator writes and lists pictures from: the resolved, checked path.
func (g *ImageGenerator) OutDir() string {
	if g.outDir != "" {
		return g.outDir
	}
	return g.cfg.OutDir
}

// OutDirError says why out_dir was refused, or nil when it was accepted.
func (g *ImageGenerator) OutDirError() error { return g.outDirErr }

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
	if g.outDirErr != nil {
		return g.outDirErr
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

	outDir := g.OutDir()
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, fmt.Errorf("image_gen: create out dir: %w", err)
	}
	name, file, err := g.writeUnique(outDir, data, mime)
	if err != nil {
		return nil, err
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

// writeUnique writes the picture under a name nothing else is using. A name that is only
// the second it was drawn in silently overwrote the previous picture when two finished in
// the same second (review 1032, 06:33), so the second is followed by a random suffix and a
// name already on disk is never reused.
func (g *ImageGenerator) writeUnique(outDir string, data []byte, mime string) (string, string, error) {
	stamp := time.Now().Format("20060102-150405")
	for attempt := 0; attempt < 8; attempt++ {
		var suffix [4]byte
		if _, err := rand.Read(suffix[:]); err != nil {
			return "", "", fmt.Errorf("image_gen: 生成文件名失败: %w", err)
		}
		name := fmt.Sprintf("gen-%s-%s%s", stamp, hex.EncodeToString(suffix[:]), imageExt(mime))
		file := filepath.Join(outDir, name)
		// O_EXCL: a name that exists is somebody else's picture; pick another instead of
		// overwriting it.
		f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			if errors.Is(err, os.ErrExist) {
				continue
			}
			return "", "", fmt.Errorf("image_gen: write picture: %w", err)
		}
		// 0o644: the picture is served to the panel's <img>; no secrets live in it.
		_, werr := f.Write(data)
		cerr := f.Close()
		if werr != nil || cerr != nil {
			_ = os.Remove(file)
			if werr == nil {
				werr = cerr
			}
			return "", "", fmt.Errorf("image_gen: write picture: %w", werr)
		}
		return name, file, nil
	}
	return "", "", errors.New("image_gen: 连续几次都撞上已有文件名")
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
		// The parse error quotes the URL it rejected, key and all.
		return nil, "", redactedWrap("image_gen: build request: ", err)
	}
	req.Header.Set("Authorization", "Bearer "+g.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	// Cloudflare-fronted relays reject Go's default user agent; the same string
	// this machine's image service sends (pixel-avatar ai.py).
	req.Header.Set("User-Agent", "bothouse-image/0.1 (+curl-compatible)")

	resp, err := g.client.Do(req)
	if err != nil {
		// The *url.Error inside quotes the request URL; Go masks a userinfo password but
		// not the user name or the query string, so mask before this can reach the log.
		return nil, "", redactedWrap("image_gen: request: ", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, imageGenMaxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("image_gen: read response: %w", err)
	}
	// The limit truncates the JSON, so the old code then reported "unexpected end of JSON
	// input" for any oversized answer instead of the real problem (review 1032, 06:33).
	if int64(len(raw)) > imageGenMaxBytes {
		return nil, "", fmt.Errorf("image_gen: 服务商的应答超过 %d MiB，已停下（多半是图太大或地址填错）", imageGenMaxBytes>>20)
	}
	if resp.StatusCode != http.StatusOK {
		// A relay's error body sometimes quotes the request URL with its key; mask it here
		// so the 502 text the page shows (and the log line) carries the reason, not the key.
		return nil, "", fmt.Errorf("image_gen: provider returned %d: %s", resp.StatusCode, redactURLSecrets(truncateForError(raw)))
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
		// url.Parse quotes the raw URL it could not read, key and all.
		return nil, redactedWrap("image_gen: build download: ", err)
	}
	req.Header.Set("User-Agent", "bothouse-image/0.1 (+curl-compatible)")
	resp, err := g.client.Do(req)
	if err != nil {
		// The provider's picture URL may carry a key in its query string (a relay's signed
		// link does); the error text keeps the reason, not the secret.
		return nil, redactedWrap("image_gen: download picture: ", err)
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
	if g.outDirErr != nil {
		// A refused out_dir lists nothing: the status call would otherwise enumerate pictures
		// this server never drew (that is what "out_dir = a workspace root" looked like).
		return out
	}
	outDir := g.OutDir()
	entries, err := os.ReadDir(outDir)
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
		// A link or a directory is not a picture this generator wrote; listing it would
		// offer a name the serving route then has to refuse.
		if !e.Type().IsRegular() {
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
		if !info.Mode().IsRegular() {
			continue
		}
		// The extension is a hint, not evidence: a text file named .png is not a picture the
		// panel can show, and listing it would advertise a URL that only answers 404.
		if head, err := readImageHead(filepath.Join(outDir, name)); err != nil || !strings.HasPrefix(head, "image/") {
			continue
		}
		all = append(all, dated{
			res:  ImageGenResult{Name: name, File: filepath.Join(outDir, name), URL: "/api/v1/image-gen/file/" + name, Mime: mime},
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

// readImageHead sniffs the first block of a file, the same way Open decides whether the bytes
// are a picture. http.DetectContentType needs at most 512 bytes.
// 来源：net/http 的 DetectContentType 只看前 512 字节（sniffLen）。
func readImageHead(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	head := make([]byte, 512)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", err
	}
	return http.DetectContentType(head[:n]), nil
}

// Open reads one picture by file name for the panel's <img>. The name must be a
// plain file name from this generator's own list — no path separators, no "..".
//
// The route that calls this has no token, so every way out of out_dir is closed here:
//   - the name must be one path element whose extension is a picture;
//   - the file must not be a symlink (os.ReadFile follows one, so `link.png -> secret.txt`
//     used to 200 the secret: review 1032, 06:33);
//   - the resolved real path must still be inside the resolved out_dir, which also covers a
//     symlinked subdirectory or a data_dir whose own path is a link;
//   - the bytes must actually be an image, decided by content and not by the extension.
func (g *ImageGenerator) Open(name string) ([]byte, string, error) {
	if g.outDirErr != nil {
		return nil, "", g.outDirErr
	}
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") ||
		strings.ContainsAny(name, "/\\") {
		return nil, "", errors.New("invalid picture name")
	}
	if imageMimeForName(name) == "" {
		return nil, "", errors.New("invalid picture name")
	}
	dir := g.OutDir()
	// Lstat, not Stat: a symlink must be refused even when its target is inside out_dir,
	// because the name would then stand for a file this generator never wrote.
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil {
		return nil, "", err
	}
	if !info.Mode().IsRegular() {
		return nil, "", errors.New("not a regular picture file")
	}
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, "", err
	}
	realFile, err := filepath.EvalSymlinks(filepath.Join(dir, name))
	if err != nil {
		return nil, "", err
	}
	rel, err := filepath.Rel(realDir, realFile)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel != name {
		return nil, "", errors.New("picture is outside out_dir")
	}
	b, err := os.ReadFile(realFile)
	if err != nil {
		return nil, "", err
	}
	mime := http.DetectContentType(b)
	if !strings.HasPrefix(mime, "image/") {
		return nil, "", errors.New("not a picture: " + mime)
	}
	return b, mime, nil
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

// redactedWrap prefixes an error with context and masks credentials in its text while
// keeping the original reachable: unwrapping still finds a cancelled context or a timed-out
// dial, so callers can keep matching on the cause (errors.Is/As) instead of on a string.
func redactedWrap(prefix string, err error) error {
	e := &redactedError{prefix: prefix, msg: redactURLSecrets(err.Error()), err: err}
	return e
}

type redactedError struct {
	prefix string
	msg    string
	err    error
}

func (e *redactedError) Error() string { return e.prefix + e.msg }
func (e *redactedError) Unwrap() error { return e.err }

// credentialQueryNames are the query parameter names whose value is a secret. A relay
// that wants a key in the query string uses one of these; `size`, `model` and the like
// are left alone (review 466).
var credentialQueryNames = map[string]bool{
	"token":         true,
	"access_token":  true,
	"refresh_token": true,
	"api_key":       true,
	"apikey":        true,
	"key":           true,
	"secret":        true,
	"password":      true,
	"sig":           true,
	"signature":     true,
	"credential":    true,
	"credentials":   true,
}

// isCredentialQueryName also catches family names (x-api-key, relay_token, client_secret)
// so a relay inventing its own spelling is still covered.
func isCredentialQueryName(name string) bool {
	// Decode only for matching; the caller keeps the original query spelling.
	// Invalid escapes retain the existing raw-name matching behavior.
	if decoded, err := url.QueryUnescape(name); err == nil {
		name = decoded
	}
	n := strings.ToLower(name)
	if credentialQueryNames[n] {
		return true
	}
	return strings.Contains(n, "token") || strings.Contains(n, "secret") ||
		strings.Contains(n, "password") || strings.Contains(n, "credential") ||
		strings.HasSuffix(n, "_key") || strings.HasSuffix(n, "-key")
}

// redactURLSecrets masks the two places a key can ride inside a URL: the userinfo
// (https://user:sk-...@relay/v1, or a bare https://sk-...@relay/v1 where the user name is
// the key) and the value of a credential-named query parameter (…?token=sk-...). The host
// and path stay readable, and an ordinary URL comes back byte-for-byte, so the panel can
// still show which endpoint is configured. Used for the status echo and for error text:
// the Go client masks a userinfo password but leaves the user name and the query string
// in *url.Error, and a provider's error body may quote the request URL.
func redactURLSecrets(s string) string {
	var b strings.Builder
	rest := s
	for {
		i := strings.Index(rest, "://")
		if i < 0 {
			b.WriteString(rest)
			break
		}
		start := i + 3
		b.WriteString(rest[:start])
		// The authority ends at the first character that cannot belong to it; in error
		// text that is the quote around the URL, or the space before the next word.
		end := len(rest)
		if j := strings.IndexAny(rest[start:], "/?# \t\"'`<>"); j >= 0 {
			end = start + j
		}
		auth := rest[start:end]
		if at := strings.LastIndexByte(auth, '@'); at >= 0 {
			b.WriteString("***")
			b.WriteString(auth[at:])
		} else {
			b.WriteString(auth)
		}
		rest = rest[end:]
	}
	return maskCredentialQueryValues(b.String())
}

// maskCredentialQueryValues masks sensitive query values in a string that may be a bare URL
// or a sentence quoting one; a query ends at whitespace, a quote, or the end of the text.
// Every query in the text is visited, so an error naming two URLs is covered too.
func maskCredentialQueryValues(s string) string {
	var b strings.Builder
	rest := s
	for {
		q := strings.IndexByte(rest, '?')
		if q < 0 {
			b.WriteString(rest)
			return b.String()
		}
		end := len(rest)
		if j := strings.IndexAny(rest[q:], " \t\"'`<>"); j >= 0 {
			end = q + j
		}
		b.WriteString(rest[:q+1])
		parts := strings.Split(rest[q+1:end], "&")
		for i, p := range parts {
			name, _, ok := strings.Cut(p, "=")
			if ok && isCredentialQueryName(name) {
				parts[i] = name + "=***"
			}
		}
		b.WriteString(strings.Join(parts, "&"))
		rest = rest[end:]
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
