package core

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// SSHTestRequest is the body of POST /api/v1/setup/ssh/test.
type SSHTestRequest struct {
	RemoteHost string   `json:"remote_host"`
	RelayHost  string   `json:"relay_host,omitempty"`
	SSHArgs    []string `json:"ssh_args,omitempty"`
	WorkDir    string   `json:"work_dir,omitempty"`
	AgentType  string   `json:"agent_type,omitempty"`
}

// SSHTestResult reports SSH connectivity, remote ducc/zulu auto-discovery, and optional remote work_dir check.
type SSHTestResult struct {
	OK          bool   `json:"ok"`
	SSHOK       bool   `json:"ssh_ok"`
	ZuluPath    string `json:"zulu_path,omitempty"`
	ZuluVersion string `json:"zulu_version,omitempty"`
	DuccPath    string `json:"ducc_path,omitempty"`
	DuccVersion string `json:"ducc_version,omitempty"`
	WorkDirOK   *bool  `json:"work_dir_ok,omitempty"`
	Error       string `json:"error,omitempty"`
}

// SSHDiscoveryResult holds detected SSH targets, relay hosts, and recent iDev remote workspaces.
type SSHDiscoveryResult struct {
	Hosts            []string            `json:"hosts"`
	Relays           []string            `json:"relays"`
	RecentWorkspaces map[string][]string `json:"recent_workspaces"`
}

// DiscoverSSHHosts scans ~/.ssh/config Host aliases and active ~/.ssh/master-* sockets
// (kept for compatibility with tests; DiscoverSSHInfo returns full host/relay/workspace details).
func DiscoverSSHHosts() []string {
	return DiscoverSSHInfo().Hosts
}

// DiscoverSSHInfo discovers SSH hosts, relay hosts, and iDev Remote recent dev machines & directories.
func DiscoverSSHInfo() SSHDiscoveryResult {
	res := SSHDiscoveryResult{
		Hosts:            []string{},
		Relays:           []string{},
		RecentWorkspaces: map[string][]string{},
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return res
	}
	seenHost := map[string]bool{}
	seenRelay := map[string]bool{}
	addHost := func(h string) {
		h = strings.TrimSpace(h)
		if h == "" || strings.ContainsAny(h, "*?!") || seenHost[h] {
			return
		}
		seenHost[h] = true
		res.Hosts = append(res.Hosts, h)
	}
	addRelay := func(h string) {
		h = strings.TrimSpace(h)
		if h == "" || strings.ContainsAny(h, "*?!") || seenRelay[h] {
			return
		}
		seenRelay[h] = true
		res.Relays = append(res.Relays, h)
	}

	// 1. iDev Remote history (~/Library/Application Support/iDev/User/globalStorage/state.vscdb)
	vscdb := filepath.Join(home, "Library", "Application Support", "iDev", "User", "globalStorage", "state.vscdb")
	if _, statErr := os.Stat(vscdb); statErr == nil {
		if db, err := sql.Open("sqlite", "file:"+vscdb+"?mode=ro&_pragma=busy_timeout(1000)"); err == nil {
			var raw string
			if err := db.QueryRow(`SELECT value FROM ItemTable WHERE key = 'BaiduComate.internal-remote-development'`).Scan(&raw); err == nil && raw != "" {
				var state struct {
					History []struct {
						Key      string `json:"key"`
						User     string `json:"user"`
						Hostname string `json:"hostname"`
					} `json:"baiducomate.internal-remote-development.vmConnectionHistory"`
					Locations map[string][]string `json:"remoteLocationHistory_v0"`
				}
				if json.Unmarshal([]byte(raw), &state) == nil {
					for _, h := range state.History {
						target := strings.TrimSpace(h.Key)
						if target == "" && h.Hostname != "" {
							if h.User != "" {
								target = h.User + "@" + h.Hostname
							} else {
								target = h.Hostname
							}
						}
						addHost(target)
					}
					for host, dirs := range state.Locations {
						addHost(host)
						for _, d := range dirs {
							d = strings.TrimSpace(d)
							if d != "" {
								res.RecentWorkspaces[host] = append(res.RecentWorkspaces[host], d)
							}
						}
					}
				}
			}
			_ = db.Close()
		}
	}

	// 2. ~/.ssh/config Host aliases
	if f, err := os.Open(filepath.Join(home, ".ssh", "config")); err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) >= 2 && strings.EqualFold(fields[0], "Host") {
				for _, h := range fields[1:] {
					if strings.Contains(strings.ToLower(h), "relay") {
						addRelay(h)
					}
					addHost(h)
				}
			}
		}
	}

	// 3. Active ~/.ssh/master-* ControlMaster sockets
	if entries, err := os.ReadDir(filepath.Join(home, ".ssh")); err == nil {
		for _, e := range entries {
			name := e.Name()
			if !strings.HasPrefix(name, "master-") {
				continue
			}
			rest := strings.TrimPrefix(name, "master-")
			if idx := strings.LastIndex(rest, ":"); idx > 0 {
				rest = rest[:idx]
			}
			if strings.Contains(strings.ToLower(rest), "relay") {
				addRelay(rest)
			}
			addHost(rest)
		}
	}

	sort.Strings(res.Hosts)
	sort.Strings(res.Relays)
	return res
}

func sshShellQuote(s string) string {
	return ShellQuote(s)
}

// TestSSHRemote checks SSH connectivity to remoteHost (directly or via relayHost),
// locates remote zulu (with bundled node PATH support), and optionally verifies workDir.
func TestSSHRemote(ctx context.Context, req SSHTestRequest) SSHTestResult {
	host := strings.TrimSpace(req.RemoteHost)
	if host == "" {
		return SSHTestResult{Error: "remote_host is required"}
	}
	relayHost := strings.TrimSpace(req.RelayHost)
	workDir := strings.TrimSpace(req.WorkDir)

	var sb strings.Builder
	sb.WriteString("echo '__SSH_OK__=1'\n")
	sb.WriteString("for d in \"$HOME\"/.comate-server/bin/*; do if [ -x \"$d/node\" ]; then export PATH=\"$d:$PATH\"; break; fi; done\n")
	sb.WriteString("Z=\"\"\n")
	sb.WriteString("if command -v zulu >/dev/null 2>&1; then Z=\"$(command -v zulu)\"; fi\n")
	sb.WriteString("if [ -z \"$Z\" ]; then for p in \"$HOME\"/.comate-server/bin/*/extensions/baiducomate.comate/dist/zulu-cli/bin/zulu \"$HOME\"/.comate/zulu-cli/bin/zulu; do if [ -x \"$p\" ]; then Z=\"$p\"; break; fi; done; fi\n")
	sb.WriteString("echo \"__ZULU_PATH__=$Z\"\n")
	sb.WriteString("if [ -n \"$Z\" ]; then V=\"$(\"$Z\" --version 2>/dev/null | head -n 1)\"; echo \"__ZULU_VER__=$V\"; fi\n")
	sb.WriteString(resolveRemoteDucc)
	sb.WriteString("echo \"__DUCC_PATH__=$D\"\n")
	sb.WriteString("if [ -n \"$D\" ]; then DV=\"$(\"$D\" --version 2>/dev/null | head -n 1)\"; echo \"__DUCC_VER__=$DV\"; fi\n")
	if workDir != "" {
		sb.WriteString("if [ -d " + quoteRemotePath(workDir) + " ]; then echo '__WORKDIR_OK__=1'; else echo '__WORKDIR_OK__=0'; fi\n")
	}

	tctx, cancel := context.WithTimeout(ctx, 18*time.Second)
	defer cancel()

	stdout, stderr, err := RunRemoteScript(tctx, SSHExecConfig{
		RemoteHost: host,
		RelayHost:  relayHost,
		SSHArgs:    req.SSHArgs,
	}, sb.String())

	res := SSHTestResult{}
	for _, line := range strings.Split(string(stdout), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "__SSH_OK__=1":
			res.SSHOK = true
		case strings.HasPrefix(line, "__ZULU_PATH__="):
			res.ZuluPath = strings.TrimPrefix(line, "__ZULU_PATH__=")
		case strings.HasPrefix(line, "__ZULU_VER__="):
			res.ZuluVersion = strings.TrimPrefix(line, "__ZULU_VER__=")
		case strings.HasPrefix(line, "__DUCC_PATH__="):
			res.DuccPath = strings.TrimPrefix(line, "__DUCC_PATH__=")
		case strings.HasPrefix(line, "__DUCC_VER__="):
			res.DuccVersion = strings.TrimPrefix(line, "__DUCC_VER__=")
		case strings.HasPrefix(line, "__WORKDIR_OK__="):
			v := strings.TrimPrefix(line, "__WORKDIR_OK__=") == "1"
			res.WorkDirOK = &v
		}
	}

	if err != nil && !res.SSHOK {
		errMsg := strings.TrimSpace(string(stderr))
		if errMsg == "" {
			errMsg = err.Error()
		}
		res.Error = errMsg
		return res
	}
	if !res.SSHOK {
		res.Error = "SSH connection did not return expected probe output"
		return res
	}
	at := strings.TrimSpace(req.AgentType)
	switch at {
	case "claudecode":
		if res.DuccPath == "" {
			res.Error = "SSH connected, but neither ducc nor claude was found on the remote host"
			return res
		}
	case "zulu":
		if res.ZuluPath == "" {
			res.Error = "SSH connected, but zulu was not found in remote PATH, ~/.comate-server, or ~/.comate/zulu-cli (connect once via iDev Remote first)"
			return res
		}
	default:
		if res.ZuluPath == "" && res.DuccPath == "" {
			res.Error = "SSH connected, but neither ducc nor zulu was found on remote host"
			return res
		}
	}
	if res.WorkDirOK != nil && !*res.WorkDirOK {
		res.Error = "SSH & remote CLI OK, but remote work_dir does not exist: " + workDir
		return res
	}
	res.OK = true
	return res
}

func (m *ManagementServer) handleSetupSSHHosts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	mgmtJSON(w, http.StatusOK, DiscoverSSHInfo())
}

func (m *ManagementServer) handleSetupSSHTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req SSHTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	res := TestSSHRemote(r.Context(), req)
	mgmtJSON(w, http.StatusOK, res)
}
