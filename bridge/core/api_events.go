package core

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"
)

// handleEvents: POST appends one event a local script reports; GET returns
// the last ?n= events (default 50, max 1000).
func (s *APIServer) handleEvents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var ev StreamEvent
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if ev.Source == "" {
			ev.Source = "external"
		}
		ev.Time = time.Now()
		if err := AppendStreamEvent(s.dataDir, ev); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		apiJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	case http.MethodGet:
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		if n <= 0 {
			n = 50
		}
		if n > 1000 {
			n = 1000
		}
		evs, err := TailStreamEvents(s.dataDir, n)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		apiJSON(w, http.StatusOK, evs)
	default:
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
	}
}

// TailStreamEvents returns the last n parsed events of events.jsonl.
func TailStreamEvents(dataDir string, n int) ([]StreamEvent, error) {
	f, err := os.Open(EventStreamPath(dataDir))
	if os.IsNotExist(err) {
		return []StreamEvent{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	ring := make([]StreamEvent, 0, n)
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var ev StreamEvent
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		if len(ring) == n {
			ring = ring[1:]
		}
		ring = append(ring, ev)
	}
	return ring, sc.Err()
}
