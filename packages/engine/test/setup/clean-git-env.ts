/**
 * Git exports GIT_DIR, GIT_INDEX_FILE and friends to hooks. Tests that
 * `git init` a temp directory inherit them and operate on the host
 * repository instead (a pre-commit run once flipped the real repo to bare
 * and wrote a test identity into its config). Strip them for every worker
 * so a test never sees the repository it is running from.
 */
for (const name of Object.keys(process.env)) {
  if (name === "GIT_CONFIG_GLOBAL" || name === "GIT_CONFIG_SYSTEM") continue;
  if (name.startsWith("GIT_")) delete process.env[name];
}
