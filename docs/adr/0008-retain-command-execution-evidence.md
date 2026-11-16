# 0008 — Retain observed command attempts separately from scores

- Status: Accepted
- Date: 2026-11-16

## Context

Latency probes discard warm-up results and retain a measured magnitude. A failed first attempt can therefore disappear behind a successful measured execution. Scores alone do not establish what ran or how dependable the verification loop was.

## Decision

The command evidence capability optionally exposes snapshots of every attempt it directly executes. Each record carries command arguments, working directory, role, first-observed status, exit/timeout, duration and bounded diagnostics. JSON reports optionally retain these records; human and HTML reports summarize them. Optional fields preserve existing fixtures and third-party corpora. Existing probe scores, bands, defaults and execution counts remain unchanged.

The records are execution evidence, not proof that relevant tests asserted behavior. First observed means the first matching command/cwd/explicit-environment combination during this scan; no clean machine, cold cache or dependency setup is implied. Inherited environment and external state are not fingerprinted. Reports do not expose environment values. Each stream retains at most 4 KiB in the evidence record; ordinary probe command output retains its existing bound.

## Consequences

Warm-up failures remain visible even when scoring uses a successful measured run. Static scans record an empty list and execute no extra commands. Legacy report callers without the optional field still omit it. Report artifacts now include command arguments and bounded stdout/stderr; inspect them before sharing. No cached command result is reused as current execution evidence.
