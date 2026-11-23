package core

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 功能开关 (#1861): the page lists through one func, a POST flips one switch through the other,
// reloads the running roles and answers the new list with whether a restart is needed.
func TestFeaturesEndpointListsAndFlips(t *testing.T) {
	m, _, e := testManagementServer(t, "tok")
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux())) // the real routes, not the test mux
	t.Cleanup(ts.Close)
	on := map[string]bool{"team_board": true}
	reloads := 0
	e.SetConfigReloadFunc(func() (*ConfigReloadResult, error) { reloads++; return &ConfigReloadResult{}, nil })
	m.SetFeatureFuncs(
		func() (FeatureList, error) { return FeatureList{Features: on, Lang: "zh"}, nil },
		func(project, key string, v bool) (bool, error) {
			if _, ok := on[key]; !ok {
				return false, errors.New("unknown feature switch")
			}
			on[key] = v
			return project == "", nil
		},
	)
	var got struct {
		Features map[string]bool `json:"features"`
		Lang     string          `json:"lang"`
		Restart  *bool           `json:"restart_required"`
	}
	r := mgmtGet(t, ts.URL+"/api/v1/features", "tok")
	if !r.OK || json.Unmarshal(r.Data, &got) != nil || !got.Features["team_board"] || got.Lang != "zh" || got.Restart != nil {
		t.Fatalf("list = %s (%s)", r.Data, r.Error)
	}
	r = mgmtPost(t, ts.URL+"/api/v1/features", "tok", map[string]any{"project": "p", "key": "team_board", "on": false})
	if !r.OK || json.Unmarshal(r.Data, &got) != nil || got.Features["team_board"] || got.Restart == nil || *got.Restart {
		t.Fatalf("flip = %s (%s)", r.Data, r.Error)
	}
	if reloads != 1 {
		t.Fatalf("running roles reloaded %d times after a flip, want 1", reloads)
	}
	if r = mgmtPost(t, ts.URL+"/api/v1/features", "tok", map[string]any{"key": "nope", "on": true}); r.OK {
		t.Fatal("an unknown switch was accepted")
	}
	if r = mgmtPost(t, ts.URL+"/api/v1/features", "tok", map[string]any{"key": "team_board"}); r.OK {
		t.Fatal("a flip without a value was accepted")
	}
}
