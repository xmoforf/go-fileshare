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
	if os.Getenv("FILE_SHARE_BROWSER_FIXTURE") != "1" {
		t.Skip("interactive browser fixture")
	}
	a, root, _ := fixture(t)
	for i := 0; i < 205; i++ {
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
