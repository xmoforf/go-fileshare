package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestCLIRequiresExplicitOrigin(t *testing.T) {
	if os.Getenv("FILE_SHARE_TEST_HELP") == "1" {
		os.Args = []string{"file-share", "-h"}
		main()
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestCLIRequiresExplicitOrigin$")
	cmd.Env = append(os.Environ(), "FILE_SHARE_TEST_HELP=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("help: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "external HTTPS origin (required)") || strings.Contains(string(out), "st5ve.com") {
		t.Fatalf("origin must be explicit, not installation-specific:\n%s", out)
	}
}
