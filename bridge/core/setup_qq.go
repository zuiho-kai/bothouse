package core

// QQ as a wizard platform (#812): the bot is a QQ account logged in to NapCat (or any OneBot 11
// implementation) with a forward WebSocket; the wizard connects the same way platform/qq does
// (Authorization: Bearer <token>) and asks get_login_info for the account, before writing anything.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// QQDefaultWSURL is NapCat's default forward WebSocket (same default as platform/qq).
const QQDefaultWSURL = "ws://127.0.0.1:3001"

// WizardQQ is the request's QQ section.
type WizardQQ struct {
	WSURL     string `json:"ws_url,omitempty"`     // default QQDefaultWSURL
	Token     string `json:"token,omitempty"`      // NapCat access token, if set there
	HTTPURL   string `json:"http_url,omitempty"`   // optional OneBot HTTP API (file sending)
	AllowFrom string `json:"allow_from,omitempty"` // QQ numbers that may give orders; "*" = anyone
}

// QQTestResult is the connection test: code ok | unreachable | unauthorized | error.
type QQTestResult struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Fix      string `json:"fix,omitempty"`
	UserID   string `json:"user_id,omitempty"` // the logged-in QQ number
	Nickname string `json:"nickname,omitempty"`
}

// qqTestTimeout bounds the whole test. 来源：沿用 platform/qq callAPI 等回包的 15 秒上限。
const qqTestTimeout = 15 * time.Second

// TestQQ connects to the OneBot forward WebSocket and reads the logged-in account.
func TestQQ(ctx context.Context, wsURL, token, lang string) QQTestResult {
	ctx, cancel := context.WithTimeout(ctx, qqTestTimeout)
	defer cancel()
	header := http.Header{}
	if token != "" {
		header.Set("Authorization", "Bearer "+token)
	}
	conn, resp, err := websocket.DefaultDialer.DialContext(ctx, wsURL, header)
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			return QQTestResult{Code: "unauthorized",
				Message: tr3(lang, "NapCat 拒绝了连接：token 不对", "NapCat が接続を拒否しました：token が違います", "NapCat refused the connection: wrong token"),
				Fix:     tr3(lang, "填 NapCat 网络配置里 WebSocket 服务器的 token", "NapCat のネットワーク設定にある WebSocket サーバーの token を入力してください", "use the token of the WebSocket server in NapCat's network settings")}
		}
		return QQTestResult{Code: "unreachable",
			Message: tr3(lang, fmt.Sprintf("连不上 %s", wsURL), fmt.Sprintf("%s に接続できません", wsURL), fmt.Sprintf("cannot connect to %s", wsURL)),
			Fix: tr3(lang, "先启动 NapCat 并登录 QQ，在 NapCat 网络配置里开一个 WebSocket 服务器（默认端口 3001），地址填这里",
				"NapCat を起動して QQ にログインし、ネットワーク設定で WebSocket サーバー（既定ポート 3001）を有効にしてください",
				"start NapCat, log in to QQ, and add a WebSocket server in NapCat's network settings (default port 3001)")}
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetReadDeadline(dl)
	}
	if err := conn.WriteJSON(map[string]any{"action": "get_login_info", "echo": "bothouse-setup"}); err != nil {
		return qqTestError(lang, err)
	}
	for { // NapCat sends lifecycle/heartbeat events first; the answer carries our echo
		var msg struct {
			Echo    any             `json:"echo"`
			RetCode int             `json:"retcode"`
			Data    json.RawMessage `json:"data"`
		}
		if err := conn.ReadJSON(&msg); err != nil {
			return qqTestError(lang, err)
		}
		if fmt.Sprint(msg.Echo) != "bothouse-setup" {
			continue
		}
		if msg.RetCode != 0 {
			return qqTestError(lang, fmt.Errorf("get_login_info retcode=%d", msg.RetCode))
		}
		var info struct {
			UserID   json.Number `json:"user_id"`
			Nickname string      `json:"nickname"`
		}
		if err := json.Unmarshal(msg.Data, &info); err != nil || info.UserID == "" || info.UserID == "0" {
			return qqTestError(lang, errors.New("get_login_info: no QQ account (is QQ logged in in NapCat?)"))
		}
		return QQTestResult{Code: "ok", UserID: info.UserID.String(), Nickname: info.Nickname,
			Message: tr3(lang, fmt.Sprintf("已连上 NapCat，QQ %s（%s）", info.UserID, info.Nickname),
				fmt.Sprintf("NapCat に接続しました：QQ %s（%s）", info.UserID, info.Nickname),
				fmt.Sprintf("connected to NapCat: QQ %s (%s)", info.UserID, info.Nickname))}
	}
}

func qqTestError(lang string, err error) QQTestResult {
	return QQTestResult{Code: "error",
		Message: tr3(lang, "NapCat 连上了但没答出登录的 QQ："+err.Error(), "NapCat には接続しましたがログイン中の QQ を取得できません："+err.Error(),
			"connected to NapCat but it did not return the logged-in QQ: "+err.Error()),
		Fix: tr3(lang, "在 NapCat 里确认 QQ 已登录", "NapCat で QQ がログインしているか確認してください", "check that QQ is logged in in NapCat")}
}

// sameQQAccount: the project (not in used) that already has a qq platform on this address
// (one NapCat WebSocket = one logged-in QQ account).
func sameQQAccount(s WizardSnapshot, wsURL string, used map[string]bool) string {
	for _, p := range s.Projects {
		o, ok := p.Platforms["qq"]
		if !ok || used[p.Name] {
			continue
		}
		u, _ := o["ws_url"].(string)
		if u == "" {
			u = QQDefaultWSURL
		}
		if strings.TrimRight(u, "/") == strings.TrimRight(wsURL, "/") {
			return p.Name
		}
	}
	return ""
}

// qqAllowFrom cleans the allow_from list: QQ numbers only, or "*".
func qqAllowFrom(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "*" {
		return v, nil
	}
	var out []string
	for _, s := range csvSet(v) {
		if _, err := strconv.ParseUint(s, 10, 64); err != nil {
			return "", fmt.Errorf("allow_from: %q is not a QQ number", s)
		}
		out = append(out, s)
	}
	return strings.Join(out, ","), nil
}
