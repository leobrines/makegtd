// makegtd sync server — zero-dependency (stdlib-only) reference implementation.
//
// Stores the app's encrypted per-device files (opaque blobs: payloads are
// end-to-end encrypted on-device before upload, so this server can never
// read GTD data). Protocol, matching js/server.js:
//
//	GET  /gtd/files          -> {"files":[{"name":"…","modifiedAt":"…"}]}
//	GET  /gtd/files/{name}   -> raw stored content
//	PUT  /gtd/files/{name}   -> store raw body
//
// Every request must carry "Authorization: Bearer <ACCESS_KEY>".
//
// Configuration (environment variables):
//
//	ACCESS_KEY      required — the bearer key devices must present.
//	PORT            listen port (default 8787).
//	DATA_DIR        storage directory (default ./gtd-sync-data).
//	ALLOWED_ORIGIN  CORS origin of the app, e.g. https://gtd.example.com
//	                (default *; tighten it in production).
//
// Run:
//
//	ACCESS_KEY=$(openssl rand -base64 24) go run ./server
//
// or build a static binary for any platform:
//
//	go build -o makegtd-sync ./server
//
// Put it behind TLS (Caddy, nginx, a Cloudflare tunnel…): browsers block
// plain-http requests from an https-served app. See server/README.md.
package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const maxBytes = 10 << 20 // A whole encrypted state document is far smaller.

// Same shape js/syncer.js produces; anything else is rejected, which also
// rules out path traversal.
var nameRe = regexp.MustCompile(`^gtd-device-[A-Za-z0-9-]{1,64}\.json$`)

type fileInfo struct {
	Name       string `json:"name"`
	ModifiedAt string `json:"modifiedAt"`
}

type server struct {
	dataDir       string
	accessKey     []byte
	allowedOrigin string
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func main() {
	accessKey := os.Getenv("ACCESS_KEY")
	if accessKey == "" {
		fmt.Fprintln(os.Stderr, "ACCESS_KEY is required. Generate one with:")
		fmt.Fprintln(os.Stderr, "  openssl rand -base64 24")
		os.Exit(1)
	}
	dataDir, err := filepath.Abs(env("DATA_DIR", "./gtd-sync-data"))
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		log.Fatal(err)
	}
	s := &server{
		dataDir:       dataDir,
		accessKey:     []byte(accessKey),
		allowedOrigin: env("ALLOWED_ORIGIN", "*"),
	}
	port := env("PORT", "8787")
	log.Printf("makegtd sync server listening on port %s", port)
	log.Printf("Data directory: %s", dataDir)
	log.Printf("Allowed origin: %s", s.allowedOrigin)
	log.Fatal(http.ListenAndServe(":"+port, s))
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", s.allowedOrigin)
	h.Set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	h.Set("Cache-Control", "no-store")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Path == "/" {
		h.Set("Content-Type", "text/plain")
		fmt.Fprintln(w, "makegtd sync server")
		return
	}
	if !s.authorized(r) {
		s.sendJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if r.URL.Path == "/gtd/files" && r.Method == http.MethodGet {
		s.list(w)
		return
	}
	if name, ok := strings.CutPrefix(r.URL.Path, "/gtd/files/"); ok && nameRe.MatchString(name) {
		switch r.Method {
		case http.MethodGet:
			s.download(w, name)
		case http.MethodPut:
			s.upload(w, r, name)
		default:
			s.sendJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method-not-allowed"})
		}
		return
	}
	s.sendJSON(w, http.StatusNotFound, map[string]string{"error": "not-found"})
}

func (s *server) authorized(r *http.Request) bool {
	presented, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return ok && subtle.ConstantTimeCompare([]byte(presented), s.accessKey) == 1
}

func (s *server) sendJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func (s *server) list(w http.ResponseWriter) {
	entries, err := os.ReadDir(s.dataDir)
	if err != nil {
		s.sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
		return
	}
	files := []fileInfo{} // Empty array (never null) in the JSON output.
	for _, entry := range entries {
		if !nameRe.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, fileInfo{
			Name:       entry.Name(),
			ModifiedAt: info.ModTime().UTC().Format(time.RFC3339),
		})
	}
	s.sendJSON(w, http.StatusOK, map[string][]fileInfo{"files": files})
}

func (s *server) download(w http.ResponseWriter, name string) {
	content, err := os.ReadFile(filepath.Join(s.dataDir, name))
	if err != nil {
		s.sendJSON(w, http.StatusNotFound, map[string]string{"error": "not-found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(content)
}

func (s *server) upload(w http.ResponseWriter, r *http.Request, name string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBytes))
	if err != nil {
		s.sendJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too-large"})
		return
	}
	// Atomic write: never leave a half-written file for a reader.
	target := filepath.Join(s.dataDir, name)
	tmp, err := os.CreateTemp(s.dataDir, name+".tmp-*")
	if err != nil {
		s.sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
		return
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(body); err != nil {
		tmp.Close()
		s.sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
		return
	}
	if err := tmp.Close(); err != nil {
		s.sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
		return
	}
	if err := os.Rename(tmp.Name(), target); err != nil {
		s.sendJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
		return
	}
	s.sendJSON(w, http.StatusOK, map[string]string{"name": name})
}
