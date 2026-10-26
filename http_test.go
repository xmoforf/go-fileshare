package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRangeAndConditionalRequestsRequireLiveShare(t *testing.T) {
	a, _, _ := fixture(t)
	c := login(t, a)
	now := time.Now()
	a.now = func() time.Time { return now }
	s := create(t, a, c, "folder", 10)
	target := "/s/" + s.Token + "/sub/movie.mp4"
	for _, test := range []struct {
		rangeValue string
		code       int
		body       string
	}{{"bytes=2-5", 206, "2345"}, {"bytes=7-", 206, "789"}, {"bytes=-3", 206, "789"}, {"bytes=99-", 416, ""}} {
		r := httptest.NewRequest("GET", target, nil)
		r.Header.Set("Range", test.rangeValue)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != test.code || (test.body != "" && w.Body.String() != test.body) {
			t.Fatalf("range %s: %d %s", test.rangeValue, w.Code, w.Body.String())
		}
	}
	first := request(a, "GET", target, "", "")
	r := httptest.NewRequest("GET", target, nil)
	r.Header.Set("If-Modified-Since", first.Header().Get("Last-Modified"))
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 304 {
		t.Fatal("conditional request", w.Code)
	}
	now = now.Add(10 * time.Second)
	w = httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatal("expired conditional bypass", w.Code)
	}
	r.Header.Set("Range", "bytes=0-1")
	w = httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatal("expired range bypass", w.Code)
	}
}

func TestListingMetadataReservedNamesAndEmptyFolder(t *testing.T) {
	a, root, _ := fixture(t)
	c := login(t, a)
	if err := os.Mkdir(filepath.Join(root, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder/_api"), []byte("reserved"), 0600); err != nil {
		t.Fatal(err)
	}
	s := create(t, a, c, "folder", 0)
	w := request(a, "GET", "/api/list?token="+s.Token, "", "")
	var entries []struct {
		Name  string
		Type  string
		Size  int64
		Mtime time.Time
	}
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.Name == "_api" {
			found = true
			if e.Size != 8 || e.Type != "file" || e.Mtime.IsZero() {
				t.Fatal("bad metadata", e)
			}
		}
	}
	if !found {
		t.Fatal("missing reserved-name file")
	}
	if w := request(a, "GET", "/s/"+s.Token+"/_api", "", ""); w.Code != 200 || w.Body.String() != "reserved" {
		t.Fatal("reserved route collision", w.Code)
	}
	empty := create(t, a, c, "empty", 0)
	if w := request(a, "GET", "/api/list?token="+empty.Token, "", ""); w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal("empty folder", w.Code, w.Body.String())
	}
}
