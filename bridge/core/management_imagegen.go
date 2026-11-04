package core

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

// Image generation management API (#150 item c), all under /api/v1/image-gen:
//
//	GET  /image-gen                  → status + recent pictures (behind the token)
//	POST /image-gen {prompt}         → draw one picture, answer where it was written
//	GET  /image-gen/file/<name>      → picture bytes (no token: <img> tags load it)
//
// Same bargain as the avatar library: the bytes route is the only public one, and it
// only serves plain file names this server itself wrote.

func (m *ManagementServer) registerImageGenRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc(prefix+"/image-gen", m.wrap(m.handleImageGen))
	mux.HandleFunc(prefix+"/image-gen/file/", m.handleImageGenFile)
}

// SetImageGenerator wires the opt-in generator. Left unset when [image_gen] is off, so
// the panel says "not configured" instead of offering a button that cannot work.
func (m *ManagementServer) SetImageGenerator(g *ImageGenerator) { m.imageGen = g }

func (m *ManagementServer) handleImageGen(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		m.imageGenStatus(w)
	case http.MethodPost:
		m.imageGenGenerate(w, r)
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or POST only")
	}
}

// imageGenStatus tells the panel whether a picture can be drawn right now, and what has
// been drawn already. Never echoes the api_key: only whether one is set.
func (m *ManagementServer) imageGenStatus(w http.ResponseWriter) {
	if m.imageGen == nil {
		mgmtJSON(w, http.StatusOK, map[string]any{
			"status":     "not_configured",
			"message":    "[image_gen] is not configured; add it to config.toml and restart",
			"pictures":   []ImageGenResult{},
			"can_draw":   false,
			"provider":   "",
			"model":      "",
			"out_dir":    "",
			"api_key_set": false,
		})
		return
	}
	cfg := m.imageGen.Config()
	out := map[string]any{
		"status":      "ready",
		"pictures":    m.imageGen.List(imageGenRecentDefault),
		"can_draw":    true,
		"provider":    cfg.Provider,
		"model":       cfg.Model,
		"base_url":    cfg.BaseURL,
		"out_dir":     cfg.OutDir,
		"api_key_set": strings.TrimSpace(cfg.APIKey) != "",
	}
	if err := m.imageGen.Ready(); err != nil {
		out["status"] = "error"
		out["can_draw"] = false
		out["message"] = err.Error()
	}
	mgmtJSON(w, http.StatusOK, out)
}

func (m *ManagementServer) imageGenGenerate(w http.ResponseWriter, r *http.Request) {
	if m.imageGen == nil {
		mgmtError(w, http.StatusServiceUnavailable, "image generation is not configured")
		return
	}
	var body struct {
		Prompt string `json:"prompt"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	res, err := m.imageGen.Generate(r.Context(), body.Prompt)
	switch {
	case err == nil:
		mgmtJSON(w, http.StatusOK, res)
	case errors.Is(err, ErrImageGenDisabled):
		mgmtError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, ErrImageGenBusy):
		mgmtError(w, http.StatusConflict, err.Error())
	default:
		// Provider failures keep their message: it says what the endpoint answered
		// (bad key, unknown model, quota), which is what the owner needs to fix it.
		mgmtError(w, http.StatusBadGateway, err.Error())
	}
}

func (m *ManagementServer) handleImageGenFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if m.imageGen == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/v1/image-gen/file/")
	b, mime, err := m.imageGen.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.Header().Set("Cache-Control", "no-cache") // a name is written once; no-cache keeps a re-pick honest
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(b)
}