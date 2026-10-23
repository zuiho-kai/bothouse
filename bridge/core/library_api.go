package core

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
)

// Library management API (avatar library + persona library, organised in packs). Routes, all
// under /api/v1/library and behind the management token except avatar-image:
//
//	GET    /library?lang=                         → Library (merged view)
//	POST   /library/personas                      {slug?,name,intro,avatar,text} → {slug}
//	PUT    /library/personas/<slug>               {name,intro,avatar,text} → {slug,applied,skipped}
//	DELETE /library/personas/<slug>               → {result: "deleted"|"hidden"}
//	POST   /library/personas/<slug>/undo|reset
//	POST   /library/avatars                       multipart: file, slug?, name? → {slug,url}
//	PUT    /library/avatars/<slug>                multipart: file → {slug,url}
//	DELETE /library/avatars/<slug>                → {result}
//	POST   /library/avatars/<slug>/undo|reset
//	POST   /library/packs/preview                 multipart file=<zip> | JSON {url} → PackPreview
//	POST   /library/packs/install                 {staging} → PackManifest
//	POST   /library/packs/<id>/enable|disable
//	DELETE /library/packs/<id>
//	POST   /library/packs/export                  {manifest,personas,avatars} → application/zip
//	GET    /library/avatar-image/<slug>           picture bytes (no token: <img> tags load it)

// libraryMu serialises library writes (state.json and the "mine" pack are read-modify-write).
var libraryMu sync.Mutex

func (m *ManagementServer) registerLibraryRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc(prefix+"/library", m.wrap(m.handleLibrary))
	mux.HandleFunc(prefix+"/library/", m.wrap(m.handleLibraryRoutes))
	mux.HandleFunc(prefix+"/library/avatar-image/", m.handleLibraryAvatarImage)
}

func libraryLang(r *http.Request) string {
	if l := r.URL.Query().Get("lang"); l != "" {
		return l
	}
	return SystemLanguage()
}

func (m *ManagementServer) handleLibrary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	mgmtJSON(w, http.StatusOK, LoadLibrary(m.wizardDataDir, libraryLang(r), LoadSetupState(m.wizardDataDir)))
}

func (m *ManagementServer) handleLibraryRoutes(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/library/"), "/")
	parts := strings.Split(rest, "/")
	libraryMu.Lock()
	defer libraryMu.Unlock()
	switch parts[0] {
	case "personas", "avatars":
		m.handleLibraryItems(w, r, parts[0], parts[1:])
	case "packs":
		m.handleLibraryPacks(w, r, parts[1:])
	default:
		mgmtError(w, http.StatusNotFound, "not found")
	}
}

func (m *ManagementServer) handleLibraryItems(w http.ResponseWriter, r *http.Request, kind string, p []string) {
	dd, lang := m.wizardDataDir, libraryLang(r)
	slug := ""
	if len(p) > 0 {
		slug = p[0]
		if !LibrarySlugOK(slug) {
			mgmtError(w, http.StatusBadRequest, "invalid slug")
			return
		}
	}
	switch {
	case len(p) == 0 && r.Method == http.MethodPost, len(p) == 1 && r.Method == http.MethodPut:
		if kind == "personas" {
			m.saveLibraryPersona(w, r, slug)
		} else {
			m.saveLibraryAvatar(w, r, slug)
		}
	case len(p) == 1 && r.Method == http.MethodDelete:
		res, err := DeleteLibraryItem(dd, lang, kind, slug)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"result": res})
	case len(p) == 2 && r.Method == http.MethodPost && (p[1] == "undo" || p[1] == "reset"):
		var err error
		if p[1] == "undo" {
			err = UndoLibraryItem(dd, kind, slug)
		} else {
			err = ResetLibraryItem(dd, lang, kind, slug)
		}
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		out := map[string]any{"slug": slug}
		if kind == "personas" { // the text in effect changed: roles using it follow
			out["applied"], out["skipped"] = m.applyLibraryPersona(lang, slug)
		}
		mgmtJSON(w, http.StatusOK, out)
	default:
		mgmtError(w, http.StatusNotFound, "not found")
	}
}

// applyLibraryPersona writes the persona now shown for slug into the roles that use it.
func (m *ManagementServer) applyLibraryPersona(lang, slug string) (applied, skipped []string) {
	for _, p := range LoadLibrary(m.wizardDataDir, lang, LoadSetupState(m.wizardDataDir)).Personas {
		if p.Slug == slug {
			return ApplyPersonaToRoles(m.wizardDataDir, m.wizardStore, slug, p.Text)
		}
	}
	return nil, nil
}

func (m *ManagementServer) saveLibraryPersona(w http.ResponseWriter, r *http.Request, slug string) {
	var p LibraryPersona
	// 2×: room for the JSON escaping of the text
	if err := json.NewDecoder(io.LimitReader(r.Body, 2*libraryMaxPersona)).Decode(&p); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	lang := libraryLang(r)
	creating := slug == ""
	if creating {
		lib := LoadLibrary(m.wizardDataDir, lang, LoadSetupState(m.wizardDataDir))
		if p.Slug == "" {
			p.Slug = NewLibrarySlug(lib, "personas", p.Name)
		} else {
			for _, x := range lib.Personas {
				if x.Slug == p.Slug {
					mgmtError(w, http.StatusConflict, "slug already in use: "+p.Slug)
					return
				}
			}
		}
		slug = p.Slug
	}
	p.Slug = slug
	if err := SaveLibraryPersona(m.wizardDataDir, p); err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	out := map[string]any{"slug": slug}
	if !creating {
		out["applied"], out["skipped"] = ApplyPersonaToRoles(m.wizardDataDir, m.wizardStore, slug, p.Text)
	}
	mgmtJSON(w, http.StatusOK, out)
}

func (m *ManagementServer) saveLibraryAvatar(w http.ResponseWriter, r *http.Request, slug string) {
	r.Body = http.MaxBytesReader(w, r.Body, 2*libraryMaxImage) // room for the form fields around the picture
	if err := r.ParseMultipartForm(2 * libraryMaxImage); err != nil {
		mgmtError(w, http.StatusBadRequest, "multipart form with a file field expected: "+err.Error())
		return
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		mgmtError(w, http.StatusBadRequest, "file required")
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, libraryMaxImage+1))
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	if slug == "" {
		lib := LoadLibrary(m.wizardDataDir, libraryLang(r), LoadSetupState(m.wizardDataDir))
		if slug = r.FormValue("slug"); slug == "" {
			slug = NewLibrarySlug(lib, "avatars", r.FormValue("name"))
		} else {
			for _, a := range lib.Avatars {
				if a.Slug == slug {
					mgmtError(w, http.StatusConflict, "slug already in use: "+slug)
					return
				}
			}
		}
	}
	if err := SaveLibraryAvatar(m.wizardDataDir, slug, b); err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	url := ""
	for _, a := range LoadLibrary(m.wizardDataDir, libraryLang(r), SetupState{}).Avatars {
		if a.Slug == slug {
			url = a.URL
		}
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"slug": slug, "url": url})
}

func (m *ManagementServer) handleLibraryPacks(w http.ResponseWriter, r *http.Request, p []string) {
	dd, lang := m.wizardDataDir, libraryLang(r)
	switch {
	case len(p) == 1 && p[0] == "preview" && r.Method == http.MethodPost:
		zb, err := readPackUpload(w, r)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		pv, err := PreviewPack(dd, lang, zb)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, pv)
	case len(p) == 1 && p[0] == "install" && r.Method == http.MethodPost:
		var body struct {
			Staging string `json:"staging"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, libraryMaxPersona)).Decode(&body); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		mf, err := InstallPack(dd, body.Staging)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, mf)
	case len(p) == 1 && p[0] == "export" && r.Method == http.MethodPost:
		var body struct {
			Manifest PackManifest `json:"manifest"`
			Personas []string     `json:"personas"`
			Avatars  []string     `json:"avatars"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, libraryMaxPersona)).Decode(&body); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		zb, err := ExportPack(dd, lang, body.Manifest, body.Personas, body.Avatars)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+body.Manifest.ID+`.zip"`)
		_, _ = w.Write(zb)
	case len(p) == 2 && (p[1] == "enable" || p[1] == "disable") && r.Method == http.MethodPost:
		if err := SetPackEnabled(dd, p[0], p[1] == "enable"); err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"id": p[0], "enabled": p[1] == "enable"})
	case len(p) == 1 && r.Method == http.MethodDelete:
		if err := UninstallPack(dd, p[0]); err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"id": p[0]})
	default:
		mgmtError(w, http.StatusNotFound, "not found")
	}
}

// readPackUpload: the zip from a multipart "file" field, or downloaded from JSON {"url": "https://…"}.
func readPackUpload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		r.Body = http.MaxBytesReader(w, r.Body, 2*libraryMaxZip) // room for the form fields around the zip
		if err := r.ParseMultipartForm(2 * libraryMaxZip); err != nil {
			return nil, err
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			return nil, errors.New("file required")
		}
		defer f.Close()
		return io.ReadAll(io.LimitReader(f, libraryMaxZip+1))
	}
	var body struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, libraryMaxPersona)).Decode(&body); err != nil || body.URL == "" {
		return nil, errors.New("multipart file or JSON {\"url\"} required")
	}
	return DownloadPack(r, body.URL)
}

func (m *ManagementServer) handleLibraryAvatarImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	slug := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/v1/library/avatar-image/"), filepath.Ext(r.URL.Path))
	b, _, ok := LibraryAvatarImage(m.wizardDataDir, slug)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(b))
	w.Header().Set("Cache-Control", "no-cache") // avatarURL adds ?v= when the file changes
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(b)
}
