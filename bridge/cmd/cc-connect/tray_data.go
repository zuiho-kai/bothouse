package main

import (
	"encoding/json"
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	"net/http"
	"net/url"
	"time"
)

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
	var envelope struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode management response: %w", err)
	}
	if !envelope.OK || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return fmt.Errorf("management response has no successful data")
	}
	return json.Unmarshal(envelope.Data, out)
}

func (c trayClient) statusLabel() string {
	var status struct {
		Projects *int `json:"projects_count"`
	}
	if err := c.get("/api/v1/status", &status); err != nil || status.Projects == nil {
		return "运行状态：读取失败"
	}
	return fmt.Sprintf("运行状态：运行中（已加载 %d 个角色）", *status.Projects)
}
func (c trayClient) usageLabel(today string) string {
	var usage struct {
		Items []core.UsageAggregate `json:"items"`
	}
	if err := c.get("/api/v1/usage/daily?from="+today+"&to="+today, &usage); err != nil || usage.Items == nil {
		return "今日用量：读取失败"
	}
	return trayUsageLabel(usage.Items)
}
func trayUsageLabel(items []core.UsageAggregate) string {
	var tokens int64
	var unknown, unpriced int64
	var cost float64
	hasCost := false
	for _, r := range items {
		tokens += r.Total
		unknown += r.Unknown
		unpriced += r.Unpriced
		if r.EstimatedCost != nil {
			cost += *r.EstimatedCost
			hasCost = true
		}
	}
	label := fmt.Sprintf("今日用量：%d tokens", tokens)
	if unknown > 0 {
		label = fmt.Sprintf("今日用量：已知 %d tokens（%d 次未完整报告）", tokens, unknown)
	}
	if hasCost {
		if unpriced > 0 {
			label += fmt.Sprintf(" · 部分估算 $%.2f", cost)
		} else {
			label += fmt.Sprintf(" · 估算 $%.2f", cost)
		}
	}
	return label
}
func compact(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
