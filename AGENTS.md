# Project workflow

Independent Linux Go file-sharing server. Never mutate `/srv/docker` or copy its live credentials/state as part of work here. Deployment, remotes and push require separate approval.

## Workflow

Use Beads as canonical work state: `bd prime`, `bd ready`, `bd show <id>`, then `agnt work direct-start <id> --claim`. Read applicable Pi skills. Save plans in `.pi/plans/`. Verify and commit task-owned changes before `agnt work direct-closeout <id> --outcome success --reason "..."`. Preserve unfinished work with `handoff_bead`; never close unfinished tasks.

Beads stays private. Owner-approved local opt-in is `git config --local agnt.beadsCloseout private`; keep `.beads/` untracked and ignored. Closeout must retain ownership, explicit success, canonical/local-export parity and clean-tree checks, but never stage, commit or push Beads data.

No hooks are installed. `origin` is `https://github.com/xmoforf/go-fileshare.git`. Branch/PR CI is check-only; approved `v*` tag pushes trigger gated GHCR and Docker Hub image publication followed by GitHub Release creation, so tag-push approval must include all three publication effects. Existing remote configuration never grants permission for future pushes. Initialized with bd 1.2.2 (host Pi checklist targets 1.3.1: compatibility drift, not grounds to auto-upgrade). Auto-export is disabled; closeout explicitly exports/verifies local ignored `.beads/issues.jsonl`, without a portable-state Git commit. Dolt is canonical; JSONL is interchange, not a history backup. Preserve tracked audit rows. Do not migrate Beads or install hooks automatically.

## Environment

`nix develop` supplies Go 1.27.3, GCC and Git. Filesystem confinement uses `os.Root`; preserve per-folder boundaries, single-file parent boundaries and fixed basenames, live saved-path semantics, and nonblocking special-file rejection. Unix `O_NONBLOCK`/SIGTERM remain; packaging and runtime support stay Linux. Windows is excluded: no runtime claims, tests, or compatibility shims. Keep `.envrc`, `flake.nix` and `flake.lock` tracked; local env, credentials and state stay ignored. Nix source selection includes only Go source/tests, module files, embedded HTML and distribution license/notices.

## Verification

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
```

## Documentation

Keep `README.md` current for CLI/configuration/security changes and `CONTRIBUTING.md` current for developer workflow. No production data in tests. Keep origin checks, path confinement and error handling intact. No automatic deploy, push, branch deletion, merge or history rewrite.
