//go:build darwin || windows

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/getlantern/systray"
)

var (
	trayDone                                     = make(chan struct{})
	trayStatus, trayRoles, trayUsage, trayUpdate *systray.MenuItem
	trayOpen, trayAdd, trayQuit                  *systray.MenuItem
)

func runDesktopTray() {
	trayMode = true
	go func() { defer close(trayDone); runMain() }()
	systray.Run(onTrayReady, func() {})
	<-trayDone
}
func quitDesktopTray() { systray.Quit() }

func onTrayReady() {
	systray.SetTitle("")
	systray.SetTooltip("bothouse 管理面板")
	systray.SetTemplateIcon(trayIcon, trayIcon)
	trayStatus = systray.AddMenuItem("运行状态：检查中…", "bothouse 运行状态")
	trayRoles = systray.AddMenuItem("角色：检查中…", "已登记角色与配置的平台")
	trayUsage = systray.AddMenuItem("今日用量：检查中…", "今日 token 和估算开销")
	trayUpdate = systray.AddMenuItem("升级：检查中…", "升级状态")
	trayOpen = systray.AddMenuItem("打开管理面板", "在浏览器中打开本机管理面板")
	trayAdd = systray.AddMenuItem("添加角色/模型", "打开添加角色向导")
	trayQuit = systray.AddMenuItem("退出 bothouse", "停止桥和托盘")
	cfg, err := config.LoadPermissive(trayConfigPath(os.Args[1:]))
	if err != nil {
		trayStatus.SetTitle("运行状态：配置读取失败")
		return
	}
	port := cfg.Management.Port
	if port <= 0 {
		port = 9820
	}
	host := cfg.Management.Host
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	client := trayClient{base: fmt.Sprintf("http://%s:%d", host, port), token: cfg.Management.Token}
	if cfg.Management.Enabled != nil && *cfg.Management.Enabled {
		go refreshTray(client)
	} else {
		trayStatus.SetTitle("运行状态：管理面板未启用")
		trayRoles.SetTitle("角色：—")
		trayUsage.SetTitle("今日用量：—")
		trayUpdate.SetTitle("升级：—")
	}
	go func() {
		for {
			select {
			case <-trayOpen.ClickedCh:
				_ = openBrowser(client.loginURL("/"))
			case <-trayAdd.ClickedCh:
				_ = openBrowser(client.loginURL("/setup?add=1"))
			case <-trayUpdate.ClickedCh:
				req, _ := http.NewRequest(http.MethodPost, client.base+"/api/v1/update/apply", nil)
				req.Header.Set("Authorization", "Bearer "+client.token)
				res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
				if err == nil {
					res.Body.Close()
					trayUpdate.SetTitle("升级：已请求")
				} else {
					trayUpdate.SetTitle("升级：请求失败")
				}
			case <-trayQuit.ClickedCh:
				requestDesktopShutdown()
				return
			}
		}
	}()
}

func trayConfigPath(args []string) string {
	for i, arg := range args {
		if arg == "--config" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(arg, "--config=") {
			return strings.TrimPrefix(arg, "--config=")
		}
	}
	return resolveConfigPath("")
}

type trayClient struct{ base, token string }

func (c trayClient) loginURL(path string) string {
	return c.base + "/login?token=" + url.QueryEscape(c.token) + "&next=" + url.QueryEscape(path)
}
func (c trayClient) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := (&http.Client{Timeout: 4 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}
func refreshTray(c trayClient) {
	tick := time.NewTicker(45 * time.Second)
	defer tick.Stop()
	for {
		var status struct {
			Projects int `json:"projects_count"`
		}
		if err := c.get("/api/v1/status", &status); err != nil {
			trayStatus.SetTitle("运行状态：未连接")
		} else {
			trayStatus.SetTitle(fmt.Sprintf("运行状态：运行中（%d 个角色）", status.Projects))
		}
		var projects struct {
			Projects []struct {
				Name      string   `json:"name"`
				Platforms []string `json:"platforms"`
			} `json:"projects"`
		}
		rolesKnown := false
		var roleStatus struct {
			Roles []struct {
				Name   string `json:"name"`
				Online bool   `json:"online"`
			} `json:"roles"`
		}
		if c.get("/api/v1/roles", &roleStatus) == nil {
			labels := make([]string, 0, len(roleStatus.Roles))
			for _, r := range roleStatus.Roles {
				state := "离线"
				if r.Online {
					state = "在线"
				}
				labels = append(labels, r.Name+" "+state)
			}
			trayRoles.SetTitle(compact("角色："+strings.Join(labels, "、"), 55))
			rolesKnown = true
		}
		if !rolesKnown {
			if c.get("/api/v1/projects", &projects) == nil && len(projects.Projects) > 0 {
				labels := make([]string, 0, len(projects.Projects))
				for _, r := range projects.Projects {
					labels = append(labels, r.Name+" 未知 ["+strings.Join(r.Platforms, ",")+"]")
				}
				trayRoles.SetTitle(compact("角色："+strings.Join(labels, "、"), 55))
			} else {
				trayRoles.SetTitle("角色：未知（等待 #207）")
			}
		}
		var usage struct {
			Items []struct {
				Total int64    `json:"total_tokens"`
				Cost  *float64 `json:"estimated_cost"`
			} `json:"items"`
		}
		today := time.Now().Format("2006-01-02")
		if c.get("/api/v1/usage/daily?from="+today+"&to="+today, &usage) != nil {
			trayUsage.SetTitle("今日用量：等待 #208")
		} else {
			var tokens int64
			cost := 0.0
			hasCost := false
			for _, r := range usage.Items {
				tokens += r.Total
				if r.Cost != nil {
					cost += *r.Cost
					hasCost = true
				}
			}
			label := fmt.Sprintf("今日用量：%d tokens", tokens)
			if hasCost {
				label += fmt.Sprintf(" · $%.2f", cost)
			}
			trayUsage.SetTitle(compact(label, 55))
		}
		var update struct {
			HasUpdate bool   `json:"has_update"`
			Latest    string `json:"latest"`
		}
		if c.get("/api/v1/update", &update) == nil && update.HasUpdate {
			trayUpdate.SetTitle("升级到 " + update.Latest)
			trayUpdate.Enable()
		} else {
			trayUpdate.SetTitle("升级：已是最新")
			trayUpdate.Disable()
		}
		<-tick.C
	}
}
func compact(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
