# `@example/repofit-corpus-ruby`

A worked example of a **third-party repofit corpus**. Shows how to:

1. **Shadow a stock probe** — replaces `lint.clean` with a Ruby-aware
   version that runs `bundle exec rubocop`.
2. **Add a new probe** — `rspec.clean` runs RSpec when a `spec/` directory
   is present.

Both pieces live in [`src/index.ts`](src/index.ts) and follow the same
`defineProbe` API the bundled corpus uses.

## How a user wires it in

```bash
npm install --save-dev @example/repofit-corpus-ruby
```

In `repofit.config.json`, list the Ruby corpus **after** the default — later
entries win on probe id:

```json
{
  "corpus": [
    { "package": "@esbenwiberg/corpus-default", "version": "2.0.0" },
    { "package": "@example/repofit-corpus-ruby", "version": "0.1.0" }
  ]
}
```

When `repofit check` runs, it will emit a one-line override notice:

```
corpus override:
  probe lint.clean (@esbenwiberg/corpus-default → @example/repofit-corpus-ruby)
```

That's the contract: an explicit, visible override. Nothing magic.

## Why this isn't in the bundled corpus

repofit's bundled corpus covers Node + TypeScript, .NET, Python, and Go.
Other stacks live in third-party corpora exactly like this one — see the
[Supported stacks section of the root README](../../README.md#supported-stacks)
for the contract.
