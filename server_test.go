package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func fixture(t *testing.T) (*app, string, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder/sub"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"folder/sub/movie.mp4": "0123456789", "outside.txt": "private", "folder/a #?%é.txt": "special", "folder/active.html": "<script>alert(1)</script>"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	db := filepath.Join(t.TempDir(), "shares.db")
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	a, err := newApp(root, db, "owner", string(hash), "https://files.test", []byte("browser"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.close() })
	return a, root, db
}
func request(a *app, method, target, body, cookie string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Header.Set("Origin", "https://files.test")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Requested-With", "file-share")
	if cookie != "" {
		r.Header.Set("Cookie", cookie)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}
func login(t *testing.T, a *app) string {
	t.Helper()
	w := request(a, "POST", "/api/login", `{"username":"owner","password":"test-password"}`, "")
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("missing cookie")
	}
	c := cookies[0]
	if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" {
		t.Fatal("unsafe cookie")
	}
	return c.Name + "=" + c.Value
}
func create(t *testing.T, a *app, cookie, path string, seconds int64) share {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"path": path, "seconds": seconds})
	w := request(a, "POST", "/api/shares", string(b), cookie)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var s share
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}
func TestOwnerAndCSRF(t *testing.T) {
	a, _, _ := fixture(t)
	for _, p := range []string{"/api/list", "/api/shares", "/files/outside.txt"} {
		if w := request(a, "GET", p, "", ""); w.Code != 401 {
			t.Fatalf("unprotected %s: %d", p, w.Code)
		}
	}
	if w := request(a, "POST", "/api/login", `{"username":"owner","password":"bad"}`, ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	c := login(t, a)
	if w := request(a, "GET", "/api/list", "", c); w.Code != 200 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("POST", "/api/shares", strings.NewReader(`{"path":"folder","seconds":0}`))
	r.Header.Set("Cookie", c)
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("CSRF accepted", w.Code)
	}
	request(a, "POST", "/api/logout", "", c)
	if w := request(a, "GET", "/api/list", "", c); w.Code != 401 {
		t.Fatal("logout ineffective")
	}
}
func TestUnavailableShareFeedback(t *testing.T) {
	a, _, _ := fixture(t)
	c := login(t, a)
	now := time.Now()
	a.now = func() time.Time { return now }
	expired := create(t, a, c, "folder", 60)
	revoked := create(t, a, c, "folder/sub/movie.mp4", 0)
	if w := request(a, "DELETE", "/api/shares?token="+revoked.Token, "", c); w.Code != 204 {
		t.Fatal("revoke", w.Code)
	}
	now = now.Add(time.Minute)
	baseline := request(a, "GET", "/s/unknown/", "", "")
	for _, id := range []string{"unknown", "<script>alert(1)</script>", expired.Token, revoked.Token} {
		for _, suffix := range []string{"", "/", "/sub/movie.mp4"} {
			for _, cookie := range []string{"", c} {
				for _, method := range []string{"GET", "HEAD"} {
					w := request(a, method, "/s/"+url.PathEscape(id)+suffix, "", cookie)
					if w.Code != 404 || w.Header().Get("Content-Type") != "text/html; charset=utf-8" {
						t.Fatalf("%s unavailable share: %d %s", method, w.Code, w.Header().Get("Content-Type"))
					}
					for header, want := range map[string]string{
						"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
						"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
						"Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
					} {
						if w.Header().Get(header) != want {
							t.Fatalf("%s: %q", header, w.Header().Get(header))
						}
					}
					if method == "HEAD" {
						if w.Body.Len() != 0 {
							t.Fatal("HEAD must not include error page")
						}
					} else if w.Body.String() != baseline.Body.String() ||
						!strings.Contains(w.Body.String(), "<h1>Link unavailable</h1>") ||
						!strings.Contains(w.Body.String(), "Contact the sender for a new link.") {
						t.Fatalf("nonuniform or missing recovery copy: %s", w.Body.String())
					}
				}
			}
		}
		w := request(a, "GET", "/api/list?token="+url.QueryEscape(id), "", "")
		if w.Code != 404 || w.Body.String() != "Not Found\n" {
			t.Fatal("API denial changed", w.Code, w.Body.String())
		}
	}
}

func TestWrongCredentialsRemainDenied(t *testing.T) {
	a, _, _ := fixture(t)
	for _, body := range []string{
		`{"username":"owner","password":"wrong"}`,
		`{"username":"unknown","password":"test-password"}`,
	} {
		w := request(a, "POST", "/api/login", body, "")
		if w.Code != 401 || w.Body.String() != "Unauthorized\n" || len(w.Result().Cookies()) != 0 || len(a.sessions) != 0 {
			t.Fatal("wrong credentials accepted or distinguished", w.Code, w.Body.String())
		}
	}
}

func TestShareLifecycle(t *testing.T) {
	a, root, db := fixture(t)
	c := login(t, a)
	now := time.Now()
	a.now = func() time.Time { return now }
	s := create(t, a, c, "folder", 60)
	target := "/s/" + s.Token + "/sub/movie.mp4"
	if w := request(a, "GET", target, "", ""); w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request(a, "GET", "/api/list?token="+s.Token, "", ""); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"name":"sub"`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"name":"active.html"`)) {
		t.Fatal("listing missing fixture entries", w.Code, w.Body.String())
	}
	if err := os.WriteFile(filepath.Join(root, "folder/new.txt"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "GET", "/s/"+s.Token+"/new.txt", "", ""); w.Code != 200 {
		t.Fatal("not live")
	}
	now = now.Add(time.Minute)
	if w := request(a, "GET", target, "", ""); w.Code != 404 {
		t.Fatal("expiry boundary", w.Code)
	}
	forever := create(t, a, c, "folder", 0)
	a.close()
	var err error
	a, err = newApp(root, db, "owner", a.passwordHash, "https://files.test", []byte("browser"))
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	if w := request(a, "GET", "/s/"+forever.Token+"/new.txt", "", ""); w.Code != 200 {
		t.Fatal("restart lost share", w.Code)
	}
	c = login(t, a)
	w := request(a, "GET", "/api/shares", "", c)
	if !bytes.Contains(w.Body.Bytes(), []byte(forever.Token)) {
		t.Fatal("list missing copy token")
	}
	if w := request(a, "DELETE", "/api/shares?token="+forever.Token, "", c); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w := request(a, "GET", "/s/"+forever.Token+"/new.txt", "", ""); w.Code != 404 {
		t.Fatal("revoked usable")
	}
}
func TestScopeRangesAndEncoding(t *testing.T) {
	a, root, _ := fixture(t)
	c := login(t, a)
	s := create(t, a, c, "folder", 0)
	base := "/s/" + s.Token + "/"
	if err := os.Symlink("../outside.txt", filepath.Join(root, "folder/escape")); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"../outside.txt", "%2e%2e/outside.txt", "escape", "%252e%252e/outside.txt"} {
		if w := request(a, "GET", base+p, "", ""); w.Code != 404 {
			t.Fatalf("escape %s: %d", p, w.Code)
		}
	}
	if w := request(a, "GET", base+url.PathEscape("a #?%é.txt"), "", ""); w.Code != 200 || w.Body.String() != "special" {
		t.Fatal("encoding", w.Code)
	}
	r := httptest.NewRequest("GET", base+"sub/movie.mp4", nil)
	r.Header.Set("Range", "bytes=2-5")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "2345" {
		t.Fatal("range", w.Code, w.Body.String())
	}
	if w := request(a, "HEAD", base+"sub/movie.mp4", "", ""); w.Code != 200 || w.Body.Len() != 0 {
		t.Fatal("HEAD")
	}
	if w := request(a, "GET", base+"active.html", "", ""); !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("active content inline")
	}
	single := create(t, a, c, "folder/sub/movie.mp4", 0)
	if w := request(a, "GET", "/s/"+single.Token+"/movie.mp4", "", ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := request(a, "GET", "/s/"+single.Token+"/../active.html", "", ""); w.Code != 404 {
		t.Fatal("file scope escape")
	}
	if w := request(a, "GET", "/api/list?token="+single.Token, "", ""); w.Code != 404 {
		t.Fatal("file share listing")
	}
}
func TestInvalidCreationAndRateLimit(t *testing.T) {
	a, _, _ := fixture(t)
	c := login(t, a)
	for _, b := range []string{`{"path":"../","seconds":0}`, `{"path":"missing","seconds":0}`, `{"path":"folder","seconds":-1}`, `{"path":"folder","seconds":9223372036854775807}`} {
		if w := request(a, "POST", "/api/shares", b, c); w.Code < 400 {
			t.Fatal("invalid accepted", b)
		}
	}
	for i := 0; i < 20; i++ {
		request(a, "POST", "/api/login", `{"username":"owner","password":"bad"}`, "")
	}
	if w := request(a, "POST", "/api/login", `{"username":"owner","password":"bad"}`, ""); w.Code != 429 {
		t.Fatal("unbounded login", w.Code)
	}
}
