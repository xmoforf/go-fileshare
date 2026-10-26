package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReplacedShareAnchorsRejectSymlinks(t *testing.T) {
	for _, kind := range []string{"file", "directory", "ancestor"} {
		t.Run(kind, func(t *testing.T) {
			a, root, _ := fixture(t)
			c := login(t, a)
			target := "folder/sub/movie.mp4"
			if kind == "directory" {
				target = "folder"
			}
			s := create(t, a, c, target, 0)
			if kind == "file" {
				if err := os.Remove(filepath.Join(root, target)); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("../../outside.txt", filepath.Join(root, target)); err != nil {
					t.Fatal(err)
				}
			} else {
				anchor := "folder"
				if kind == "ancestor" {
					anchor = "folder/sub"
				}
				if err := os.Rename(filepath.Join(root, anchor), filepath.Join(root, anchor+"-old")); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(".", filepath.Join(root, anchor)); err != nil {
					t.Fatal(err)
				}
				if kind == "ancestor" {
					if err := os.WriteFile(filepath.Join(root, "folder/movie.mp4"), []byte("unshared"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			tail := "movie.mp4"
			if kind == "directory" {
				tail = "outside.txt"
			}
			if w := request(a, "GET", "/s/"+s.Token+"/"+tail, "", ""); w.Code != 404 {
				t.Fatalf("symlink widened %s scope: status=%d body=%s", kind, w.Code, w.Body.String())
			}
			if kind == "directory" {
				if w := request(a, "GET", "/api/list?token="+s.Token, "", ""); w.Code != 404 {
					t.Fatal("replaced folder listing allowed", w.Code)
				}
			}
		})
	}
}
