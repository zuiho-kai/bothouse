package core

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// 记忆论坛页 (#1143)：管理页「记忆论坛」读本机 gate 的 GET /forum（contrib/gate/forum_page.py），
// 推送、票、排序都在 gate 那边算，这里只转一道，登录走管理页已有的鉴权（m.wrap）。
// gate 没在跑时回 running=false，页面照实说「记忆论坛没在跑」，不报错。

// forumGateTimeout：gate 读几百条记录、几十页 wiki，本机实测不到 1s；10s 沿用 gate_proc.go gateStopWait 的两倍兜底。
var forumGateTimeout = 10 * time.Second

type forumResp struct {
	Running bool            `json:"running"`
	Forum   json.RawMessage `json:"forum,omitempty"`
	Error   string          `json:"error,omitempty"`
}

func (m *ManagementServer) handleForum(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	if !GateRunning() {
		mgmtJSON(w, http.StatusOK, forumResp{})
		return
	}
	c := &http.Client{Timeout: forumGateTimeout}
	resp, err := c.Get("http://" + localGateAddr() + "/forum")
	if err != nil {
		mgmtJSON(w, http.StatusOK, forumResp{Running: true, Error: err.Error()})
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK || !json.Valid(body) {
		msg := resp.Status
		if err != nil {
			msg = err.Error()
		}
		// 旧版 gate 没有 /forum（404）：装新版 bothouse 后 gate 脚本随启动覆盖，重启一次 gate 就有
		mgmtJSON(w, http.StatusOK, forumResp{Running: true, Error: msg})
		return
	}
	mgmtJSON(w, http.StatusOK, forumResp{Running: true, Forum: body})
}
