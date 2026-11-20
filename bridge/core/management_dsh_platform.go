package core

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"unicode/utf16"
)

// LocalDSHRoomOption marks a Cloud Web connection that resolves the local DSH host on demand.
const LocalDSHRoomOption = "dsh_room"

var ErrLocalDSHCloudWebConflict = errors.New("project already has a manually configured Cloud Web connection")

type localDSHRoom struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type localDSHProjectState struct {
	Rooms   []dshStateRoom `json:"rooms"`
	Members []struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Kind     string  `json:"kind"`
		External bool    `json:"external"`
		Rooms    []int64 `json:"rooms"`
	} `json:"members"`
}

func (s localDSHProjectState) chatRooms() []localDSHRoom {
	rooms := make([]localDSHRoom, 0, len(s.Rooms))
	for _, room := range s.Rooms {
		if id, err := room.ID.Int64(); err == nil && id > 0 && room.Kind == "chat" && room.DMMember == "" {
			rooms = append(rooms, localDSHRoom{ID: id, Name: room.Name})
		}
	}
	return rooms
}

// The gateway strips controls and truncates identities at 64 UTF-16 code units.
// Reject values it would change so a role keeps the same ID on both sides.
func validDSHProjectIdentity(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && !strings.HasPrefix(value, "\uFEFF") && !strings.HasSuffix(value, "\uFEFF") &&
		strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) < 0 && len(utf16.Encode([]rune(value))) <= 64
}

func (m *ManagementServer) handleDSHProjectSetup(w http.ResponseWriter, r *http.Request, project string) {
	var engine *Engine
	var selection struct {
		RoomID int64 `json:"room_id"`
	}
	if r.Method == http.MethodPost {
		if project == "" || strings.Contains(project, "/") {
			mgmtError(w, http.StatusBadRequest, "Invalid project name.")
			return
		}
		m.mu.RLock()
		engine = m.engines[project]
		m.mu.RUnlock()
		if engine == nil {
			mgmtError(w, http.StatusNotFound, "Project not found.")
			return
		}
		body := http.MaxBytesReader(w, r.Body, 1<<20)
		if err := json.NewDecoder(body).Decode(&selection); err != nil || selection.RoomID <= 0 {
			mgmtError(w, http.StatusBadRequest, "Choose a DSH channel.")
			return
		}
	}

	host, ok := FindLocalDSHHost()
	if !ok {
		mgmtError(w, http.StatusServiceUnavailable, "Open DSH with the bothouse plugin enabled, then try again.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), dshRolesTimeout)
	defer cancel()
	var state localDSHProjectState
	if err := host.channelsClient(m.dshProxyHandler().transport).get(ctx, "/collab/api/state", &state); err != nil {
		mgmtError(w, http.StatusServiceUnavailable, "Could not read channels from local DSH. Open DSH with the bothouse plugin enabled, then try again.")
		return
	}
	rooms := state.chatRooms()
	if r.Method == http.MethodGet {
		mgmtJSON(w, http.StatusOK, map[string]any{"rooms": rooms})
		return
	}
	memberName := strings.TrimSpace(engine.DisplayName())
	if !validDSHProjectIdentity(project) || project == "user" || project == "system" || !validDSHProjectIdentity(memberName) {
		mgmtError(w, http.StatusConflict, "This project's ID or display name cannot be used for a DSH member.")
		return
	}
	for _, member := range state.Members {
		if member.ID == project {
			if member.Kind != "bot" || member.External {
				mgmtError(w, http.StatusConflict, "This project's ID is already used by a different DSH member.")
				return
			}
			continue
		}
		if strings.EqualFold(member.Name, memberName) && (len(member.Rooms) == 0 || slices.Contains(member.Rooms, selection.RoomID)) {
			mgmtError(w, http.StatusConflict, "A member in this DSH channel already has this display name. Change the project display name or choose another channel.")
			return
		}
	}
	if !slices.ContainsFunc(rooms, func(room localDSHRoom) bool { return room.ID == selection.RoomID }) {
		mgmtError(w, http.StatusBadRequest, "That DSH channel is no longer available.")
		return
	}

	origin, token, err := host.BotGateway()
	if err != nil || !TestCloudWeb(ctx, origin, token, "en").OK {
		mgmtError(w, http.StatusServiceUnavailable, "Could not connect to the local DSH bot gateway with its default credential. For a custom gateway token, use Cloud Web setup.")
		return
	}
	if m.addPlatformToProject == nil {
		mgmtError(w, http.StatusServiceUnavailable, "Config persistence is unavailable.")
		return
	}
	opts := map[string]any{
		LocalDSHRoomOption:         selection.RoomID,
		"dsh_member_name":          memberName,
		"allow_from":               "owner",
		"share_session_in_channel": true,
	}
	if err := m.addPlatformToProject(project, "cloud_web", opts, "", ""); err != nil {
		if errors.Is(err, ErrLocalDSHCloudWebConflict) {
			mgmtError(w, http.StatusConflict, "This project already has a manually configured Cloud Web connection.")
		} else {
			slog.Error("local DSH: save project connection", "project", project, "error", err)
			mgmtError(w, http.StatusInternalServerError, "Could not save the local DSH connection.")
		}
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"restart_required": true})
}
