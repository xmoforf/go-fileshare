package main

import (
	"fmt"
	"net/http/httptest"
	"os"
	"os/signal"
	"syscall"
	"testing"
)

// Explicit opt-in synthetic browser fixture; never mounts production files or state.
func TestBrowserFixture(t *testing.T) {
	if os.Getenv("FILE_SHARE_BROWSER_FIXTURE") != "1" {
		t.Skip("interactive browser fixture")
	}
	a, _, _ := fixture(t)
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
