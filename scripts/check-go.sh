#!/bin/sh
# Run inside nix develop, or with the Go version declared in go.mod.
set -eu
go mod verify
go test -race -count=1 ./...
go vet ./...
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'
