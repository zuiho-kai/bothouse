package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

const maxGeneralRequestBytes = 64 << 10

func (m *ManagementServer) SetGeneralRoom(room *GeneralRoom) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.general = room
}

func (m *ManagementServer) generalRoom(w http.ResponseWriter) *GeneralRoom {
	m.mu.RLock()
	room := m.general
	m.mu.RUnlock()
	if room == nil {
		mgmtError(w, http.StatusNotFound, "General room is not configured")
	}
	return room
}

func (m *ManagementServer) handleGeneralMembers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	if room := m.generalRoom(w); room != nil {
		mgmtJSON(w, http.StatusOK, map[string]any{"members": room.Members()})
	}
}

func (m *ManagementServer) handleGeneralMessages(w http.ResponseWriter, r *http.Request) {
	room := m.generalRoom(w)
	if room == nil {
		return
	}
	switch r.Method {
	case http.MethodGet:
		mgmtJSON(w, http.StatusOK, map[string]any{"messages": room.History()})
	case http.MethodPost:
		var req struct {
			Text string `json:"text"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxGeneralRequestBytes))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil || decoder.Decode(new(any)) != io.EOF {
			mgmtError(w, http.StatusBadRequest, "expected a single JSON object with a text field")
			return
		}
		// Management authentication identifies the panel operator. The JSON body
		// only supplies message text and cannot impersonate a room member.
		message, err := room.postUserMessage("web-admin", "Web Admin", req.Text)
		if errors.Is(err, errGeneralEmptyMessage) {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err != nil {
			slog.Error("management api: post to General", "error", err)
			mgmtError(w, http.StatusInternalServerError, "could not save General message")
			return
		}
		mgmtJSON(w, http.StatusCreated, message)
	default:
		w.Header().Set("Allow", "GET, POST")
		mgmtError(w, http.StatusMethodNotAllowed, "GET or POST only")
	}
}

func (m *ManagementServer) handleGeneralEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	room := m.generalRoom(w)
	if room == nil {
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		mgmtError(w, http.StatusInternalServerError, "streaming unavailable")
		return
	}

	rawCursor := r.Header.Get("Last-Event-ID")
	if rawCursor == "" {
		rawCursor = r.URL.Query().Get("after")
	}
	cursor := 0
	if rawCursor != "" {
		parsed, err := strconv.Atoi(rawCursor)
		if err != nil || parsed < 0 {
			mgmtError(w, http.StatusBadRequest, "invalid General message cursor")
			return
		}
		cursor = parsed
	}
	messages, changed := room.messagesAfter(cursor)
	if changed == nil {
		mgmtError(w, http.StatusBadRequest, "General message cursor is past the transcript")
		return
	}

	w.Header().Set("X-Accel-Buffering", "no")
	stream := pcSSE{w: w}
	stream.start()
	controller := http.NewResponseController(w)
	if err := controller.Flush(); err != nil {
		return
	}
	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		for _, message := range messages {
			data, err := json.Marshal(message)
			if err != nil {
				slog.Error("management api: encode General event", "error", err)
				return
			}
			if _, err := fmt.Fprintf(w, "id: %s\nevent: message\ndata: %s\n\n", message.ID, data); err != nil {
				return
			}
			cursor++
		}
		if len(messages) > 0 {
			if err := controller.Flush(); err != nil {
				return
			}
		}
		select {
		case <-r.Context().Done():
			return
		case <-changed:
		case <-keepalive.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			if err := controller.Flush(); err != nil {
				return
			}
		}
		messages, changed = room.messagesAfter(cursor)
	}
}
