package core

import (
	"encoding/json"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// LocalDSHHost is the current owner of the local Channels data directory.
type LocalDSHHost struct {
	target     string
	ownerToken string
}

// FindLocalDSHHost reads the private owner record published by the Channels plugin.
// DSH Desktop may change ports when it starts, so callers resolve the host when needed.
func FindLocalDSHHost() (LocalDSHHost, bool) {
	b, err := os.ReadFile(filepath.Join(collabDataDir(), "collab.owner.json"))
	if err != nil {
		return LocalDSHHost{}, false
	}
	var owner struct {
		PID   int `json:"pid"`
		Local struct {
			Origin string `json:"origin"`
			Token  string `json:"token"`
		} `json:"local"`
	}
	if json.Unmarshal(b, &owner) != nil || owner.PID <= 0 || !processAlive(owner.PID) {
		return LocalDSHHost{}, false
	}
	u, err := url.Parse(owner.Local.Origin)
	if err != nil || u.Scheme != "http" || u.User != nil || u.Opaque != "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return LocalDSHHost{}, false
	}
	ip := net.ParseIP(u.Hostname())
	port, err := strconv.Atoi(u.Port())
	if ip == nil || !ip.IsLoopback() || err != nil || port < 1 || port > 65535 ||
		owner.Local.Token == "" || strings.ContainsAny(owner.Local.Token, "\r\n") {
		return LocalDSHHost{}, false
	}
	return LocalDSHHost{target: u.Host, ownerToken: owner.Local.Token}, true
}
