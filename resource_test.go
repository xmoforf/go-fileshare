package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Discard response bytes so listing measurements exclude client-side buffering.
type countingResponse struct {
	header http.Header
	code   int
	bytes  int
}

func (w *countingResponse) Header() http.Header  { return w.header }
func (w *countingResponse) WriteHeader(code int) { w.code = code }
func (w *countingResponse) Write(p []byte) (int, error) {
	if w.code == 0 {
		w.code = 200
	}
	w.bytes += len(p)
	return len(p), nil
}

func BenchmarkDirectoryListing(b *testing.B) {
	for _, count := range []int{1000, 10000, 50000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			root := b.TempDir()
			for i := 0; i < count; i++ {
				name := fmt.Sprintf("%06d-%s", i, strings.Repeat("x", 57))
				if err := os.WriteFile(filepath.Join(root, name), nil, 0600); err != nil {
					b.Fatal(err)
				}
			}
			hash, err := bcrypt.GenerateFromPassword([]byte("synthetic-password"), bcrypt.MinCost)
			if err != nil {
				b.Fatal(err)
			}
			a, err := newApp(root, filepath.Join(b.TempDir(), "shares.db"), "owner", string(hash), "https://files.test", nil)
			if err != nil {
				b.Fatal(err)
			}
			defer a.close()
			a.sessions["benchmark"] = session{time.Now().Add(time.Hour)}
			r := httptest.NewRequest("GET", "/api/list", nil)
			r.Header.Set("Cookie", "__Host-file-share=benchmark")
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				w := &countingResponse{header: make(http.Header)}
				a.ServeHTTP(w, r)
				if w.code != 200 {
					b.Fatal(w.code)
				}
				b.ReportMetric(float64(w.bytes), "response-B")
				b.ReportMetric(float64(w.code), "status")
			}
		})
	}
}

func BenchmarkLoginCost12(b *testing.B) {
	hash, err := bcrypt.GenerateFromPassword([]byte("synthetic-password"), 12)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := bcrypt.CompareHashAndPassword(hash, []byte("synthetic-password")); err != nil {
			b.Fatal(err)
		}
	}
}

// Interrupt at the transport boundary, without mocking directory enumeration.
type interruptedListing struct {
	*httptest.ResponseRecorder
	cancel  context.CancelFunc
	writes  int
	stopped int
}

func (w *interruptedListing) Write(p []byte) (int, error) {
	w.writes++
	if w.cancel == nil {
		return 0, errors.New("synthetic disconnected writer")
	}
	n, err := w.ResponseRecorder.Write(p)
	if w.Body.Len() >= 32768 && w.stopped == 0 {
		w.cancel()
		w.stopped = w.writes
	}
	return n, err
}

func TestResourceListingCancellation(t *testing.T) {
	a, root, _ := fixture(t)
	cookie := login(t, a)
	for i := 0; i < 1024; i++ {
		if err := os.WriteFile(filepath.Join(root, "folder", fmt.Sprint(i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, mode := range []string{"before", "during", "write-error"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := httptest.NewRequest("GET", "/api/list?path=folder", nil).WithContext(ctx)
			r.Header.Set("Cookie", cookie)
			w := &interruptedListing{ResponseRecorder: httptest.NewRecorder(), cancel: cancel}
			if mode == "before" {
				cancel()
			} else if mode == "write-error" {
				w.cancel = nil
			}
			a.ServeHTTP(w, r)
			if mode == "before" && w.writes != 0 {
				t.Fatalf("canceled request wrote %d response bytes", w.Body.Len())
			}
			if mode == "write-error" && w.writes != 1 {
				t.Fatalf("continued after write failure: writes=%d", w.writes)
			}
			if mode == "during" && (w.stopped == 0 || w.writes != w.stopped) {
				t.Fatalf("cancellation not observed: writes=%d stop=%d", w.writes, w.stopped)
			}
			if w.Body.Len() > 32768+512 || json.Valid(w.Body.Bytes()) {
				t.Fatalf("listing buffered/completed after cancellation: bytes=%d validJSON=%v", w.Body.Len(), json.Valid(w.Body.Bytes()))
			}
		})
	}
}

func TestResourceLargeListing(t *testing.T) {
	a, root, _ := fixture(t)
	cookie := login(t, a)
	const count = 50000
	if err := os.Mkdir(filepath.Join(root, "large"), 0700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < count; i++ {
		if err := os.WriteFile(filepath.Join(root, "large", fmt.Sprintf("entry-%05d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := create(t, a, cookie, "large", 0)
	for _, target := range []struct{ url, cookie string }{{"/api/list?path=large", cookie}, {"/api/list?token=" + s.Token, ""}} {
		w := request(a, "GET", target.url, "", target.cookie)
		var entries []struct{ Name string }
		if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || len(entries) != count {
			t.Fatalf("large listing truncated: code=%d count=%d", w.Code, len(entries))
		}
		seen := make(map[string]bool, count)
		for _, entry := range entries {
			if seen[entry.Name] {
				t.Fatal("duplicate entry", entry.Name)
			}
			seen[entry.Name] = true
		}
	}
}

func TestResourceSQLCancellation(t *testing.T) {
	a, _, _ := fixture(t)
	conn, err := a.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := httptest.NewRequest("GET", "/healthz", nil).WithContext(ctx)
	done := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		done <- w.Code
	}()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for a.db.Stats().WaitCount == 0 {
		select {
		case <-deadline.C:
			t.Fatal("request did not wait for occupied SQL connection")
		case <-ticker.C:
		}
	}
	cancel()
	select {
	case code := <-done:
		if code != 503 {
			t.Fatal(code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SQL pool wait ignored cancellation")
	}
	if a.db.Stats().OpenConnections != 1 {
		t.Fatal("SQL pool grew")
	}
	t.Logf("SQL wait canceled; max connections=%d waits=%d", a.db.Stats().MaxOpenConnections, a.db.Stats().WaitCount)
}

func TestResourceLoginBudget(t *testing.T) {
	a, _, _ := fixture(t)
	now := time.Now()
	a.now = func() time.Time { return now }
	var wg sync.WaitGroup
	codes := make(chan int, 40)
	for i := 0; i < cap(codes); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"owner","password":"wrong"}`))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Origin", a.origin)
			r.Header.Set("X-Requested-With", "file-share")
			r.Header.Set("X-Forwarded-For", "192.0.2.1")
			w := httptest.NewRecorder()
			a.ServeHTTP(w, r)
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[401] != 10 || counts[429] != 30 {
		t.Fatal("login budget", counts)
	}
	if w := request(a, "POST", "/api/login", `{}`, ""); w.Code != 429 || w.Header().Get("Retry-After") != "60" {
		t.Fatal("owner is also throttled during abuse", w.Code)
	}
	for i := 0; i < 32; i++ {
		a.sessions[fmt.Sprint(i)] = session{now.Add(time.Hour)}
	}
	now = now.Add(time.Minute)
	body := `{"username":"owner","password":"test-password"}`
	if w := request(a, "POST", "/api/login", body, ""); w.Code != 429 || len(a.sessions) != 32 {
		t.Fatal("session cap", w.Code, len(a.sessions))
	}
	now = now.Add(time.Hour)
	if w := request(a, "POST", "/api/login", body, ""); w.Code != 200 || len(a.sessions) != 1 {
		t.Fatal("expired sessions not reclaimed", w.Code, len(a.sessions))
	}
	t.Log("40 concurrent logins: 10 bcrypt attempts, 30 rejected; session cap=32, expiry reclaimed")
}

func TestResourceStalledTransfers(t *testing.T) {
	a, root, _ := fixture(t)
	const size = 64 << 20
	name := filepath.Join(root, "large.bin")
	f, err := os.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	err = f.Truncate(size)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	cookie := login(t, a)
	s := create(t, a, cookie, "large.bin", 0)
	done := make(chan struct{}, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/s/") {
			done <- struct{}{}
		}
	}))
	defer srv.Close()
	runtime.GC()
	var before, during runtime.MemStats
	runtime.ReadMemStats(&before)
	var conns []net.Conn
	defer func() {
		for _, c := range conns {
			c.Close()
		}
	}()
	for i := 0; i < cap(done); i++ {
		c, err := net.DialTimeout("tcp", srv.Listener.Addr().String(), time.Second)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, c)
		if err := c.(*net.TCPConn).SetReadBuffer(4096); err != nil {
			t.Fatal(err)
		}
		c.SetDeadline(time.Now().Add(10 * time.Second))
		r, _ := http.NewRequest("GET", srv.URL+"/s/"+s.Token, nil)
		if err := r.Write(c); err != nil {
			t.Fatal(err)
		}
		resp, err := http.ReadResponse(bufio.NewReader(c), r)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 || resp.ContentLength != size {
			t.Fatalf("status=%d length=%d", resp.StatusCode, resp.ContentLength)
		}
		if _, err := io.ReadFull(resp.Body, make([]byte, 1)); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-done:
		t.Fatal("stalled transfer unexpectedly finished")
	case <-time.After(100 * time.Millisecond):
	}
	client := &http.Client{Timeout: 2 * time.Second}
	defer client.CloseIdleConnections()
	for _, target := range []string{"/healthz", "/api/session", "/api/shares"} {
		r, _ := http.NewRequest("GET", srv.URL+target, nil)
		r.Header.Set("Cookie", cookie)
		resp, err := client.Do(r)
		if err != nil {
			t.Fatal("stalled downloads blocked control request", err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatal(target, resp.StatusCode)
		}
	}
	runtime.GC()
	runtime.ReadMemStats(&during)
	t.Logf("8 stalled 64MiB transfers: live heap delta=%d bytes (not a capacity guarantee)", int64(during.HeapAlloc)-int64(before.HeapAlloc))
	for _, c := range conns {
		c.Close()
	}
	for range conns {
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("disconnect did not release handler")
		}
	}
	fds, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatal(err)
	}
	for _, fd := range fds {
		if target, _ := os.Readlink("/proc/self/fd/" + fd.Name()); target == name {
			t.Fatal("download file descriptor leaked")
		}
	}
	t.Log("control requests responsive while stalled; all 8 handlers/files released on disconnect")
}
