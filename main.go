package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
)

//go:embed index.html
var ui []byte

func main() {
	listen := flag.String("listen", ":8080", "HTTP listen address (TLS terminates at proxy)")
	root := flag.String("root", "/data", "read-only file root")
	database := flag.String("database", "/state/shares.db", "SQLite state path")
	auth := flag.String("auth", "/config/auth.json", "owner credentials JSON: username, password_hash")
	origin := flag.String("origin", "", "external HTTPS origin (required)")
	hashPassword := flag.Bool("hash-password", false, "hash password read from stdin; outputs only bcrypt hash")
	healthcheck := flag.Bool("healthcheck", false, "check local HTTP readiness")
	flag.Parse()
	if *hashPassword {
		b, err := io.ReadAll(io.LimitReader(os.Stdin, 74))
		if err != nil {
			log.Fatal("cannot read password")
		}
		password := strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r")
		if len(password) < 12 || len(password) > 72 {
			log.Fatal("password must be 12–72 bytes")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			log.Fatal("hash failed")
		}
		fmt.Println(string(hash))
		return
	}
	if *healthcheck {
		client := http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get("http://127.0.0.1:8080/healthz")
		if err != nil {
			os.Exit(1)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	b, err := os.ReadFile(*auth)
	if err != nil {
		log.Fatal("cannot read owner credentials")
	}
	var credentials struct {
		Username string `json:"username"`
		Hash     string `json:"password_hash"`
	}
	if json.Unmarshal(b, &credentials) != nil {
		log.Fatal("invalid owner credentials JSON")
	}
	a, err := newApp(*root, *database, credentials.Username, credentials.Hash, *origin, ui)
	if err != nil {
		log.Fatal("startup failed: ", err)
	}
	defer a.close()
	srv := http.Server{Addr: *listen, Handler: a, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 16384}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Print("file-share ready")
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
