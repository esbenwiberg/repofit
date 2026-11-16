# 0009: Keep structural discovery incremental and advisory

## Decision

`repofit analyze` is an explicitly invoked, unscored JSON analysis. It records
lexical TypeScript/C# facts behind language-independent symbols, calls,
dependencies, annotations and structural behavior. Recurring implementation
groups have no closed business-category taxonomy; unnamed module code can join
through shared calls. A difference is a candidate, never a preferred pattern.
Explicit repository policy is evaluated before heuristic discovery. No majority
vote establishes correctness. Existing probe IDs, bands, baseline handling and
default checks remain unchanged. The single new scored probe is opt-in and
assesses only explicitly selected, declared lexical restrictions.

Source collection records a manifest independent of the older 5000-file size
sample, including excluded, partial/unparsed and truncated paths. Facts persist
under `.repofit/cache/structural-index.json`; unchanged size/mtime/ctime avoids
reading source again. `--rehash` bypasses that metadata assumption. File changes,
adds/deletes/renames, adapter versions and transitive local-import dependencies
invalidate evidence; any indexed contract declaration invalidates all affected
packet keys conservatively. Rule/group/prompt/model versions participate in judge
cache keys. Package, compiler, framework, overload and alias semantics remain
unknown; these adapters do not claim full parsing or type resolution.

All cost bounds are visible: 256 KiB/file, 10000 eligible files, 32 MiB cold
content, 24 MiB serialized facts, 100000 grouping memberships, 32 packets of at
most 16000 UTF-8 bytes, <=4 variants/packet. Coverage reports omissions. The
fallback walk caps enumeration at 50000 paths and explicitly reports incomplete
coverage; excluded dependency/build/cache directories are not recursively listed.

The ordinary gatherer is lazy and read-only. Only `analyze` persists the index.
Model review requires `--judge` and uses the existing judge transport/cache with
validated structured related locations. Repository text is untrusted evidence,
never a source of executable commands or model instructions.

Known-valid and known-invalid enforcement experiments require `--experiment`
and explicit repository-authored fixtures/argv/rejection diagnostic. They run
with bounded time/output in independent byte/mode-preserving disposable snapshots; `{repo}` always means the
snapshot, `{fixture}` an independent temporary example. No dependency install is
performed. Copied inputs, original source content and HEAD/index integrity are checked; mutation invalidates proof. POSIX process groups terminate descendants; Windows and symlink/submodule snapshots are currently unsupported. Configured, attempted execution, accepted legitimate input and
rejected invalid input remain distinct. Checkers are trusted executable code:
a copied working directory is **not an OS sandbox** and cannot contain a
malicious checker with absolute filesystem/network access. RepoFit itself does
not write original source, and tests verify snapshot-local mutation. Static
probes never run experiments or descriptor commands.

`.agent/verification.json` schema 1 is a neutral declaration exported from an
existing QA configuration. Feature expectation provenance separates requirements,
accepted behavior and hypotheses. Start/reset/seed/inspect/fault applicability is
not a universal checklist; undeclared abilities and observed success stay unknown.
There is no runtime dependency on Auto-QA or Hindsight.

## Consequences

A cold scan reads bounded source once; warm scans still enumerate/stat paths.
Metadata reuse is fast, not a cryptographic change detector. Facts include bounded
source/comment excerpts, so treat the local cache/report like source and keep it
out of version control. Judged findings remain advisory and are not execution
proof. Exact spelling restrictions can expose consistently bad practice when the
repository declares it, without inferring policy from prevalent implementations.
