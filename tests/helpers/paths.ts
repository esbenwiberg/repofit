import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(HERE, "../..");
export const ACME_OVERLAY_DIR = resolve(
  REPO_ROOT,
  "tests/fixtures/overlays/acme",
);
