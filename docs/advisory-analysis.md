# Advisory repository analysis

```sh
repofit analyze > analysis.json           # deterministic; no model or repo commands
repofit analyze --rehash                  # force byte reads instead of metadata reuse
repofit analyze --no-cache                # rehash without persisting this scan
repofit analyze --judge                   # optional existing LLM judge; may incur cost
repofit analyze --experiment              # trusted explicit valid/invalid checkers only
```

The JSON separates explicit policy matches, descriptive suppressions/examples,
heuristic recurring implementation groups, optional judged contradictions,
coverage and verification declarations. Candidate differences are unscored.
Neither the commonest variant nor a model's opinion proves correctness. A
comment explaining a suppression is useful context; it never automatically
waives a RepoFit finding.

## Declare scoped lexical policies

Commit `repofit.policy.json`:

```json
{
  "version": 1,
  "rules": [
    {
      "id": "authenticated-client",
      "kind": "restricted-call",
      "scope": ["src/**"],
      "match": "fetch",
      "allowed": ["src/http/client.ts"],
      "replacement": "client.request",
      "rationale": "Route application requests through central authentication.",
      "documentation": ["docs/http.md"]
    },
    {
      "id": "no-private-data-imports",
      "kind": "module-boundary",
      "scope": ["src/ui/**"],
      "match": "private-data/**",
      "rationale": "UI imports public service contracts."
    }
  ]
}
```

`scope`/`allowed` match repository paths. `match` matches lexical call/import
names; `*` matches within a segment and `**` spans segments. Module boundaries
match import spellings, not a compiler-resolved dependency graph. Restricted
imports use `restricted-import`. `required-call` absence is advisory/unknown,
because aliases, injected behavior and dynamic calls can implement a contract.
Unrecognized rule kinds/configuration are reported unknown, never accepted as
success. These rules do not ban comments or particular APIs globally.

For an explicitly selected score of declared restrictions:
`repofit check --probe arch.declared-policy-assessment`. It is N/A without a
valid policy. Discovery and readiness do not contribute fitness penalties.

## Probe an enforcement command

Add an experiment to the same policy file:

```json
{
  "id": "boundary-rejection",
  "argv": ["node", "{repo}/tools/check-example.mjs", "{fixture}"],
  "valid": { "path": "example.ts", "content": "import x from 'public-service';" },
  "invalid": { "path": "example.ts", "content": "import x from 'private-data/client';" },
  "expectedDiagnostic": "no-private-data-imports",
  "timeoutMs": 10000
}
```

This object belongs in `experiments: [...]` beside `rules`. The checker must
accept a file path and actually assess that example. Default analysis only
reports configured status. `--experiment` makes a bounded source snapshot
(without dependencies/build output/git metadata), runs each example in its own
temporary working directory, and preserves execution diagnostics. Each case uses an independent identical snapshot, preserving binary bytes and executable modes. Input/source content and original git HEAD/index integrity are checked; mutation invalidates proof. An invalid
example counts as rejected only for a nonzero, non-timeout exit containing the
explicit diagnostic. A successful legitimate example is a separate required
observation when judging whether an enforcement command works.

The configured checker is trusted code, not model output. The snapshot is not
an OS sandbox: a malicious checker can still access absolute paths/network.
RepoFit performs no original-source mutation or dependency install. Missing
snapshot dependencies, command failures and timeouts remain evidence gaps;
configuration alone is not enforcement proof. POSIX process-group cleanup bounds descendants; experiments are currently unsupported on Windows, and symlink/submodule snapshots are reported unknown. Maximum16 experiments,30 seconds
per invocation,32MiB/10000 snapshot files; output diagnostics are bounded.

## Share feature and app-control declarations

An optional `.agent/verification.json` uses this neutral shape; export it from
your existing QA configuration rather than maintaining a second source of truth:

```json
{
  "schema": 1,
  "source": { "tool": "auto-qa", "config": ".auto-qa/config.json" },
  "features": [{
    "id": "checkout", "name": "Checkout", "aliases": ["purchase"],
    "paths": ["src/checkout/**"], "invariants": ["cart total is preserved"],
    "expectationSource": { "kind": "requirement", "reference": "specs/checkout.md" }
  }],
  "capabilities": {
    "start": { "command": ["npm", "run", "dev"], "status": "declared" },
    "reset": { "url": "http://localhost:3000/test/reset", "method": "POST", "status": "declared" }
  }
}
```

Expectation kind is `requirement`, `accepted` or `hypothesis`. Capabilities may
include start/reset/seed/inspect/fault; applicable commands/HTTP(S) URLs are
validated but never executed by this reader. The exact `{port}` placeholder is preserved; a benign port substitution is used only for URL syntax validation. Missing controls are unknown, not
a universal defect. Observed readiness remains empty; declared success is never
inferred. Auto-QA's exporter is optional and RepoFit has no package dependency
on Auto-QA.

## Limits and cache

TypeScript/JavaScript and C# adapters are lexical. Aliases, overloads, dynamic
calls, framework behavior, expression-only lambdas, templates/interpolation and
ambiguous slash expressions can be incomplete. A syntax match is evidence of a
spelling, not proof of semantic behavior. Markdown/configuration/shell lines
support example and bypass review. Unsupported languages/frameworks are unknown.
Scoped guides/comments and related implementations form bounded evidence
packets; optional judge findings must cite supplied locations. They remain
advisory interpretations and may miss contradictions.

The full git manifest includes tracked and unignored untracked paths; without
git, a bounded filesystem walk excludes dependencies/build/cache directories.
Unlike size probes, it does not silently truncate at5000 files. Included,
excluded, unparsed and truncated coverage and grouping omissions are explicit.
Limits:256KiB/file,10000 indexed files,32MiB cold source,24MiB facts,100000 group
memberships,32 packets of <=16000 bytes and up to4 structural variants. Partial
and excluded material cannot establish absence of a problem.

The CLI stores facts and bounded excerpts under `.repofit/cache/`. Keep local
cache/reports out of git and handle them like source. Unchanged size/mtime/ctime
allows reuse without rereading bytes; `--rehash` handles untrusted timestamps.
Adds, deletes, renames, local dependencies/shared contracts and versioned
adapter/group/rule/prompt/model inputs invalidate relevant cached evidence.
Warm scans still enumerate/stat paths. Use `--no-cache` for an ephemeral scan.
