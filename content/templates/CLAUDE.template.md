# <PROJECT_NAME>

> Replace this with a one-line description of what the project is and
> who uses it. Example: *"Resource planning app for project managers.
> .NET backend, React frontend."*

> Then delete this quote-block.

## Architecture

> One or two sentences. Name the shape (Hexagonal / Clean / MVC /
> Layered / Microservices), the major layers/services, and any key
> framework. Link to deeper docs if they exist.

> Example: *"Clean Architecture: Domain → Application → Infrastructure →
> API. Frontend talks to API via REST + WebSockets. See
> `docs/architecture-overview.md`."*

## Key conventions

> 3–6 bullets. The non-obvious ones a new contributor needs to know on
> day one. Don't restate what the language teaches.

- > *Example: "Async all the way; no blocking I/O on the request path."*
- > *Example: "Never mutate cached objects — clone before write. See
  > `docs/caching-rules.md`."*
- > *Example: "All user-facing strings go through `i18n.t()` with a
  > translation key."*

## Build & test

```bash
# Replace with the project's actual commands.
<build command>            # e.g., dotnet build / npm install && npm run build / cargo build
<test command>             # e.g., dotnet test / npm test / cargo test
<dev / serve command>      # e.g., npm run dev / make serve
```

## Commands

> If the project ships slash-commands (via `.claude/commands/`), list
> them here as a quick reference. Drop this section if it doesn't.

| Command | Description |
|---|---|
| `/commit` | Analyse changes and suggest commits |
| `/review` | Structured code review |
| `/pr` | Open a pull request |

## Where to find things

| What | Where |
|---|---|
| Skills (workflow instructions) | `.claude/skills/` |
| Rules (always-loaded) | `.claude/rules/` |
| Architectural decisions | `docs/adr/` |
| Open design notes | `docs/decisions/` |
| Conventions for contributors | `PRACTICES.md` |
| Per-subsystem context | `<subdir>/CLAUDE.md` |

> Add or remove rows so the table reflects this repo's reality. Don't
> claim files that don't exist.

## Critical rules

> Project-specific rules an agent must NEVER break. Keep this section
> short — three rules max. Cite them if they have a deeper spec.

- > *Example: "Never edit `CHANGELOG.md` directly — it's generated from
  > fragments in `.changes/`."*
- > *Example: "All public API changes require an ADR before merge."*
- > *Example: "PII is never logged — use the `redactPII()` helper."*
