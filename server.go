package main

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

type share struct {
	Token     string `json:"token"`
	Path      string `json:"path"`
	Directory bool   `json:"directory"`
	Expires   int64  `json:"expires"`
}
type session struct{ expires time.Time }
type app struct {
	root                           *os.Root
	db                             *sql.DB
	username, passwordHash, origin string
	ui                             []byte
	now                            func() time.Time
	mu                             sync.Mutex
	sessions                       map[string]session
	loginWindow                    time.Time
	loginCount                     int
}

func newApp(root, database, username, hash, origin string, ui []byte) (*app, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return nil, errors.New("origin must be an HTTPS origin")
	}
	if username == "" {
		return nil, errors.New("owner username required")
	}
	if _, err := bcrypt.Cost([]byte(hash)); err != nil {
		return nil, errors.New("valid bcrypt password hash required")
	}
	if root == "" {
		return nil, errors.New("root must be a directory")
	}
	// Literal /. forces directory traversal before opening, so FIFOs cannot block.
	r, err := os.OpenRoot(root + "/.")
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", database)
	if err != nil {
		r.Close()
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS shares(token TEXT PRIMARY KEY, path TEXT NOT NULL, directory INTEGER NOT NULL, expires INTEGER NOT NULL)`); err != nil {
		r.Close()
		db.Close()
		return nil, err
	}
	return &app{root: r, db: db, username: username, passwordHash: hash, origin: origin, ui: ui, now: time.Now, sessions: make(map[string]session)}, nil
}
func (a *app) close() { a.db.Close(); a.root.Close() }

func openBeneath(root *os.Root, name string) (*os.File, error) {
	// Open without waiting for a FIFO writer; callers reject non-regular files before reading.
	return root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
func (a *app) shareRoot(s share) (*os.Root, error) {
	name := s.Path
	if !s.Directory {
		name = path.Dir(name)
	}
	// Keep the literal /. (not path.Join) to reject FIFOs without blocking.
	return a.root.OpenRoot(name + "/.")
}
func token() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int) { http.Error(w, http.StatusText(status), status) }
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Header.Get("Content-Type") != "application/json" {
		fail(w, 415)
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400)
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400)
		return false
	}
	return true
}
func cleanName(s string) (string, bool) {
	s = strings.TrimSuffix(s, "/")
	if s == "" {
		s = "."
	}
	return s, fs.ValidPath(s) && !strings.Contains(s, "\\") && !strings.ContainsRune(s, 0)
}
func (a *app) owner(r *http.Request) bool {
	c, err := r.Cookie("__Host-file-share")
	if err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[c.Value]
	if !ok {
		return false
	}
	if !a.now().Before(s.expires) {
		delete(a.sessions, c.Value)
		return false
	}
	return true
}
func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	if r.Method != "GET" && r.Method != "HEAD" {
		if r.Header.Get("Origin") != a.origin || r.Header.Get("X-Requested-With") != "file-share" {
			fail(w, 403)
			return
		}
	}
	switch {
	case r.URL.Path == "/healthz" && r.Method == "GET":
		if a.db.PingContext(r.Context()) != nil {
			fail(w, 503)
			return
		}
		w.Write([]byte("ok\n"))
	case r.URL.Path == "/api/login" && r.Method == "POST":
		a.login(w, r)
	case r.URL.Path == "/api/logout" && r.Method == "POST":
		if !a.owner(r) {
			fail(w, 401)
			return
		}
		c, _ := r.Cookie("__Host-file-share")
		a.mu.Lock()
		delete(a.sessions, c.Value)
		a.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: "__Host-file-share", Path: "/", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		w.WriteHeader(204)
	case r.URL.Path == "/api/session" && r.Method == "GET":
		jsonResponse(w, 200, map[string]bool{"owner": a.owner(r)})
	case r.URL.Path == "/api/shares":
		if !a.owner(r) {
			fail(w, 401)
			return
		}
		a.shares(w, r)
	case r.URL.Path == "/api/list" && r.Method == "GET":
		a.list(w, r)
	case strings.HasPrefix(r.URL.Path, "/s/") && (r.Method == "GET" || r.Method == "HEAD"):
		a.shared(w, r)
	case strings.HasPrefix(r.URL.Path, "/files/") && (r.Method == "GET" || r.Method == "HEAD"):
		if !a.owner(r) {
			fail(w, 401)
			return
		}
		name, ok := cleanName(strings.TrimPrefix(r.URL.Path, "/files/"))
		if !ok {
			fail(w, 404)
			return
		}
		a.file(w, r, a.root, name)
	case r.URL.Path == "/" && (r.Method == "GET" || r.Method == "HEAD"):
		a.browser(w, r)
	default:
		fail(w, 404)
	}
}
func (a *app) browser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	if r.Method != "HEAD" {
		w.Write(a.ui)
	}
}
func (a *app) login(w http.ResponseWriter, r *http.Request) {
	// Global bound suits one owner and does not trust forwarded client-IP headers.
	a.mu.Lock()
	now := a.now()
	if now.Sub(a.loginWindow) >= time.Minute {
		a.loginWindow = now
		a.loginCount = 0
	}
	a.loginCount++
	blocked := a.loginCount > 10
	a.mu.Unlock()
	if blocked {
		w.Header().Set("Retry-After", "60")
		fail(w, 429)
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	valid := bcrypt.CompareHashAndPassword([]byte(a.passwordHash), []byte(in.Password)) == nil
	if !valid || subtle.ConstantTimeCompare([]byte(in.Username), []byte(a.username)) != 1 {
		fail(w, 401)
		return
	}
	id, err := token()
	if err != nil {
		fail(w, 500)
		return
	}
	a.mu.Lock()
	for k, s := range a.sessions {
		if !now.Before(s.expires) {
			delete(a.sessions, k)
		}
	}
	if len(a.sessions) >= 32 {
		a.mu.Unlock()
		fail(w, 429)
		return
	}
	a.sessions[id] = session{now.Add(12 * time.Hour)}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "__Host-file-share", Value: id, Path: "/", MaxAge: 43200, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	jsonResponse(w, 200, map[string]bool{"owner": true})
}
func (a *app) shares(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		rows, err := a.db.QueryContext(r.Context(), "SELECT token,path,directory,expires FROM shares ORDER BY rowid DESC")
		if err != nil {
			fail(w, 500)
			return
		}
		defer rows.Close()
		result := []share{}
		for rows.Next() {
			var s share
			if rows.Scan(&s.Token, &s.Path, &s.Directory, &s.Expires) != nil {
				fail(w, 500)
				return
			}
			result = append(result, s)
		}
		if rows.Err() != nil {
			fail(w, 500)
			return
		}
		jsonResponse(w, 200, result)
	case "POST":
		var in struct {
			Path    string `json:"path"`
			Seconds int64  `json:"seconds"`
		}
		if !decode(w, r, &in) {
			return
		}
		name, ok := cleanName(in.Path)
		if !ok || in.Seconds < 0 || in.Seconds > 315360000 {
			fail(w, 400)
			return
		}
		info, err := a.root.Stat(name)
		if err != nil || (!info.IsDir() && !info.Mode().IsRegular()) {
			fail(w, 400)
			return
		}
		directory := info.IsDir()
		root, err := a.shareRoot(share{Path: name, Directory: directory})
		if err != nil {
			fail(w, 400)
			return
		}
		defer root.Close()
		leaf := path.Base(name)
		if directory {
			leaf = "."
		}
		f, err := openBeneath(root, leaf)
		if err != nil {
			fail(w, 400)
			return
		}
		info, err = f.Stat()
		f.Close()
		if err != nil || info.IsDir() != directory || (!info.IsDir() && !info.Mode().IsRegular()) {
			fail(w, 400)
			return
		}
		id, err := token()
		if err != nil {
			fail(w, 500)
			return
		}
		s := share{Token: id, Path: name, Directory: info.IsDir()}
		if in.Seconds > 0 {
			s.Expires = a.now().Unix() + in.Seconds
		}
		if _, err = a.db.ExecContext(r.Context(), "INSERT INTO shares VALUES(?,?,?,?)", s.Token, s.Path, s.Directory, s.Expires); err != nil {
			fail(w, 500)
			return
		}
		jsonResponse(w, 201, s)
	case "DELETE":
		if _, err := a.db.ExecContext(r.Context(), "DELETE FROM shares WHERE token=?", r.URL.Query().Get("token")); err != nil {
			fail(w, 500)
			return
		}
		w.WriteHeader(204)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		fail(w, 405)
	}
}
func (a *app) findShare(r *http.Request, id string) (share, error) {
	var s share
	err := a.db.QueryRowContext(r.Context(), "SELECT token,path,directory,expires FROM shares WHERE token=?", id).Scan(&s.Token, &s.Path, &s.Directory, &s.Expires)
	if err != nil {
		return s, err
	}
	if s.Expires != 0 && a.now().Unix() >= s.Expires {
		return s, fs.ErrNotExist
	}
	return s, nil
}
func (a *app) list(w http.ResponseWriter, r *http.Request) {
	name, ok := cleanName(r.URL.Query().Get("path"))
	if !ok {
		fail(w, 404)
		return
	}
	root := a.root
	if id := r.URL.Query().Get("token"); id != "" {
		s, err := a.findShare(r, id)
		if err != nil || !s.Directory {
			fail(w, 404)
			return
		}
		root, err = a.shareRoot(s)
		if err != nil {
			fail(w, 404)
			return
		}
		defer root.Close()
	} else if !a.owner(r) {
		fail(w, 401)
		return
	}
	f, err := openBeneath(root, name)
	if err != nil {
		fail(w, 404)
		return
	}
	defer f.Close()
	if r.Context().Err() != nil {
		return
	}
	entries, err := f.ReadDir(256)
	if err != nil && err != io.EOF {
		fail(w, 404)
		return
	}
	type entry struct {
		Name  string    `json:"name"`
		Type  string    `json:"type"`
		Size  int64     `json:"size"`
		Mtime time.Time `json:"mtime"`
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err := io.WriteString(w, "["); err != nil {
		return
	}
	encoder := json.NewEncoder(w)
	first := true
	for {
		for _, e := range entries {
			if r.Context().Err() != nil {
				return
			}
			info, err := e.Info()
			if err == nil && info.Mode()&os.ModeSymlink != 0 {
				// Resolve against the share, not this subdirectory or the global root.
				info, err = root.Stat(path.Join(name, e.Name()))
			}
			if err != nil || (!info.IsDir() && !info.Mode().IsRegular()) {
				continue
			}
			kind := "file"
			if info.IsDir() {
				kind = "directory"
			}
			if !first {
				if _, err := io.WriteString(w, ","); err != nil {
					return
				}
			}
			if err := encoder.Encode(entry{e.Name(), kind, info.Size(), info.ModTime().UTC()}); err != nil {
				return
			}
			first = false
		}
		if r.Context().Err() != nil {
			return
		}
		if err == io.EOF {
			break
		}
		entries, err = f.ReadDir(256)
		if err != nil && err != io.EOF {
			// Headers may be sent; abort rather than return a successful partial listing.
			panic(http.ErrAbortHandler)
		}
	}
	io.WriteString(w, "]\n")
}
func (a *app) shared(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/s/"), "/", 2)
	s, err := a.findShare(r, parts[0])
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		w.WriteHeader(http.StatusNotFound)
		if r.Method != "HEAD" {
			io.WriteString(w, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link unavailable</title><main><h1>Link unavailable</h1><p>Contact the sender for a new link.</p></main></html>`)
		}
		return
	}
	tail := ""
	if len(parts) == 2 {
		tail = parts[1]
	}
	name, ok := cleanName(tail)
	if !ok {
		fail(w, 404)
		return
	}
	if !s.Directory {
		if name != "." && name != path.Base(s.Path) {
			fail(w, 404)
			return
		}
		name = path.Base(s.Path)
	}
	root, err := a.shareRoot(s)
	if err != nil {
		fail(w, 404)
		return
	}
	defer root.Close()
	if !s.Directory {
		a.file(w, r, root, name)
		return
	}
	f, err := openBeneath(root, name)
	if err != nil {
		fail(w, 404)
		return
	}
	info, err := f.Stat()
	f.Close()
	if err != nil {
		fail(w, 404)
		return
	}
	if info.IsDir() {
		if name == "." && strings.HasSuffix(r.URL.Path, "/") {
			a.browser(w, r)
			return
		}
		fragment := ""
		if name != "." {
			fragment = "#/" + escapePath(name) + "/"
		}
		http.Redirect(w, r, "/s/"+s.Token+"/"+fragment, http.StatusFound)
		return
	}
	a.file(w, r, root, name)
}
func escapePath(p string) string {
	parts := strings.Split(p, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}
func (a *app) file(w http.ResponseWriter, r *http.Request, root *os.Root, name string) {
	f, err := openBeneath(root, name)
	if err != nil {
		fail(w, 404)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		fail(w, 404)
		return
	}
	typ := mime.TypeByExtension(path.Ext(name))
	// Download active/unknown content; media remains streamable in browsers and players.
	if !(strings.HasPrefix(typ, "audio/") || strings.HasPrefix(typ, "video/") || (strings.HasPrefix(typ, "image/") && !strings.HasPrefix(typ, "image/svg"))) {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
		typ = "application/octet-stream"
	}
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}
