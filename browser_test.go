package main

import (
	"fmt"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
)

// Explicit opt-in synthetic browser fixture; never mounts production files or state.
func TestBrowserFixture(t *testing.T) {
	mode := os.Getenv("FILE_SHARE_BROWSER_FIXTURE")
	if mode != "1" && mode != "large" {
		t.Skip("interactive browser fixture")
	}
	a, root, _ := fixture(t)
	if err := os.Mkdir(filepath.Join(root, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(root, "folder/sub"), filepath.Join(root, "folder/sub &\"'<>#?%é")); err != nil {
		t.Fatal(err)
	}
	count := 205
	if mode == "large" {
		count = 99997 // Together with the three fixture entries: 100,000.
	}
	for i := 0; i < count; i++ {
		name := filepath.Join(root, "folder", fmt.Sprintf("item-%03d.txt", i))
		if err := os.WriteFile(name, []byte("synthetic browser fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	a.ui = ui
	server := httptest.NewTLSServer(a)
	defer server.Close()
	a.origin = server.URL
	fmt.Println("BROWSER_FIXTURE_URL=" + server.URL)
	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGTERM, os.Interrupt)
	defer signal.Stop(done)
	<-done
}
