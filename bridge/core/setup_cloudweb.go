package core

// Setup wizard, 自建平台 (cloud_web). cc-connect only plugs into the platform: each role dials
// the platform's CWIP endpoint as one bot (platform/cloud-web, protocol in docs/cloud-web.md).
// The platform here is the role-household hub (role-household/rh/hub.py + rh/cloudweb.py).
//
//   wizard ─▶ LocalHubStatus  managed hub (<data_dir>/hub/hub.json) or anything on 127.0.0.1:8790
//          ─▶ StartLocalHub   embedded hub source + uv  →  detached python -m rh.hub
//          ─▶ TestCloudWeb    WebSocket handshake with the bot token (101 / 401 / no answer)
//          ─▶ ApplyWizard     [[projects.platforms]] type = "cloud_web", ws_url ?bot=<project>
//
// A request platform name maps to a preset (cloudWebPresets). Another CWIP platform (DSH 网页)
// is one more entry there — same options, its own allow_from.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// WizardCloudWeb is the platform the roles join. Both fields may be left empty when this
// wizard started the local hub: url defaults to it and its bot token is filled in server-side.
type WizardCloudWeb struct {
	URL   string `json:"url,omitempty"`   // http(s)://host[:port] of the platform (or its ws(s)://…/cloud-web/ws)
	Token string `json:"token,omitempty"` // the platform's bot token
}

// cloudWebPreset is what differs between CWIP platforms; the rest of the options are the same.
type cloudWebPreset struct {
	AllowFrom string // user_id of the person the bots take orders from
}

// cloudWebPresets: request platform name → preset. All write [[projects.platforms]] type = "cloud_web".
// 来源：rh/cloudweb.py 文件头与 rh/hub.py：hub 里人类成员的 user_id 是 "user"（线上 ~/.cc-connect/config.toml
// 的 cloud_web 段也是 allow_from = "user"）。DSH 网页以后加一条 {AllowFrom: "owner"}（任务说明 2026-10-21）。
var cloudWebPresets = map[string]cloudWebPreset{
	"cloud_web": {AllowFrom: "user"},
}

func isCloudWebPlatform(p string) bool {
	_, ok := cloudWebPresets[p]
	return ok
}

// 来源：platform/cloud-web/protocol.go defaultWSPath。
const cloudWebWSPath = "/cloud-web/ws"

// 来源：role-household rh/hub.py main() --port 默认 8790（--host 默认 127.0.0.1）。变量便于测试替换。
var localHubPort = 8790

// cloudWebWSBase turns what the user typed into the ws(s)://host/path the bots dial, without a
// query. Same mapping as platform/cloud-web resolveWSURL: http → ws, https → wss, a bare host →
// ws; an http(s) address gets /cloud-web/ws appended to its path.
func cloudWebWSBase(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", errors.New("empty address")
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("not an address: %q", raw)
	}
	// localhost = this machine: written as 127.0.0.1, which the local hub listens on (localhost may
	// resolve to ::1 first) and which the local hub's address is compared with (resolveCloudWeb)
	if strings.EqualFold(u.Hostname(), "localhost") {
		if p := u.Port(); p != "" {
			u.Host = "127.0.0.1:" + p
		} else {
			u.Host = "127.0.0.1"
		}
	}
	path := strings.TrimRight(u.Path, "/")
	switch u.Scheme {
	case "http", "https":
		if u.Scheme == "http" {
			u.Scheme = "ws"
		} else {
			u.Scheme = "wss"
		}
		if !strings.HasSuffix(path, cloudWebWSPath) {
			path += cloudWebWSPath
		}
	case "ws", "wss":
		if path == "" {
			path = cloudWebWSPath
		}
	default:
		return "", fmt.Errorf("address must start with http://, https://, ws:// or wss://: %q", raw)
	}
	u.Path, u.RawPath, u.RawQuery, u.Fragment, u.User = path, "", "", "", nil
	return u.String(), nil
}

// cloudWebPageURL is the platform's web page for a ws base: wss://h/p/cloud-web/ws → https://h/p/.
func cloudWebPageURL(wsBase string) string {
	u, err := url.Parse(wsBase)
	if err != nil {
		return ""
	}
	if u.Scheme == "wss" {
		u.Scheme = "https"
	} else {
		u.Scheme = "http"
	}
	u.Path = strings.TrimSuffix(u.Path, cloudWebWSPath) + "/"
	u.RawQuery = ""
	return u.String()
}

// cloudWebBotURL is the ws_url of one role: ?bot=<project>&name=<display name>[&mention_id=<Discord bot ID>]
// (rh/cloudweb.py 文件头「连接」). mention_id lets teammates' <@id> written for Discord @ it on the hub too.
func cloudWebBotURL(wsBase, project, name, mentionID string) string {
	// written by hand rather than url.Values.Encode (which sorts keys): bot first, like the hand-made configs
	q := "bot=" + url.QueryEscape(project)
	if name != "" && name != project {
		q += "&name=" + url.QueryEscape(name)
	}
	if mentionID != "" {
		q += "&mention_id=" + url.QueryEscape(mentionID)
	}
	return wsBase + "?" + q
}

// sameCloudWebHub: two addresses lead to the same platform (scheme, host and path; query ignored).
func sameCloudWebHub(a, b string) bool {
	x, err1 := cloudWebWSBase(stripQuery(a))
	y, err2 := cloudWebWSBase(stripQuery(b))
	return err1 == nil && err2 == nil && x == y
}

func stripQuery(s string) string {
	if i := strings.IndexAny(s, "?#"); i >= 0 {
		return s[:i]
	}
	return s
}

// cloudWebQuery reads one query value of a ws_url ("" when absent or unparsable).
func cloudWebQuery(wsURL, key string) string {
	u, err := url.Parse(strings.TrimSpace(wsURL))
	if err != nil {
		return ""
	}
	return u.Query().Get(key)
}

// ── test connection ───────────────────────────────────────────

// CloudWebTestResult: code is ok | unauthorized | unreachable | not_found | redirect | bad_url | error.
type CloudWebTestResult struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code"`
	Status  int    `json:"status,omitempty"` // HTTP status of the handshake
	Message string `json:"message,omitempty"`
	Fix     string `json:"fix,omitempty"`
	PageURL string `json:"page_url,omitempty"` // the platform's web page (no token in it)
}

// 来源：实现者定。本机或局域网的握手通常几十毫秒；跨公网（线上 wss://<vps>）实测 1 秒内。5 秒还没回就当连不上。
var cloudWebTestTimeout = 5 * time.Second

// TestCloudWeb opens the WebSocket handshake a bot would (Authorization: Bearer <token>) and closes
// it right after the 101, before registering, so nothing shows up on the platform.
func TestCloudWeb(ctx context.Context, rawURL, token, lang string) CloudWebTestResult {
	base, err := cloudWebWSBase(stripQuery(rawURL))
	if err != nil {
		return cloudWebTestText(lang, CloudWebTestResult{Code: "bad_url"}, err.Error())
	}
	res := CloudWebTestResult{PageURL: cloudWebPageURL(base)}
	status, location, err := cloudWebHandshake(ctx, base, token)
	res.Status = status
	switch {
	case err != nil:
		res.Code = "unreachable"
		return cloudWebTestText(lang, res, err.Error())
	case status == http.StatusSwitchingProtocols:
		res.OK, res.Code = true, "ok"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		res.Code = "unauthorized"
	case status == http.StatusNotFound:
		res.Code = "not_found"
	case status >= 300 && status < 400:
		res.Code = "redirect"
		return cloudWebTestText(lang, res, location)
	default:
		res.Code = "error"
	}
	return cloudWebTestText(lang, res, "HTTP "+strconv.Itoa(status))
}

// cloudWebHandshake returns the HTTP status of a WebSocket upgrade to wsBase (stdlib only: core
// does not import a WebSocket library). A 101 body is the raw connection; it is closed at once.
// A redirect is not followed (a bot does not follow one either): the status and Location come back.
func cloudWebHandshake(ctx context.Context, wsBase, token string) (int, string, error) {
	u, err := url.Parse(wsBase)
	if err != nil {
		return 0, "", err
	}
	if u.Scheme == "wss" {
		u.Scheme = "https"
	} else {
		u.Scheme = "http"
	}
	ctx, cancel := context.WithTimeout(ctx, cloudWebTestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, "", err
	}
	key := make([]byte, 16)
	_, _ = rand.Read(key)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", base64.StdEncoding.EncodeToString(key))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := noRedirectClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	resp.Body.Close()
	return resp.StatusCode, resp.Header.Get("Location"), nil
}

var noRedirectClient = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func cloudWebTestText(lang string, r CloudWebTestResult, detail string) CloudWebTestResult {
	switch r.Code {
	case "ok":
		r.Message = tr3(lang, "连上了，token 对。", "接続できました。token も正しいです。", "Connected; the token is right.")
	case "unauthorized":
		r.Message = tr3(lang, "地址对，但 token 不对（"+detail+"）。", "アドレスは正しいですが、token が違います（"+detail+"）。", "The address is right but the token is wrong ("+detail+").")
		r.Fix = tr3(lang, "填这个平台给机器人用的 token（自建平台是启动时的 RH_BOT_TOKEN，没设就是 RH_HUB_TOKEN），注意别多复制空格。",
			"このプラットフォームのボット用 token を入れてください（自前のプラットフォームなら起動時の RH_BOT_TOKEN、未設定なら RH_HUB_TOKEN）。余分な空白に注意。",
			"Use the platform's bot token (for the self-hosted hub: RH_BOT_TOKEN it was started with, or RH_HUB_TOKEN if that is not set). Watch for extra spaces.")
	case "not_found":
		r.Message = tr3(lang, "这个地址有服务，但不是自建平台的机器人入口（"+detail+"）。", "このアドレスにサービスはありますが、自前プラットフォームのボット入口ではありません（"+detail+"）。", "Something answers at this address, but it is not the platform's bot endpoint ("+detail+").")
		r.Fix = tr3(lang, "填平台网页的地址（打开就是聊天页面的那个），不要带路径；端口别填错。",
			"プラットフォームの Web ページのアドレス（開くとチャット画面になるもの）を、パスなしで入れてください。ポートも確認してください。",
			"Enter the address of the platform's web page (the one that opens the chat), without a path; check the port.")
	case "unreachable":
		r.Message = tr3(lang, "连不上这个地址："+detail, "このアドレスに接続できません："+detail, "Cannot reach this address: "+detail)
		r.Fix = tr3(lang, "看地址和端口有没有写错、平台有没有在运行；在别的电脑上的平台要用那台电脑的地址，不能写 127.0.0.1。",
			"アドレスとポートが正しいか、プラットフォームが動いているかを確認してください。別のコンピューターのプラットフォームなら 127.0.0.1 ではなくそのコンピューターのアドレスを使います。",
			"Check the address and port, and that the platform is running. A platform on another computer needs that computer's address, not 127.0.0.1.")
	case "redirect":
		r.Message = tr3(lang, "这个地址把请求转到了别处（"+detail+"），机器人不会跟着跳。", "このアドレスは別の場所へ転送しています（"+detail+"）。ボットは転送先についていきません。",
			"This address redirects elsewhere ("+detail+"); bots do not follow redirects.")
		r.Fix = tr3(lang, "直接填跳转后的地址（常见：http 换成 https，或者少了/多了路径）。", "転送先のアドレスを直接入れてください（よくある例：http を https に、パスの過不足）。",
			"Enter the final address instead (often http → https, or a path too many / too few).")
	case "bad_url":
		r.Message = tr3(lang, "地址格式不对："+detail, "アドレスの形式が違います："+detail, "Not a valid address: "+detail)
		r.Fix = tr3(lang, "写成 http://主机:端口 或 https://域名。", "http://ホスト:ポート または https://ドメイン の形で入れてください。", "Use http://host:port or https://domain.")
	default:
		r.Message = tr3(lang, "平台回了意外的结果（"+detail+"）。", "プラットフォームが予期しない応答を返しました（"+detail+"）。", "The platform answered unexpectedly ("+detail+").")
		r.Fix = tr3(lang, "确认这个地址是自建平台；平台刚启动的话等几秒再测。", "このアドレスが自前のプラットフォームか確認してください。起動直後なら数秒待ってから再テストしてください。", "Make sure this is the platform's address; if it just started, wait a few seconds and test again.")
	}
	return r
}

// ── local hub ─────────────────────────────────────────────────

var hubSourceFS fs.FS

// RegisterHubSource registers the embedded role-household hub source (internal/rhhub). A build
// without it (go build without `make hubsrc`) can still connect to a hub, just not start one.
func RegisterHubSource(fsys fs.FS) { hubSourceFS = fsys }

func hubSourceAvailable() bool {
	if hubSourceFS == nil {
		return false
	}
	_, err := fs.Stat(hubSourceFS, "rh/hub.py")
	return err == nil
}

// localHubState is <data_dir>/hub/hub.json (0600): the hub this wizard started. Its presence also
// means cc-connect starts the hub again when it is not running (EnsureLocalHub at startup).
type localHubState struct {
	Port      int    `json:"port"`
	WebToken  string `json:"web_token"` // RH_HUB_TOKEN: signs in to the web page
	BotToken  string `json:"bot_token"` // RH_BOT_TOKEN: what the bots use (written into config.toml)
	StartedAt string `json:"started_at,omitempty"`
}

func localHubDir(dataDir string) string { return filepath.Join(dataDir, "hub") }

func loadLocalHubState(dataDir string) (localHubState, bool) {
	var s localHubState
	ok := readJSONFile(filepath.Join(localHubDir(dataDir), "hub.json"), &s) && s.Port > 0 && s.BotToken != ""
	return s, ok
}

func localHubURL(port int) string { return "http://127.0.0.1:" + strconv.Itoa(port) }

// LocalHubStatus is what the wizard shows for 「本机自建平台」. Tokens never leave the server except
// in OpenURL (the hub's own sign-in link, for the browser on this machine).
type LocalHubStatus struct {
	Running    bool   `json:"running"`
	URL        string `json:"url,omitempty"`
	Managed    bool   `json:"managed"`     // started by this wizard (<data_dir>/hub/hub.json)
	TokenKnown bool   `json:"token_known"` // the wizard fills the bot token in by itself
	OpenURL    string `json:"open_url,omitempty"`
	CanStart   bool   `json:"can_start"`
	Missing    string `json:"missing,omitempty"` // why it cannot start: "uv" | "source"
	Hint       string `json:"hint,omitempty"`
	LogFile    string `json:"log_file,omitempty"`
}

// GetLocalHubStatus: the hub this wizard started (token known), else whatever CWIP server answers
// on this machine's hub port (address known, token not: the user types it).
func GetLocalHubStatus(ctx context.Context, dataDir, lang string) LocalHubStatus {
	st := LocalHubStatus{}
	if s, ok := loadLocalHubState(dataDir); ok {
		st.Managed, st.TokenKnown, st.URL = true, true, localHubURL(s.Port)
		st.LogFile = filepath.Join(localHubDir(dataDir), "hub.log")
		if base, err := cloudWebWSBase(st.URL); err == nil {
			if code, _, err := cloudWebHandshake(ctx, base, s.BotToken); err == nil && code == http.StatusSwitchingProtocols {
				st.Running = true
				st.OpenURL = st.URL + "/#token=" + url.QueryEscape(s.WebToken)
			}
		}
	}
	if !st.Running {
		u := localHubURL(localHubPort)
		if base, err := cloudWebWSBase(u); err == nil && (!st.Managed || st.URL != u) {
			// no token: a CWIP server answers 401 (rh/cloudweb.py handle)
			if code, _, err := cloudWebHandshake(ctx, base, ""); err == nil && (code == http.StatusUnauthorized || code == http.StatusSwitchingProtocols) {
				st = LocalHubStatus{Running: true, URL: u}
			}
		}
	}
	if !st.Running {
		st.CanStart, st.Missing = localHubCanStart()
	}
	st.Hint = localHubHint(lang, st)
	return st
}

func localHubCanStart() (bool, string) {
	if !hubSourceAvailable() {
		return false, "source"
	}
	if _, _, err := lookPath("uv"); err != nil {
		return false, "uv"
	}
	return true, ""
}

func localHubHint(lang string, st LocalHubStatus) string {
	switch {
	case st.Running && st.TokenKnown:
		return tr3(lang, "本机自建平台在运行，地址和 token 已自动填好。", "このマシンの自前プラットフォームが動いています。アドレスと token は自動で入れました。",
			"The self-hosted platform on this machine is running; address and token are filled in.")
	case st.Running:
		return tr3(lang, "本机 "+st.URL+" 有自建平台在跑，但不是向导启动的，不知道它的 token：填它的 token（启动时的 RH_BOT_TOKEN，没设就是 RH_HUB_TOKEN）。",
			"このマシンの "+st.URL+" で自前プラットフォームが動いていますが、ウィザードが起動したものではないため token が分かりません。その token（起動時の RH_BOT_TOKEN、未設定なら RH_HUB_TOKEN）を入れてください。",
			"A self-hosted platform is running at "+st.URL+" on this machine, but not one this wizard started, so its token is unknown: enter it (RH_BOT_TOKEN it was started with, or RH_HUB_TOKEN).")
	case st.CanStart && st.Managed:
		return tr3(lang, "向导之前启动过的本机自建平台现在没在跑：点「在本机启动」重新拉起来（地址和 token 不变）。",
			"以前ウィザードで起動したこのマシンのプラットフォームが今は動いていません。「このマシンで起動」で再起動できます（アドレスと token はそのまま）。",
			"The platform this wizard started earlier is not running: click \"Start on this machine\" to start it again (same address and token).")
	case st.CanStart:
		return tr3(lang, "本机还没有自建平台：点「在本机启动」，向导在这台电脑上起一个（只有本机能访问），地址和 token 自动填。第一次要联网下载 Python 依赖，约半分钟。",
			"このマシンにはまだプラットフォームがありません。「このマシンで起動」を押すと、ウィザードがこのコンピューターに 1 つ立てます（このマシンからのみアクセス可）。アドレスと token は自動で入ります。初回は Python の依存をダウンロードするので 30 秒ほどかかります。",
			"No platform on this machine yet: click \"Start on this machine\" and the wizard starts one here (this computer only), with address and token filled in. The first start downloads Python packages (about half a minute).")
	case st.Missing == "uv":
		return tr3(lang, "要在本机启动自建平台，需要先装 uv（Python 的运行工具，装一次就行）。装好后点「重新检测」。也可以在下面填别人的平台。",
			"このマシンでプラットフォームを起動するには、先に uv（Python の実行ツール、1 回入れるだけ）が必要です。入れたら「再検出」を押してください。下で他の人のプラットフォームを入れることもできます。",
			"Starting the platform here needs uv (a Python runner, installed once). Install it, then click \"Detect again\". Or enter someone else's platform below.")
	default:
		return tr3(lang, "这个 bothouse 安装包里没带自建平台程序，不能在本机一键启动：请连别人的平台（下面填地址和 token），或者用 conest 仓库里的 role-household 自己起一个。",
			"この bothouse のパッケージにはプラットフォーム本体が入っていないため、ここでは起動できません。他の人のプラットフォームにつなぐか（下にアドレスと token）、conest リポジトリの role-household で自分で起動してください。",
			"This bothouse build does not include the platform, so it cannot start one here: connect to someone else's (address and token below), or run role-household from the conest repo yourself.")
	}
}

// Python packages the hub needs (rh/hub.py → aiohttp; rh/webpush.py → cryptography). Nothing else
// it imports is outside the standard library (2026-10-21 实测：只装这两个，hub 起得来、bot 能连)。
// 来源：role-household/uv.lock 锁定的版本 aiohttp 3.14.5、cryptography 50.0.2；Python ≥ 3.11 来自 pyproject.toml
// requires-python（rh/config.py 用 tomllib）。
var localHubUVArgs = []string{"run", "--no-project", "--python", ">=3.11",
	"--with", "aiohttp==3.14.5", "--with", "cryptography==50.0.2", "python", "-m", "rh.hub"}

// 来源：2026-10-21 本机实测，依赖已缓存时 6 秒能连；第一次要下载 Python 和依赖，留 90 秒（实现者定）。
var localHubStartWait = 90 * time.Second

// StartLocalHub starts the hub on 127.0.0.1 from the embedded source: tokens and port are kept
// in <data_dir>/hub/hub.json (an earlier start's are reused), data in <data_dir>/hub/hub.sqlite3,
// log in <data_dir>/hub/hub.log. The process is detached, so restarting cc-connect does not stop it.
func StartLocalHub(ctx context.Context, dataDir, lang string) (LocalHubStatus, error) {
	if ok, missing := localHubCanStart(); !ok {
		st := LocalHubStatus{Missing: missing}
		return st, errors.New(localHubHint(lang, st))
	}
	if st := GetLocalHubStatus(ctx, dataDir, lang); st.Running && st.Managed {
		return st, nil
	}
	s, had := loadLocalHubState(dataDir)
	if !had {
		// 来源：实现者定，24 字节随机数（48 个十六进制字符），比管理口令的 16 字节长一些
		s = localHubState{WebToken: GenerateToken(24), BotToken: GenerateToken(24), Port: pickHubPort()}
	} else if !portFree(s.Port) {
		// Its port is in use. Never start a second hub on the same hub.sqlite3, and never move to
		// another port (config.toml's ws_url points at this one): find out who holds it.
		return localHubPortTaken(ctx, dataDir, lang, s)
	}
	if err := startHubProcess(dataDir, &s); err != nil {
		return LocalHubStatus{}, err
	}
	base, _ := cloudWebWSBase(localHubURL(s.Port))
	deadline := time.Now().Add(localHubStartWait)
	for time.Now().Before(deadline) {
		if code, _, err := cloudWebHandshake(ctx, base, s.BotToken); err == nil && code == http.StatusSwitchingProtocols {
			return GetLocalHubStatus(ctx, dataDir, lang), nil
		}
		select {
		case <-ctx.Done():
			return LocalHubStatus{}, ctx.Err()
		case <-time.After(500 * time.Millisecond): // 来源：实现者定，轮询间隔
		}
	}
	logFile := filepath.Join(localHubDir(dataDir), "hub.log")
	return LocalHubStatus{LogFile: logFile}, fmt.Errorf("%s %s", tr3(lang, "自建平台没在 90 秒内起来，看日志：", "プラットフォームが 90 秒以内に起動しませんでした。ログ：",
		"The platform did not come up within 90 seconds; see the log:"), logFile+tailFile(logFile, 600))
}

// localHubPortTaken: hub.json's port is in use. Asked with our bot token:
//   - 101: our hub, it answers now → running;
//   - 401/403: a hub, but not with our token → someone else's platform here (address only, like
//     GetLocalHubStatus's unmanaged case);
//   - any other HTTP answer, or a non-timeout network error → another program holds the port: error + fix;
//   - a timeout → our hub, too busy to answer → running (the apply-time test checks again).
func localHubPortTaken(ctx context.Context, dataDir, lang string, s localHubState) (LocalHubStatus, error) {
	u := localHubURL(s.Port)
	port := strconv.Itoa(s.Port)
	base, _ := cloudWebWSBase(u)
	code, _, err := cloudWebHandshake(ctx, base, s.BotToken)
	var ne net.Error
	switch {
	case err == nil && code == http.StatusSwitchingProtocols:
		return GetLocalHubStatus(ctx, dataDir, lang), nil
	case err == nil && (code == http.StatusUnauthorized || code == http.StatusForbidden):
		st := LocalHubStatus{Running: true, URL: u}
		st.Hint = localHubHint(lang, st)
		return st, nil
	case err != nil && (errors.Is(err, context.DeadlineExceeded) || errors.As(err, &ne) && ne.Timeout()):
		return LocalHubStatus{Running: true, Managed: true, TokenKnown: true, URL: u, OpenURL: u + "/#token=" + url.QueryEscape(s.WebToken),
			LogFile: filepath.Join(localHubDir(dataDir), "hub.log"),
			Hint: tr3(lang, "向导之前起的平台在端口 "+port+" 上，但这次没及时回应（可能正忙），按在运行处理。保存时会再测一次连接。",
				"以前ウィザードが起動したプラットフォームがポート "+port+" にありますが、今回は応答が間に合いませんでした（混んでいる可能性があります）。動いているものとして扱い、保存時にもう一度接続をテストします。",
				"The platform this wizard started is on port "+port+" but did not answer in time (maybe busy): treated as running. Saving tests the connection again.")}, nil
	}
	detail := "HTTP " + strconv.Itoa(code)
	if err != nil {
		detail = err.Error()
	}
	return LocalHubStatus{}, errors.New(tr3(lang,
		"端口 "+port+" 被别的程序占着（"+detail+"），向导之前起的平台用的就是这个端口。关掉占用它的程序（查是谁：macOS / Linux 运行 lsof -i :"+port+"，Windows 运行 netstat -ano | findstr :"+port+"），再点「在本机启动」。",
		"ポート "+port+" を別のプログラムが使っています（"+detail+"）。以前ウィザードが起動したプラットフォームはこのポートを使います。使っているプログラムを止めてから（確認方法：macOS / Linux は lsof -i :"+port+"、Windows は netstat -ano | findstr :"+port+"）「このマシンで起動」を押してください。",
		"Port "+port+" is held by another program ("+detail+"); the platform this wizard started uses that port. Stop that program (find it: lsof -i :"+port+" on macOS / Linux, netstat -ano | findstr :"+port+" on Windows), then click \"Start on this machine\"."))
}

// EnsureLocalHub (cc-connect startup): the hub this wizard started is started again when it is
// not running (after a reboot, or when a service manager stopped it with cc-connect).
func EnsureLocalHub(ctx context.Context, dataDir string) {
	s, ok := loadLocalHubState(dataDir)
	if !ok {
		return
	}
	base, _ := cloudWebWSBase(localHubURL(s.Port))
	if code, _, err := cloudWebHandshake(ctx, base, s.BotToken); err == nil && code == http.StatusSwitchingProtocols {
		return
	}
	if ok, missing := localHubCanStart(); !ok {
		slog.Warn("local hub: not running and cannot be started", "missing", missing)
		return
	}
	if !portFree(s.Port) {
		slog.Warn("local hub: its port is taken by something else", "port", s.Port)
		return
	}
	if err := startHubProcess(dataDir, &s); err != nil {
		slog.Warn("local hub: start failed", "error", err)
		return
	}
	slog.Info("local hub: started", "url", localHubURL(s.Port))
}

func startHubProcess(dataDir string, s *localHubState) error {
	dir := localHubDir(dataDir)
	src := filepath.Join(dir, "src")
	if err := extractHubSource(src); err != nil {
		return fmt.Errorf("unpack hub: %w", err)
	}
	s.StartedAt = time.Now().Format(time.RFC3339)
	if err := writeJSONFile(filepath.Join(dir, "hub.json"), s, 0o600); err != nil {
		return err
	}
	uv, _, err := lookPath("uv")
	if err != nil {
		return err
	}
	logf, err := os.OpenFile(filepath.Join(dir, "hub.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer logf.Close()
	args := append(append([]string{}, localHubUVArgs...), "--host", "127.0.0.1", "--port", strconv.Itoa(s.Port),
		"--db", filepath.Join(dir, "hub.sqlite3"))
	cmd := exec.Command(uv, args...)
	cmd.Dir = src
	// PYTHONIOENCODING：stdout 接到日志文件时 Windows 的 Python 默认按 cp1252 写，hub 打印中文启动行就崩（PR #5 Windows 实测）
	cmd.Env = append(os.Environ(), "RH_HUB_TOKEN="+s.WebToken, "RH_BOT_TOKEN="+s.BotToken, "PYTHONIOENCODING=utf-8")
	cmd.Stdout, cmd.Stderr = logf, logf
	detachProcess(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }() // reap it if it exits while cc-connect runs
	return nil
}

// extractHubSource writes the embedded hub source to dir (files are overwritten: a new
// cc-connect brings its own hub version).
func extractHubSource(dir string) error {
	return fs.WalkDir(hubSourceFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == "__pycache__" { // left by running the hub from the bundle dir in development
			return fs.SkipDir
		}
		target := filepath.Join(dir, filepath.FromSlash(p))
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		b, err := fs.ReadFile(hubSourceFS, p)
		if err != nil {
			return err
		}
		return AtomicWriteFile(target, b, 0o644)
	})
}

func portFree(port int) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

// pickHubPort: the hub's own default port when free, else one the OS hands out.
func pickHubPort() int {
	if portFree(localHubPort) {
		return localHubPort
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return localHubPort
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func tailFile(path string, n int) string {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return ""
	}
	if len(b) > n {
		b = b[len(b)-n:]
	}
	return "\n" + string(b)
}

// ── HTTP ──────────────────────────────────────────────────────

// The hub's sign-in link (OpenURL, carries its web token) only goes to a browser on this machine.
func (m *ManagementServer) handleSetupCloudWebLocal(w http.ResponseWriter, r *http.Request) {
	st := GetLocalHubStatus(r.Context(), m.wizardDataDir, r.URL.Query().Get("lang"))
	if !loopbackRequest(r) {
		st.OpenURL = ""
	}
	mgmtJSON(w, http.StatusOK, st)
}

func loopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (m *ManagementServer) handleSetupCloudWebStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Lang string `json:"lang"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	st, err := StartLocalHub(r.Context(), m.wizardDataDir, req.Lang)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !loopbackRequest(r) {
		st.OpenURL = ""
	}
	mgmtJSON(w, http.StatusOK, st)
}

// handleSetupCloudWebTest (POST /setup/cloudweb/test {url, token, lang}): an empty token for the
// hub this wizard started uses its bot token.
func (m *ManagementServer) handleSetupCloudWebTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL   string `json:"url"`
		Token string `json:"token"`
		Lang  string `json:"lang"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	u, tok := resolveCloudWeb(m.wizardDataDir, req.URL, req.Token)
	mgmtJSON(w, http.StatusOK, TestCloudWeb(r.Context(), u, tok, req.Lang))
}

// resolveCloudWeb fills an empty url / token from the hub this wizard started.
func resolveCloudWeb(dataDir, rawURL, token string) (string, string) {
	rawURL, token = strings.TrimSpace(rawURL), strings.TrimSpace(token)
	if s, ok := loadLocalHubState(dataDir); ok {
		local := localHubURL(s.Port)
		if rawURL == "" {
			rawURL = local
		}
		if token == "" && sameCloudWebHub(rawURL, local) {
			token = s.BotToken
		}
	}
	return rawURL, token
}

// ── team line in the persona ──────────────────────────────────

// teamMarker starts the one-line team section the wizard keeps in the persona of each member of a
// team on the self-hosted platform, the same way as the reply-language line (WithReplyLanguage):
// the lead has to know whom it can hand work to, and by what name, to @ them in the channel.
const teamMarker = "<!-- conest:team -->"

// WithTeam replaces the line after the team marker, or appends marker + line when there is none.
func WithTeam(persona, line string) string {
	eol := "\n"
	if strings.Contains(persona, "\r\n") {
		eol = "\r\n"
	}
	if i := strings.Index(persona, teamMarker); i >= 0 {
		rest := strings.TrimPrefix(strings.TrimPrefix(persona[i+len(teamMarker):], "\r"), "\n")
		after := ""
		if j := strings.Index(rest, "\n"); j >= 0 {
			after = rest[j+1:]
		}
		return persona[:i] + teamMarker + eol + line + eol + after
	}
	persona = strings.TrimRight(persona, "\r\n")
	if persona != "" {
		persona += eol + eol
	}
	return persona + teamMarker + eol + line + eol
}

// cloudWebTeamLine: who is on the team and how hand-offs work, for member self. The persona may be
// shared with Discord (a reused Discord bot also joins the platform), so the line says it is about
// the self-hosted platform. Names lose line breaks: one line under the marker (WithTeam).
func cloudWebTeamLine(lang string, team []SetupTeamEntry, fallback, self string) string {
	leadName := ""
	var subs []string
	for _, t := range team {
		if t.Project == fallback {
			leadName = oneLine(t.Name)
		} else {
			subs = append(subs, oneLine(t.Name))
		}
	}
	if self == fallback {
		return tr3(lang,
			"在自建平台上，你是团队的队长，队员有："+strings.Join(subs, "、")+"（都在同一个频道里）。要把活派给谁，就在频道里写「@名字」加上要做的事；她做完的最终回复会自动 @ 回你，你再汇总给提问的人。",
			"自前プラットフォームでは、あなたはチームのリーダーです。メンバー："+strings.Join(subs, "、")+"（同じチャンネルにいます）。仕事を任せるときはチャンネルで「@名前」と書いて内容を伝えてください。終わった最終回答は自動であなたに @ が付いて返ってくるので、まとめて質問者に伝えてください。",
			"On the self-hosted platform you lead the team; members: "+strings.Join(subs, ", ")+" (all in the same channel). To hand work to one, write \"@name\" and the task in the channel; her final answer comes back to you with an @ automatically, then you sum up for whoever asked.")
	}
	return tr3(lang,
		"在自建平台上，你在一个团队里，队长是「"+leadName+"」（都在同一个频道里）。队长 @ 你派的活，做完后你的最终回复会自动 @ 回队长；要找队友就在频道里写「@名字」。",
		"自前プラットフォームでは、あなたはチームの一員で、リーダーは「"+leadName+"」です（同じチャンネルにいます）。リーダーが @ で任せた仕事の最終回答には自動でリーダーへの @ が付きます。仲間を呼ぶときはチャンネルで「@名前」と書いてください。",
		"On the self-hosted platform you are on a team led by \""+leadName+"\" (all in the same channel). When the lead @-s you with work, your final answer goes back to the lead with an @ automatically; to call a teammate, write \"@name\" in the channel.")
}

// oneLine joins a name's lines with spaces.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// withQueryParam appends key=value to a URL as written, leaving everything else in it as it was
// (no re-encoding or re-ordering of the other parameters).
func withQueryParam(raw, key, value string) string {
	frag := ""
	if i := strings.Index(raw, "#"); i >= 0 {
		raw, frag = raw[:i], raw[i:]
	}
	sep := "?"
	if strings.Contains(raw, "?") {
		sep = "&"
		if strings.HasSuffix(raw, "?") || strings.HasSuffix(raw, "&") {
			sep = ""
		}
	}
	return raw + sep + url.QueryEscape(key) + "=" + url.QueryEscape(value) + frag
}

// The team step says what happened to each member's persona: the team line is kept up to date
// even when "edit this bot's persona" was not ticked (it is only that one marked line; the lead
// needs it to know whom to hand work to), and a hand-written persona without a wizard marker is
// not touched at all.
func stepTeamLineWritten(lang, name, path string) string {
	name = oneLine(name)
	return tr3(lang,
		"「"+name+"」的人设里更新了自建平台的队伍那一行（"+path+"，<!-- conest:team --> 下面那行）。没勾「改人设」也会更新这一行，人设其余内容不动。",
		"「"+name+"」のペルソナで自前プラットフォームのチームの行を更新しました（"+path+"、<!-- conest:team --> の次の行）。「ペルソナを編集」にチェックしていなくてもこの行だけは更新し、ほかの内容は変えません。",
		"Updated the self-hosted platform team line in \""+name+"\"'s persona ("+path+", the line under <!-- conest:team -->). This one line is kept up to date even without \"edit persona\"; the rest of the persona is unchanged.")
}

func stepTeamLineSkipped(lang, name, path string) string {
	name = oneLine(name)
	return tr3(lang,
		"「"+name+"」的人设是自己写的（"+path+" 里没有向导的标记），没写队伍那一行，原样不动：要它知道队伍，在人设里自己写上，或在向导里勾「改这个机器人现有的人设」重新生成。",
		"「"+name+"」のペルソナは手書きです（"+path+" にウィザードの印がありません）。チームの行は書かず、そのままにしました。チームを知らせるには自分で書き足すか、ウィザードで「このボットの既存ペルソナを編集する」にチェックして作り直してください。",
		"\""+name+"\"'s persona is hand-written (no wizard marker in "+path+"), so no team line was added and it is left as is: to tell it about the team, write it in yourself, or tick \"Edit this bot's existing persona\" in the wizard to regenerate it.")
}
