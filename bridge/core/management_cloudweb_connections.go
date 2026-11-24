package core

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

type cloudWebConnectionInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

type cloudWebConnection struct {
	cloudWebConnectionInfo
	Token string `json:"token"`
}

var errCloudWebConnectionMissing = errors.New("saved Cloud Web connection not found")

// validateSavedCloudWebOverrides keeps profile credentials and transport under server control.
func validateSavedCloudWebOverrides(options map[string]any) error {
	for key, value := range options {
		switch key {
		case "ws_url", "allow_from":
			text, ok := value.(string)
			if !ok {
				return fmt.Errorf("Cloud Web option %q must be text", key)
			}
			text = strings.TrimSpace(text)
			if text == "" {
				delete(options, key)
				continue
			}
			if key == "ws_url" {
				u, err := url.Parse(text)
				if err != nil || u.Hostname() == "" || (u.Scheme != "ws" && u.Scheme != "wss") {
					return errors.New("WebSocket URL must use ws:// or wss://")
				}
			}
			options[key] = text
		case "share_session_in_channel", "group_reply_all":
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("Cloud Web option %q must be true or false", key)
			}
		default:
			return fmt.Errorf("option %q cannot be set when using a saved Cloud Web connection", key)
		}
	}
	return nil
}

func (m *ManagementServer) readCloudWebConnections() ([]cloudWebConnection, error) {
	if m.wizardDataDir == "" {
		return nil, errors.New("data directory is unavailable")
	}
	data, err := os.ReadFile(filepath.Join(m.wizardDataDir, "cloud-web-connections.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read saved Cloud Web connections: %w", err)
	}
	var connections []cloudWebConnection
	if err := json.Unmarshal(data, &connections); err != nil {
		return nil, fmt.Errorf("decode saved Cloud Web connections: %w", err)
	}
	return connections, nil
}

func (m *ManagementServer) handleCloudWebConnections(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	switch {
	case id == "" && r.Method == http.MethodGet:
		connections, err := m.readCloudWebConnections()
		if err != nil {
			writeCloudWebConnectionError(w, err)
			return
		}
		items := make([]cloudWebConnectionInfo, 0, len(connections))
		for _, c := range connections {
			items = append(items, c.cloudWebConnectionInfo)
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"connections": items})
	case id == "" && r.Method == http.MethodPost, id != "" && r.Method == http.MethodPut,
		id != "" && r.Method == http.MethodDelete:
		m.changeCloudWebConnection(w, r, id)
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (m *ManagementServer) changeCloudWebConnection(w http.ResponseWriter, r *http.Request, id string) {
	removing := r.Method == http.MethodDelete
	var input cloudWebConnection
	if !removing {
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		input.Name = strings.TrimSpace(input.Name)
		input.URL = strings.TrimSpace(input.URL)
		input.Token = strings.TrimSpace(input.Token)
		if input.Name == "" || (id == "" && input.Token == "") {
			mgmtError(w, http.StatusBadRequest, "a connection name and bot token are required")
			return
		}
		u, err := url.Parse(input.URL)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
			(u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ws" && u.Scheme != "wss") {
			mgmtError(w, http.StatusBadRequest, "enter an HTTP or WebSocket server URL without credentials, a query, or a fragment")
			return
		}
	}

	m.cloudWebConnectionsMu.Lock()
	defer m.cloudWebConnectionsMu.Unlock()
	connections, err := m.readCloudWebConnections()
	if err != nil {
		writeCloudWebConnectionError(w, err)
		return
	}
	index := slices.IndexFunc(connections, func(c cloudWebConnection) bool { return c.ID == id })
	if id != "" && index < 0 {
		writeCloudWebConnectionError(w, errCloudWebConnectionMissing)
		return
	}
	if !removing && slices.ContainsFunc(connections, func(c cloudWebConnection) bool {
		return c.ID != id && strings.EqualFold(c.Name, input.Name)
	}) {
		mgmtError(w, http.StatusConflict, "a saved Cloud Web connection already uses this name")
		return
	}
	status := http.StatusOK
	switch {
	case removing:
		connections = slices.Delete(connections, index, index+1)
	case id == "":
		input.ID = rand.Text()
		connections = append(connections, input)
		status = http.StatusCreated
	default:
		input.ID = id
		if input.Token == "" {
			input.Token = connections[index].Token
		}
		connections[index] = input
	}
	data, err := json.Marshal(connections)
	if err == nil {
		err = os.MkdirAll(m.wizardDataDir, 0700)
	}
	if err == nil {
		err = AtomicWriteFile(filepath.Join(m.wizardDataDir, "cloud-web-connections.json"), data, 0600)
	}
	if err != nil {
		writeCloudWebConnectionError(w, fmt.Errorf("save Cloud Web connections: %w", err))
		return
	}
	if removing {
		mgmtJSON(w, status, map[string]string{"id": id})
		return
	}
	mgmtJSON(w, status, input.cloudWebConnectionInfo)
}

func (m *ManagementServer) savedCloudWebOptions(id, project string) (map[string]any, error) {
	connections, err := m.readCloudWebConnections()
	if err != nil {
		return nil, err
	}
	for _, c := range connections {
		if c.ID != id {
			continue
		}
		base, err := cloudWebWSBase(c.URL)
		if err != nil {
			return nil, fmt.Errorf("invalid saved Cloud Web URL for connection %s", id)
		}
		return map[string]any{
			"connection_id": id,
			"transport":     "websocket",
			"ws_url":        cloudWebBotURL(base, project, "", "", ""),
			"token":         c.Token,
		}, nil
	}
	return nil, errCloudWebConnectionMissing
}

func writeCloudWebConnectionError(w http.ResponseWriter, err error) {
	if errors.Is(err, errCloudWebConnectionMissing) {
		mgmtError(w, http.StatusNotFound, err.Error())
		return
	}
	slog.Error("saved Cloud Web connections", "error", err)
	mgmtError(w, http.StatusInternalServerError, "could not access saved Cloud Web connections")
}
