package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
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

func TestCLIMainHelper(t *testing.T) {
	if os.Getenv("FILE_SHARE_TEST_MAIN") != "1" {
		return
	}
	os.Args = append([]string{"file-share"}, os.Args[3:]...)
	main()
	os.Exit(0)
}

func cliCommand(t *testing.T, args ...string) *exec.Cmd {
	t.Helper()
	cmd := exec.CommandContext(t.Context(), os.Args[0], append([]string{"-test.run=^TestCLIMainHelper$", "--"}, args...)...)
	cmd.Env = append(os.Environ(), "FILE_SHARE_TEST_MAIN=1")
	return cmd
}

func TestCLIVersion(t *testing.T) {
	out, err := cliCommand(t, "-version").CombinedOutput()
	if err != nil || string(out) != "file-share dev (unknown)\n" {
		t.Fatalf("version without config: %v: %s", err, out)
	}
}

func TestCLIHashPassword(t *testing.T) {
	for _, test := range []struct {
		name, password, ending string
		valid                  bool
	}{
		{"minimum", strings.Repeat("x", 12), "", true},
		{"maximum", strings.Repeat("x", 72), "", true},
		{"minimum-LF", strings.Repeat("x", 12), "\n", true},
		{"maximum-LF", strings.Repeat("x", 72), "\n", true},
		{"minimum-CRLF", strings.Repeat("x", 12), "\r\n", true},
		{"maximum-CRLF", strings.Repeat("x", 72), "\r\n", true},
		{"UTF8-byte-minimum", strings.Repeat("é", 6), "", true},
		{"short", strings.Repeat("x", 11), "\n", false},
		{"long", strings.Repeat("x", 73), "", false},
		{"UTF8-byte-overflow", strings.Repeat("é", 37), "", false},
		{"trailing-input", strings.Repeat("x", 72), "\r\nignored-tail", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			cmd := cliCommand(t, "-hash-password")
			cmd.Stdin = strings.NewReader(test.password + test.ending)
			out, err := cmd.CombinedOutput()
			if !test.valid {
				if err == nil || !bytes.Contains(out, []byte("password must be 12–72 bytes")) {
					t.Fatalf("expected password length rejection; exit error: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("hash command failed: %v", err)
			}
			if err := bcrypt.CompareHashAndPassword(bytes.TrimSpace(out), []byte(test.password)); err != nil {
				t.Fatalf("output does not hash full input: %v", err)
			}
		})
	}
}

func TestCLIShutdown(t *testing.T) {
	for _, test := range []struct {
		name   string
		signal os.Signal
		drain  bool
	}{{"SIGTERM-drain", syscall.SIGTERM, true}, {"interrupt-drain", os.Interrupt, true}, {"deadline", syscall.SIGTERM, false}} {
		t.Run(test.name, func(t *testing.T) {
			a, root, db := fixture(t)
			const size = 64 << 20
			f, err := os.Create(filepath.Join(root, "large.bin"))
			if err != nil {
				t.Fatal(err)
			}
			err = f.Truncate(size)
			f.Close()
			if err != nil {
				t.Fatal(err)
			}
			s := create(t, a, login(t, a), "large.bin", 0)
			credentials, err := json.Marshal(map[string]string{"username": a.username, "password_hash": a.passwordHash})
			if err != nil {
				t.Fatal(err)
			}
			a.close()
			auth := filepath.Join(t.TempDir(), "auth.json")
			if err := os.WriteFile(auth, credentials, 0600); err != nil {
				t.Fatal(err)
			}
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			address := listener.Addr().String()
			listener.Close()
			cmd := cliCommand(t, "-listen", address, "-root", root, "-database", db, "-auth", auth, "-origin", "https://files.test")
			var logs bytes.Buffer
			cmd.Stderr = &logs
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan struct{})
			var exitErr error
			go func() { exitErr = cmd.Wait(); close(done) }()
			t.Cleanup(func() {
				cmd.Process.Kill()
				<-done
			})
			client := &http.Client{Timeout: time.Second}
			defer client.CloseIdleConnections()
			readyDeadline := time.After(10 * time.Second)
			ticker := time.NewTicker(10 * time.Millisecond)
			defer ticker.Stop()
			for {
				resp, err := client.Get("http://" + address + "/healthz")
				if err == nil {
					resp.Body.Close()
					if resp.StatusCode == http.StatusOK {
						break
					}
				}
				select {
				case <-done:
					t.Fatalf("server exited before readiness: %v; %s", exitErr, logs.String())
				case <-readyDeadline:
					t.Fatal("server readiness timed out")
				case <-ticker.C:
				}
			}
			conn, err := net.DialTimeout("tcp", address, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			if err := conn.(*net.TCPConn).SetReadBuffer(64 << 10); err != nil {
				t.Fatal(err)
			}
			conn.SetDeadline(time.Now().Add(40 * time.Second))
			req, _ := http.NewRequest("GET", "http://"+address+"/s/"+s.Token+"/large.bin", nil)
			if err := req.Write(conn); err != nil {
				t.Fatal(err)
			}
			resp, err := http.ReadResponse(bufio.NewReader(conn), req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK || resp.ContentLength != size {
				t.Fatalf("download response: status=%d length=%d", resp.StatusCode, resp.ContentLength)
			}
			if _, err := io.ReadFull(resp.Body, make([]byte, 1)); err != nil {
				t.Fatal(err)
			}
			started := time.Now()
			if err := cmd.Process.Signal(test.signal); err != nil {
				t.Fatal(err)
			}
			if test.drain {
				n, err := io.Copy(io.Discard, resp.Body)
				if err != nil || n != size-1 {
					t.Fatalf("shutdown truncated transfer: bytes=%d want=%d error=%v", n, size-1, err)
				}
			}
			select {
			case <-done:
			case <-time.After(35 * time.Second):
				t.Fatal("shutdown exceeded grace period")
			}
			if exitErr != nil {
				t.Fatalf("server exit: %v; %s", exitErr, logs.String())
			}
			if !test.drain && (time.Since(started) < 29*time.Second || !strings.Contains(logs.String(), "context deadline exceeded")) {
				t.Fatalf("shutdown did not honor/log drain deadline: elapsed=%v logs=%s", time.Since(started), logs.String())
			}
		})
	}
}
