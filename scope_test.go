package main

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRootRequiresDirectory(t *testing.T) {
	a, root, _ := fixture(t)
	for _, name := range []string{"", filepath.Join(root, "outside.txt")} {
		other, err := newApp(name, filepath.Join(t.TempDir(), "shares.db"), "owner", a.passwordHash, "https://files.test", nil)
		if err == nil {
			other.close()
			t.Errorf("non-directory root %q accepted", name)
		}
	}
}

func TestRootLinks(t *testing.T) {
	a, root, _ := fixture(t)
	c := login(t, a)
	s := create(t, a, c, "folder", 0)
	links := map[string]string{
		"movie": "sub/movie.mp4", "chain": "movie", "directory": "sub",
		"sub/up": "../active.html", "escape": "../outside.txt",
		"absolute": filepath.Join(root, "folder/sub/movie.mp4"),
		"reenter":  "../folder/sub/movie.mp4", "broken": "missing", "loop": "loop",
	}
	for name, target := range links {
		if err := os.Symlink(target, filepath.Join(root, "folder", name)); err != nil {
			t.Fatal(err)
		}
	}
	for name, body := range map[string]string{
		"movie": "0123456789", "chain": "0123456789", "directory/movie.mp4": "0123456789",
		"sub/up": "<script>alert(1)</script>",
	} {
		for _, target := range []string{"/s/" + s.Token + "/" + name, "/files/folder/" + name} {
			w := request(a, "GET", target, "", c)
			if w.Code != 200 || w.Body.String() != body {
				t.Errorf("%s: %d %q", target, w.Code, w.Body.String())
			}
		}
	}
	for _, name := range []string{"escape", "absolute", "reenter", "broken", "loop"} {
		if w := request(a, "GET", "/s/"+s.Token+"/"+name, "", ""); w.Code != 404 {
			t.Errorf("link %s accepted: %d", name, w.Code)
		}
	}
	for _, dir := range []string{"", "sub", "directory"} {
		w := request(a, "GET", "/api/list?token="+s.Token+"&path="+dir, "", "")
		var entries []struct {
			Name, Type string
			Size       int64
			Mtime      time.Time
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &entries) != nil {
			t.Fatalf("listing %s: %d %s", dir, w.Code, w.Body.String())
		}
		found := map[string]bool{}
		for _, e := range entries {
			name := e.Name
			if dir != "" {
				name = "sub/" + name
			}
			if _, link := links[name]; !link {
				continue
			}
			if name != "movie" && name != "chain" && name != "directory" && name != "sub/up" {
				t.Errorf("unsafe link listed: %s", name)
				continue
			}
			info, err := os.Stat(filepath.Join(root, "folder", name))
			if err != nil {
				t.Fatal(err)
			}
			kind := "file"
			if info.IsDir() {
				kind = "directory"
			}
			if e.Type != kind || e.Size != info.Size() || !e.Mtime.Equal(info.ModTime()) {
				t.Errorf("link metadata %s: %+v, want %v", name, e, info)
			}
			found[name] = true
		}
		want := []string{"movie", "chain", "directory"}
		if dir != "" {
			want = []string{"sub/up"}
		}
		for _, name := range want {
			if !found[name] {
				t.Errorf("listing %s missing %s", dir, name)
			}
		}
	}
}

func TestSingleFileCreationBoundary(t *testing.T) {
	a, root, _ := fixture(t)
	c := login(t, a)
	for name, target := range map[string]string{
		"folder/sub/alias.mp4": "movie.mp4", "folder/sub/up": "../active.html", "alias-folder": "folder",
	} {
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	s := create(t, a, c, "folder/sub/alias.mp4", 0)
	for _, tail := range []string{"", "/", "/alias.mp4"} {
		if w := request(a, "GET", "/s/"+s.Token+tail, "", ""); w.Code != 200 || w.Body.String() != "0123456789" {
			t.Errorf("file alias %q: %d %s", tail, w.Code, w.Body.String())
		}
	}
	for _, tail := range []string{"movie.mp4", "up", "../active.html", "alias.mp4/child"} {
		if w := request(a, "GET", "/s/"+s.Token+"/"+tail, "", ""); w.Code != 404 {
			t.Errorf("file token navigated %s: %d", tail, w.Code)
		}
	}
	if w := request(a, "GET", "/api/list?token="+s.Token, "", ""); w.Code != 404 {
		t.Fatal("file token listed siblings", w.Code)
	}
	// Owner can read this link, but a single-file parent Root cannot follow it.
	if w := request(a, "GET", "/files/folder/sub/up", "", c); w.Code != 200 {
		t.Fatal("owner link", w.Code)
	}
	if w := request(a, "POST", "/api/shares", `{"path":"folder/sub/up","seconds":0}`, c); w.Code != 400 {
		t.Fatal("created unusable parent-escaping file share", w.Code)
	}
	folder := create(t, a, c, "alias-folder", 0)
	if w := request(a, "GET", "/s/"+folder.Token+"/sub/movie.mp4", "", ""); w.Code != 200 {
		t.Fatal("folder alias", w.Code)
	}
	if err := os.Remove(filepath.Join(root, "folder/sub/alias.mp4")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "folder/sub/alias.mp4"), 0700); err != nil {
		t.Fatal(err)
	}
	if w := request(a, "GET", "/s/"+s.Token, "", ""); w.Code != 404 {
		t.Fatal("file token served replacement directory", w.Code)
	}
}

func TestLiveShareAnchors(t *testing.T) {
	for _, kind := range []string{"file-sibling", "file-escape", "directory", "ancestor", "outside-root"} {
		t.Run(kind, func(t *testing.T) {
			a, root, db := fixture(t)
			c := login(t, a)
			target, anchor, link := "folder/sub/movie.mp4", "folder/sub/movie.mp4", "peer.mp4"
			tail, body, code := "movie.mp4", "replacement", 200
			switch kind {
			case "file-escape":
				link, code = "../../outside.txt", 404
			case "directory":
				target, anchor, link, tail, body = "folder", "folder", ".", "outside.txt", "private"
			case "ancestor":
				anchor, link = "folder/sub", "."
			case "outside-root":
				target, anchor, link, tail, code = "folder", "folder", t.TempDir(), "outside.txt", 404
			}
			for _, name := range []string{"folder/sub/peer.mp4", "folder/movie.mp4"} {
				if err := os.WriteFile(filepath.Join(root, name), []byte("replacement"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "outside-root" {
				if err := os.WriteFile(filepath.Join(link, tail), []byte("outside secret"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			s := create(t, a, c, target, 0)
			if err := os.Rename(filepath.Join(root, anchor), filepath.Join(root, anchor+"-old")); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(link, filepath.Join(root, anchor)); err != nil {
				t.Fatal(err)
			}
			for _, restart := range []bool{false, true} {
				if restart {
					a.close()
					var err error
					a, err = newApp(root, db, "owner", a.passwordHash, "https://files.test", nil)
					if err != nil {
						t.Fatal(err)
					}
					defer a.close()
				}
				w := request(a, "GET", "/s/"+s.Token+"/"+tail, "", "")
				if w.Code != code || (code == 200 && w.Body.String() != body) {
					t.Errorf("restart=%v: status=%d body=%q", restart, w.Code, w.Body.String())
				}
				if s.Directory {
					w := request(a, "GET", "/api/list?token="+s.Token, "", "")
					if w.Code != code || (code == 200 && !strings.Contains(w.Body.String(), `"name":"outside.txt"`)) {
						t.Errorf("restart=%v listing: %d %s", restart, w.Code, w.Body.String())
					}
				}
			}
		})
	}
}

func TestNonblockingSpecialFiles(t *testing.T) {
	if os.Getenv("FILESHARE_FIFO_TEST") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestNonblockingSpecialFiles$", "-test.v")
		cmd.Env = append(os.Environ(), "FILESHARE_FIFO_TEST=1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("FIFO checks blocked or failed: %v (deadline=%v)\n%s", err, ctx.Err(), out)
		}
		return
	}
	a, root, _ := fixture(t)
	c := login(t, a)
	s := create(t, a, c, "folder", 0)
	file := create(t, a, c, "folder/sub/movie.mp4", 0)
	if err := syscall.Mkfifo(filepath.Join(root, "folder/pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("pipe", filepath.Join(root, "folder/pipe-link")); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"pipe", "pipe-link"} {
		for _, target := range []string{
			"/files/folder/" + name, "/s/" + s.Token + "/" + name,
			"/api/list?path=folder/" + name, "/api/list?token=" + s.Token + "&path=" + name,
		} {
			t.Log(target)
			if w := request(a, "GET", target, "", c); w.Code != 404 {
				t.Fatal("special file accepted", target, w.Code)
			}
		}
		if w := request(a, "POST", "/api/shares", `{"path":"folder/`+name+`","seconds":0}`, c); w.Code != 400 {
			t.Fatal("special share created", w.Code)
		}
	}
	w := request(a, "GET", "/api/list?token="+s.Token, "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), `"name":"pipe`) {
		t.Fatal("special file listed", w.Code, w.Body.String())
	}
	for _, name := range []string{"folder/sub/movie.mp4", "folder"} {
		if err := os.Rename(filepath.Join(root, name), filepath.Join(root, name+"-old")); err != nil {
			t.Fatal(err)
		}
		if err := syscall.Mkfifo(filepath.Join(root, name), 0600); err != nil {
			t.Fatal(err)
		}
		for _, target := range []string{"/s/" + file.Token, "/s/" + s.Token + "/", "/api/list?token=" + s.Token} {
			// The folder remains valid until its own replacement.
			if name != "folder" && !strings.HasPrefix(target, "/s/"+file.Token) {
				continue
			}
			t.Log(target)
			if w := request(a, "GET", target, "", ""); w.Code != 404 {
				t.Fatal("replaced FIFO anchor accepted", target, w.Code)
			}
		}
	}
	for _, name := range []string{"folder", "folder-link"} {
		if name == "folder-link" {
			if err := os.Symlink("folder", filepath.Join(root, name)); err != nil {
				t.Fatal(err)
			}
			// A saved folder symlink to a FIFO must fail too.
			if _, err := a.db.Exec("UPDATE shares SET path=? WHERE token=?", name, s.Token); err != nil {
				t.Fatal(err)
			}
			if w := request(a, "GET", "/api/list?token="+url.QueryEscape(s.Token), "", ""); w.Code != 404 {
				t.Fatal("FIFO symlink anchor", w.Code)
			}
		}
		t.Log("startup root", name)
		other, err := newApp(filepath.Join(root, name), filepath.Join(t.TempDir(), "unused.db"), "owner", a.passwordHash, "https://files.test", nil)
		if err == nil {
			other.close()
			t.Fatal("FIFO startup root accepted")
		}
	}
}
