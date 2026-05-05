# agentry

[![ci](https://github.com/esbenwiberg/agentry/actions/workflows/ci.yml/badge.svg)](https://github.com/esbenwiberg/agentry/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> Form your agentic readiness.

`agentry` is a tool-agnostic CLI that helps any repo become **agent-ready** —
better context, conventions, specs, fitness checks, and workflow harness for
AI coding agents (Claude Code, Cursor, Aider, Codex, your own).

It is opinionated about one thing: **most agentic readiness can't just be
installed.** A nested `CLAUDE.md`, an ADR, a spec — those have to be
*authored* against your code. So `agentry` runs a scan-driven loop: it
collects deterministic evidence, hands it to your agent with a brief, and
verifies the result by re-scanning. Byte-perfect team artifacts ride a
small overlay/lockfile lifecycle on the side.

No `init`, no plugins-as-runtime, no daemon, no marketplace.

---

## Quickstart

```bash
# Try it without installing
npx agentry scan        # deterministic evidence into .agentry/scan/<ts>/
npx agentry brief       # writes .agentry/scan/<ts>/instructions.md
```

Hand `instructions.md` to your coding agent. The brief inlines the
practice library and points at every gatherer output, so the agent has
everything it needs to author per-repo files (CLAUDE.md, ADRs, specs,
fitness checks) and *you* re-scan to verify.

Install globally if you'll use it across many repos:

```bash
npm install -g agentry
agentry --help
```

> **Note** — agentry is not yet published to npm. Until the first release,
> install from source: `git clone … && npm install && npm run build && npm link`.

---

## Verbs

| Verb | Posture | What it does |
|---|---|---|
| `agentry scan` | Audit | Deterministic evidence bundle: stack, git, hygiene, security, agent-readiness, docs, fitness, catalog. Read-only. Works on any repo. |
| `agentry brief` | Author handoff | Emits an `instructions.md` against the latest scan — bundle pointers, reading rules, fitness warnings, inlined practice library. |
| `agentry list` | Browse | Shows the merged catalog (bundled practices + overlays). |
| `agentry add <id>` | Install | Drops in byte-perfect overlay artifacts. Lockfile-tracked, conflict-aware (keep / overwrite / diff / skip). |
| `agentry upgrade [id]` | Refresh | Refreshes installed artifacts from the merged catalog. |
| `agentry upgrade --check` | CI gate | Reports drift (`missing` / `out-of-date` / `user-edit` / `orphaned`). Exits 1 on any drift. Replaces the old `doctor` verb. |
| `agentry remove <id>` | Uninstall | Deletes installed files and prunes the lockfile. |
| `agentry coach <kind>` | Author | Bespoke scaffolding without the full scan loop. |

`coach` kinds: `claude-md` (with `--nested <subdir>`), `practices`,
`agent-profile`, `adr-init` / `adr <slug>`, `spec-init` / `spec <slug>`.

Run `agentry --help` for the full flag surface.

---

## How the loop fits together

```
   ┌─────────────┐    ┌────────────┐    ┌────────────────┐
   │ agentry     │───▶│ agentry    │───▶│ your coding    │
   │ scan        │    │ brief      │    │ agent authors  │
   │ (evidence)  │    │ (handoff)  │    │ files          │
   └─────────────┘    └────────────┘    └────────────────┘
          ▲                                     │
          │             re-scan to verify       │
          └─────────────────────────────────────┘

   ┌─────────────┐    ┌────────────┐    ┌────────────────┐
   │ agentry add │───▶│ lockfile   │───▶│ agentry        │
   │ <overlay>   │    │ tracks it  │    │ upgrade --check│
   └─────────────┘    └────────────┘    └────────────────┘
```

Two paths, one tool. The scan/brief/agent loop covers what has to be
*authored*; the overlay lifecycle covers what should be *installed*.

---

## What `scan` produces

```
.agentry/scan/2026-05-05T14-34-36Z/
  manifest.json           # gatherer status, durations, outputs
  catalog.json            # merged catalog snapshot (bundled + overlays)
  instructions.md         # produced by `agentry brief`
  structure/              # tree, languages, manifests
  git/                    # stats, commit messages, hot files, PR samples
  hygiene/                # LICENSE, README, CI coverage, linters, gitignore audit
  security/               # secrets-suspects, committed-keys, lockfile age, audit
  agent-readiness/        # CLAUDE.md / ADRs / specs / configs inventory
  docs/                   # README head, root headings, claude-md
  practices/              # bundled practice docs, copied verbatim
```

Bundles are deterministic and diffable. Don't commit them — add
`.agentry/` to `.gitignore` for the target repo.

---

## CI: the drift gate

```yaml
- run: npx agentry upgrade --check
```

Exits non-zero on any drift across installed artifacts. Run it in pull
requests after the team has used `agentry add` to install overlays.

---

## The three-layer opinion model

| Layer | Owns | Form |
|---|---|---|
| Bundled catalog | Universal practices | Markdown guidance docs (read-only, agent adapts them). |
| Overlays | Team-canonical artifacts + practice overrides | Byte-perfect files registered via `agentry.overlays.toml`. |
| Scan + brief + agent | Per-repo tailoring | The user's coding agent authors files; re-scan verifies. |

The bundled catalog ships **practices**. **Overlays** ship byte-perfect
team artifacts. **Re-scan** is the verification contract. See
[ADR-0005](docs/adr/0005-scan-driven-core-catalog-as-practices.md) for
the locked design and [`docs/overlays.md`](docs/overlays.md) for the
overlay author guide.

---

## Status

Pre-release (v0.0.0). Scan + brief MVP shipped, `upgrade --check` drift
gate is the CI contract, bundled catalog is practice-only. 132 tests
across the verb surface and unit layer (≈5s). TeamPlanner round-trip
dogfood and CHANGELOG generation from `.changes/` fragments are
deferred — see [`docs/STATUS.md`](docs/STATUS.md).

---

## Development

```bash
npm install
npm run typecheck
npm run build
npm test           # builds via pretest, then runs vitest
```

Test conventions live in [`specs/test-suite/`](specs/test-suite/).
Contributor conventions live in [`PRACTICES.md`](PRACTICES.md). Locked
architectural decisions live in [`docs/adr/`](docs/adr/); open design
notes in [`docs/decisions/`](docs/decisions/).

agentry uses its own conventions on itself — `.agent.toml`, `.githooks/`,
`.changes/` fragments, `docs/adr/`. The repo is its own dogfood.

---

## Why

Over the last few weeks of building TeamPlanner, the highest-leverage
changes for agentic coding quality weren't framework or model upgrades —
they were *infrastructure*: nested context files, ADR conventions,
declarative agent profiles, fitness tests, drift checks, lazy startup
scripts. `agentry` extracts those patterns into a generic, tool-agnostic
CLI so any repo can adopt them in minutes.

---

## License

MIT — see [LICENSE](LICENSE).
