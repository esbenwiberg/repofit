import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BranchProtectionResult, GatherContext, GithubApiEvidence } from "../../sdk/types.js";

const exec = promisify(execFile);
const REMOTE_URL_REGEX = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\s|$)/i;

export const githubApiSubsystem = {
  gather(ctx: GatherContext): GithubApiEvidence {
    return {
      async branchProtection(branch?: string): Promise<BranchProtectionResult> {
        const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
        if (!token) return { kind: "unavailable", reason: "no GITHUB_TOKEN/GH_TOKEN in env" };

        const remote = await detectRemote(ctx.cwd);
        if (!remote) return { kind: "unavailable", reason: "no GitHub origin remote" };

        const target = branch ?? (await detectDefaultBranch(ctx.cwd)) ?? "main";
        const url = `https://api.github.com/repos/${remote.owner}/${remote.repo}/branches/${target}/protection`;

        try {
          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });
          if (res.status === 404) return { kind: "unprotected" };
          if (!res.ok) return { kind: "unavailable", reason: `github api ${res.status}` };
          return { kind: "protected" };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { kind: "unavailable", reason: `github api request failed: ${message}` };
        }
      },
    };
  },
};

async function detectRemote(cwd: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd });
    const match = REMOTE_URL_REGEX.exec(stdout.trim());
    if (!match?.[1] || !match[2]) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

async function detectDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd,
    });
    return stdout.trim().replace(/^origin\//, "") || null;
  } catch {
    return null;
  }
}
