package core

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var arcadeAccountNumber = regexp.MustCompile("^[A-Za-z0-9_]{4,24}$")
var arcadeAccountIdentity = regexp.MustCompile("^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
var errFriendMissing = errors.New("friend not found")

type friendRecipient struct {
	Number      string `json:"number"`
	DisplayName string `json:"displayName"`
	Identity    string `json:"identity"`
}

// The credential is dedicated to the local Friends lookup and never reaches the page.
func lookupFriendRecipient(ctx context.Context, number string) (friendRecipient, error) {
	var result friendRecipient
	token := os.Getenv("SOCIAL_BOTHOUSE_FRIEND_LOOKUP_TOKEN")
	port := os.Getenv("BOTHOUSE_FRIENDS_LOOKUP_PORT")
	if port == "" {
		port = "57883"
	}
	parsed, err := strconv.ParseUint(port, 10, 16)
	if err != nil || parsed < 1024 || len(token) < 32 {
		return result, errors.New("friend lookup not configured")
	}
	url := "http://127.0.0.1:" + strconv.FormatUint(parsed, 10) + "/api/v1/bothouse-share-recipient?number=" + number
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return result, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
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
	err = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&result)
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
			recipient, err := lookupFriendRecipient(r.Context(), number)
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
