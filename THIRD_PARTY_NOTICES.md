# Third-party notices and source provenance

## Project source

Project-owned source and embedded HTML/CSS/JavaScript are under the [MIT license](LICENSE), copyright (c) 2026 xmoforf. On 2026-10-26, xmoforf explicitly attested ownership/authorship of the imported Go code and UI, with no copied third-party code or assets beyond declared dependencies, and approved this grant (Bead `go-fileshare-19p.8`, approval `go-fileshare-qvm`). This is an owner attestation, not an independent reconstruction of authorship.

The initial standalone commit `cb4d2fd` imported a snapshot from `/srv/docker/networks/torrent/file-share` at parent commit `0baa81a3718cde53484add65906bee889efc6f75`. Earlier source history was not imported. This repository is independent: no runtime path or symlink points back to that installation. Its credentials, databases, networks, proxy configuration and `stack_test.py` deployment assertions were excluded; the old default hostname was replaced with an explicit `-origin` requirement. Creating or building this repository does not migrate, stop or update that service. No live credentials/state were used for this assessment. The UI uses inline code, system fonts and text symbols, not external scripts, fonts or image assets. Later local changes remain in this repository's Git history.

## Dependencies

Third-party components retain their original licenses; the project MIT grant does not replace them. `licenses/` preserves upstream license files verbatim from the pinned module cache, verified with `go mod verify`, and Go's pinned source archive. The table covers every requirement in `go.mod`, not just packages linked on one platform.

| Component | Version | Terms | Notice directory under `licenses/` |
| --- | --- | --- | --- |
| Go runtime/standard library | 1.27.3 | BSD-3-Clause | `go1.27.3/` |
| golang.org/x/crypto | v0.58.0 | BSD-3-Clause | `golang.org/x/crypto@v0.58.0/` |
| golang.org/x/sys | v0.49.0 | BSD-3-Clause | `golang.org/x/sys@v0.49.0/` |
| modernc.org/sqlite | v1.61.0 | BSD-3-Clause; SQLite public domain | `modernc.org/sqlite@v1.61.0/` |
| modernc.org/libc | v1.79.0 | BSD-3-Clause plus inherited notices | `modernc.org/libc@v1.79.0/` |
| modernc.org/mathutil | v1.7.1 | BSD-3-Clause | `modernc.org/mathutil@v1.7.1/` |
| modernc.org/memory | v1.12.1 | BSD-3-Clause plus inherited notices | `modernc.org/memory@v1.12.1/` |
| github.com/dustin/go-humanize | v1.1.0 | MIT | `github.com/dustin/go-humanize@v1.1.0/` |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause | `github.com/google/uuid@v1.6.0/` |
| github.com/mattn/go-isatty | v0.0.24 | MIT | `github.com/mattn/go-isatty@v0.0.24/` |
| github.com/ncruces/go-strftime | v1.1.0 | MIT | `github.com/ncruces/go-strftime@v1.1.0/` |
| github.com/remyoudompheng/bigfft | v0.0.0-20230129092748-24d4a6f8daec | BSD-3-Clause | `github.com/remyoudompheng/bigfft@v0.0.0-20230129092748-24d4a6f8daec/` |

SQLite's `LICENSE-3RD-PARTY.md` is its upstream inventory, **not this application's dependency inventory**. It is deliberately retained whole, including notices for upstream tools, tests, optional extensions and unlinked modules. In particular, its MPL-2.0 entry does not mean this application links that component. `go list -deps .` on Linux amd64 links the modules above except go-isatty and go-strftime; it does not import sqlite/vec. Recheck other platforms and after upgrades. libc's notices include musl, go-netdb, Go and Nixpkgs; memory includes Go/mmap-go notices and a logo attribution reference. No upstream logo is distributed here.

## Theme palettes

The theme catalog added under `go-fileshare-aas` is separate from the initial project-source attestation above. Ten names were originally selected from [iTerm2-Color-Schemes revision 27cbbb5ee7e98ff15484e7342b07a20606260176](https://github.com/mbadolato/iTerm2-Color-Schemes/tree/27cbbb5ee7e98ff15484e7342b07a20606260176). Its collection MIT license explicitly leaves individual themes under their authors' terms. We verified the author sources below, rather than treating collection metadata as blanket permission. Four named adaptations remain active alongside project-owned Light; removed palette source files and notices remain as historical references.

| UI adaptations | Author source revision | MIT notice under `licenses/themes/` |
| --- | --- | --- |
| Collection selection | `27cbbb5ee7e98ff15484e7342b07a20606260176` | `collection/LICENSE` — Mark Badolato |
| Catppuccin Mocha (active); Latte, Frappe, Macchiato (historical) | [catppuccin/palette](https://github.com/catppuccin/palette/tree/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd) | `catppuccin/LICENSE` — 2021 Catppuccin |
| Nord | [nordtheme/nord](https://github.com/nordtheme/nord/tree/1cef71605416a222e57225b544540ce0fcec18d4) | `nord/LICENSE` — 2016-present Sven Greb |
| Rose Pine, Dawn (active); Moon (historical) | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette/tree/92af52b465ab6e47437aca223c9b8d3009a2023b) | `rose-pine/LICENSE` — mvllow |
| Atom One Dark, Light (historical only) | [atom/atom syntax packages](https://github.com/atom/atom/tree/1c3bd35ce238dc0491def9e1780d04748d8e18af/packages) | `atom-dark/LICENSE`, `atom-light/LICENSE` — 2016 GitHub Inc. |

[Exact provenance](licenses/themes/provenance.json) records retained source URLs/revisions and SHA-256 hashes, plus collection comparisons, author roles and UI adjustments for the four active named themes. Author palette source files and full notices are retained alongside it. Only the five recorded author colors per theme feed the UI; the full source palettes are evidence, not runtime imports. Background/input share a color; raised/hover surfaces blend 4% foreground into background; secondary text/borders use 85%. Accent and status colors are adjusted toward foreground where needed for contrast. Built-in Light remains project-owned with its contrast repairs.

The former Atom adaptations used original syntax colors instead of the collection's terminal-specific adjustments; active Rose Pine Dawn uses author text `#464261` instead of collection `#575279`. Unverified bright ANSI and terminal selection colors are not imported. Gruvbox and TokyoNight were replaced during license review, not redistributed under assumed terms. No upstream executable, CSS file or JavaScript is loaded by the browser. No upstream endorsement is implied.

`index.html` retains the full applicable notices in a comment beside the bundled palette data, so browser responses and embedded binaries also carry them. The notice tree additionally accompanies packaged distributions. Updates are manual and reviewed; see [contributor procedure](CONTRIBUTING.md#updating-themes).

## Redistribution

Carry `LICENSE`, this file and the entire `licenses/` directory alongside source and binary releases. Retain copyright notices, license conditions and disclaimers; BSD terms also prohibit implied endorsement. SQLite's public-domain statement is retained without relabeling it MIT. These permissive dependency terms can coexist with the project's MIT grant.

The Nix package installs notices under `share/doc/file-share/`; the scratch container carries them under `/usr/share/doc/file-share/`. Plain `go build` does not bundle documentation: release archives must include these files separately. Builder OS/tool packages are not copied into the scratch image; a future base-image change needs its own notice assessment. No publication is authorized by this record.

After dependency or Go upgrades, compare linked packages for supported platforms, refresh exact upstream notice copies and this inventory, run `go mod verify`, and verify packaged notices. Do not prune inherited notices solely because a module-level scanner reports them unused.
