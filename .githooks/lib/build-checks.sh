#!/usr/bin/env bash
# Build checks — runs lint, format, build, and test before commit.
# Mirrors the secret-checks.sh pattern; sourced from .githooks/pre-commit.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Git exports these to hooks. Anything below that spawns git (the engine
# tests `git init` temp repos) would otherwise act on this repository:
# in a linked worktree that once re-initialised the shared .git as bare.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX GIT_OBJECT_DIRECTORY

run_step() {
    local label="$1"
    shift
    echo -e "${CYAN}→ ${label}${NC}"
    if ! "$@"; then
        echo -e "${RED}✗ ${label} failed${NC}"
        return 1
    fi
}

# lint (biome check) — fast, catches obvious issues.
run_step "lint"          npm run lint --silent          || exit 1
# format (biome format --check) — keeps diffs clean.
run_step "format check"  npm run format:check --silent  || exit 1
# build (tsc -p) — also performs typecheck since tsc emits + checks.
run_step "build"         npm run build --silent         || exit 1
# test (vitest run) — corpus fixtures + engine unit tests.
run_step "test"          npm run test --workspaces --if-present --silent || exit 1

echo -e "${GREEN}✓ build checks passed${NC}"
