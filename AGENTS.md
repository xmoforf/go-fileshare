# Project workflow

Independent Linux Go file-sharing server. Never mutate `/srv/docker` or copy its live credentials/state as part of work here. Deployment, remotes and push require separate approval.

## Workflow

Use Beads as canonical work state: `bd prime`, `bd ready`, `bd show <id>`, then `agnt work direct-start <id> --claim`. Read applicable Pi skills. Save plans in `.pi/plans/`. Verify and commit task-owned changes before `agnt work direct-closeout <id> --outcome success --reason "..."`. Preserve unfinished work with `handoff_bead`; never close unfinished tasks.

No hooks or remotes are installed. Initialized with bd 1.2.2 (host Pi checklist targets 1.3.1: compatibility drift, not grounds to auto-upgrade). Auto-export is disabled; closeout explicitly exports/verifies portable `.beads/issues.jsonl`. Dolt is canonical; JSONL is interchange, not a history backup. Preserve tracked audit rows. Do not migrate Beads or install hooks automatically.

## Environment

`nix develop` supplies Go 1.27.3, GCC and Git. Linux `openat2` is mandatory. Keep `.envrc`, `flake.nix` and `flake.lock` tracked; local env, credentials and state stay ignored. Nix source selection includes only Go source/tests, module files and embedded HTML.

## Verification

```sh
nix develop -c go test -race ./...
nix develop -c go vet ./...
nix build
nix flake check
```

## Documentation

Keep `README.md` current for CLI/configuration/security changes and `CONTRIBUTING.md` current for developer workflow. No production data in tests. Keep origin checks, path confinement and error handling intact. No automatic deploy, push, branch deletion, merge or history rewrite.
