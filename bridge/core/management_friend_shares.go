package core

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var arcadeAccountNumber = regexp.MustCompile("^[A-Za-z0-9_]{4,24}$")
var friendLookupKey = regexp.MustCompile("^[a-f0-9]{64}$")
var arcadeAccountIdentity = regexp.MustCompile("^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
var errFriendMissing = errors.New("friend not found")

type friendRecipient struct {
	Number      string `json:"number"`
	DisplayName string `json:"displayName"`
	Identity    string `json:"identity"`
}

// The Friends service prepares this alongside the active instance's private config.
func lookupFriendRecipient(ctx context.Context, configFile, number string) (friendRecipient, error) {
	var result friendRecipient
	if configFile == "" {
		return result, errors.New("friend lookup not configured")
	}
	file := filepath.Join(filepath.Dir(configFile), ".agent-arcade-friend-lookup.json")
	info, err := os.Lstat(file)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 512 ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return result, errors.New("friend lookup not configured")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return result, err
	}
	var settings struct {
		Host  string `json:"host"`
		Port  uint16 `json:"port"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(data, &settings); err != nil || (settings.Host != "127.0.0.1" && settings.Host != "::1") ||
		settings.Port < 1024 || !friendLookupKey.MatchString(settings.Token) {
		return result, errors.New("invalid friend lookup configuration")
	}
	address := net.JoinHostPort(settings.Host, strconv.FormatUint(uint64(settings.Port), 10))
	url := fmt.Sprintf("http://%s/api/v1/bothouse-share-recipient?number=%s", address, number)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return result, err
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return result, err
	}
	nonce := hex.EncodeToString(nonceBytes)
	challenge := number + "\n" + timestamp + "\n" + nonce
	mac := hmac.New(sha256.New, []byte(settings.Token))
	mac.Write([]byte("lookup\n" + challenge))
	req.Header.Set("X-Friends-Lookup-Time", timestamp)
	req.Header.Set("X-Friends-Lookup-Nonce", nonce)
	req.Header.Set("X-Friends-Lookup-Proof", hex.EncodeToString(mac.Sum(nil)))
	client := http.Client{Transport: &http.Transport{DisableKeepAlives: true}, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return result, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return result, errFriendMissing
	}
	if res.StatusCode != http.StatusOK {
		return result, errors.New("friend lookup unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 4097))
	if err != nil || len(body) > 4096 {
		return result, errors.New("invalid friend lookup response")
	}
	mac.Reset()
	mac.Write([]byte("result\n" + challenge + "\n"))
	mac.Write(body)
	proof, err := hex.DecodeString(res.Header.Get("X-Friends-Lookup-Proof"))
	if err != nil || !hmac.Equal(proof, mac.Sum(nil)) {
		return result, errors.New("unverified friend lookup response")
	}
	err = json.Unmarshal(body, &result)
	if err != nil || result.Number != number || result.DisplayName == "" || !arcadeAccountIdentity.MatchString(result.Identity) {
		return friendRecipient{}, errors.New("invalid friend lookup response")
	}
	return result, nil
}

func (m *ManagementServer) SetFriendShares(f func(string, string, string) ([]string, error)) {
	m.friendShares = f
}

func (m *ManagementServer) handleFriendShares(w http.ResponseWriter, r *http.Request, project, number string) {
	if m.token == "" {
		mgmtError(w, http.StatusForbidden, "project sharing requires management authentication")
		return
	}
	if m.friendShares == nil {
		mgmtError(w, http.StatusServiceUnavailable, "project sharing unavailable")
		return
	}
	number = strings.ToLower(number)
	if (number != "" || r.Method != http.MethodGet) && !arcadeAccountNumber.MatchString(number) {
		mgmtError(w, http.StatusBadRequest, "invalid Agent Arcade account number")
		return
	}
	var identity string
	switch r.Method {
	case http.MethodGet, http.MethodPut:
		if number != "" {
			recipient, err := lookupFriendRecipient(r.Context(), m.configFilePath, number)
			if errors.Is(err, errFriendMissing) {
				mgmtError(w, http.StatusNotFound, "friend not found")
				return
			}
			if err != nil {
				mgmtError(w, http.StatusServiceUnavailable, "friend lookup unavailable")
				return
			}
			if r.Method == http.MethodGet {
				mgmtJSON(w, http.StatusOK, recipient)
				return
			}
			var confirmed struct {
				Identity string `json:"identity"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&confirmed); err != nil || confirmed.Identity != recipient.Identity {
				mgmtError(w, http.StatusConflict, "friend changed; confirm recipient again")
				return
			}
			identity = recipient.Identity
		}
	case http.MethodDelete:
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET, PUT or DELETE only")
		return
	}
	recipients, err := m.friendShares(project, number, identity)
	if errors.Is(err, ErrProjectNotFound) {
		mgmtError(w, http.StatusNotFound, "unknown project")
		return
	}
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "could not read or save project recipients")
		return
	}
	numbers := make([]string, 0, len(recipients))
	for _, entry := range recipients {
		n, _, _ := strings.Cut(entry, ":")
		numbers = append(numbers, n)
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"numbers": numbers})
}
