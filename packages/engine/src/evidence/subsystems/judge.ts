import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  type GatherContext,
  JUDGE_BANDS,
  type JudgeBand,
  type JudgeEvidence,
  type JudgeRequest,
  type JudgeResult,
} from "../../sdk/types.js";

export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";
export const DEFAULT_JUDGE_MODEL_OPENAI = "gpt-4o-mini";
export const DEFAULT_JUDGE_MODEL_CODEX = "codex-cli-default";
export type JudgeTransport = "api" | "cli" | "openai" | "codex";

const OPENAI_TRANSPORTS = new Set<JudgeTransport>(["openai"]);

const SYSTEM_PROMPT = [
  "You are a strict, terse evaluator that scores repository artifacts against a rubric.",
  "For each criterion, choose the single band that best fits, from the discrete set: 0, 20, 50, 80, 100.",
  "Band guidance: 0 = absent or actively misleading. 20 = present but shallow or generic. 50 = adequate, partial coverage. 80 = strong, mostly complete. 100 = exemplary, complete and specific.",
  "Be honest. Most real-world artifacts land between 20 and 80; reserve 100 for outliers.",
  "The `rationale` should be at most 3 sentences explaining the biggest gap or strength.",
].join(" ");

export const judgeSubsystem = {
  gather(ctx: GatherContext): JudgeEvidence {
    const cacheDir = join(ctx.cwd, ".repofit", "cache", "judge");
    const noCache = ctx.judge?.noCache ?? false;
    const explicitModel = ctx.judge?.model ?? null;
    const transportPref = ctx.judge?.transport;
    let cachedTransport: JudgeTransport | null = null;
    let apiClient: Anthropic | null = null;
    let openaiClient: OpenAI | null = null;

    async function resolveTransport(): Promise<JudgeTransport> {
      if (!cachedTransport) {
        cachedTransport = await selectTransport(transportPref);
      }
      return cachedTransport;
    }

    function modelForTransport(transport: JudgeTransport): string {
      if (explicitModel) return explicitModel;
      if (transport === "codex") return DEFAULT_JUDGE_MODEL_CODEX;
      return OPENAI_TRANSPORTS.has(transport) ? DEFAULT_JUDGE_MODEL_OPENAI : DEFAULT_JUDGE_MODEL;
    }

    const provisionalDefaultModel =
      explicitModel ??
      (transportPref === "codex" ? DEFAULT_JUDGE_MODEL_CODEX : undefined) ??
      (transportPref && OPENAI_TRANSPORTS.has(transportPref)
        ? DEFAULT_JUDGE_MODEL_OPENAI
        : DEFAULT_JUDGE_MODEL);

    return {
      defaultModel: provisionalDefaultModel,
      async score(req: JudgeRequest): Promise<JudgeResult> {
        // Resolve the model used for the cache key WITHOUT resolving transport,
        // so a cache hit short-circuits before we require an API key / CLI.
        const provisionalModel = req.model ?? provisionalDefaultModel;
        const cacheKey = computeCacheKey(req, provisionalModel);

        if (!noCache) {
          const cached = await readCache(cacheDir, cacheKey);
          if (cached) return { ...cached, fromCache: true };
        }

        const transport = await resolveTransport();
        const model = req.model ?? modelForTransport(transport);

        let result: Omit<JudgeResult, "fromCache">;
        if (transport === "api") {
          if (!apiClient) apiClient = new Anthropic();
          result = await callJudgeApi(apiClient, req, model);
        } else if (transport === "openai") {
          if (!openaiClient) openaiClient = new OpenAI({ baseURL: process.env.OPENAI_BASE_URL });
          result = await callJudgeOpenAI(openaiClient, req, model);
        } else if (transport === "codex") {
          result = await callJudgeCodex(req, model);
        } else {
          result = await callJudgeCli(req, model);
        }

        if (!noCache) {
          const writeKey = model === provisionalModel ? cacheKey : computeCacheKey(req, model);
          await writeCache(cacheDir, writeKey, result);
        }

        return { ...result, fromCache: false };
      },
    };
  },
};

async function selectTransport(pref: JudgeTransport | undefined): Promise<JudgeTransport> {
  if (pref === "api") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("judge transport `api` requested but ANTHROPIC_API_KEY is not set.");
    }
    return "api";
  }
  if (pref === "openai") {
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) {
      throw new Error(
        "judge transport `openai` requested but neither OPENAI_API_KEY nor OPENAI_BASE_URL is set.",
      );
    }
    return "openai";
  }
  if (pref === "cli") {
    if (!(await claudeOnPath())) {
      throw new Error("judge transport `cli` requested but `claude` is not on PATH.");
    }
    return "cli";
  }
  if (pref === "codex") {
    if (!(await codexOnPath())) {
      throw new Error("judge transport `codex` requested but `codex` is not on PATH.");
    }
    return "codex";
  }
  // auto: Anthropic API key → OpenAI API/base URL → claude CLI → codex CLI
  if (process.env.ANTHROPIC_API_KEY) return "api";
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return "openai";
  if (await claudeOnPath()) return "cli";
  if (await codexOnPath()) return "codex";
  throw new Error(
    "No judge transport available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (for CI), " +
      "install the `claude` CLI or `codex` CLI (for local dev), or omit `--include reasoned`.",
  );
}

async function claudeOnPath(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function codexOnPath(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export function computeCacheKey(req: JudgeRequest, model: string): string {
  const h = createHash("sha256");
  h.update(req.probeId);
  h.update("\0");
  h.update(req.probeVersion);
  h.update("\0");
  h.update(model);
  h.update("\0");
  h.update(JSON.stringify(req.rubric));
  h.update("\0");
  h.update(req.input);
  return h.digest("hex");
}

async function readCache(
  cacheDir: string,
  key: string,
): Promise<Omit<JudgeResult, "fromCache"> | null> {
  try {
    const raw = await readFile(join(cacheDir, `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as { result: Omit<JudgeResult, "fromCache"> };
    return parsed.result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function writeCache(
  cacheDir: string,
  key: string,
  result: Omit<JudgeResult, "fromCache">,
): Promise<void> {
  const file = join(cacheDir, `${key}.json`);
  await mkdir(dirname(file), { recursive: true });
  await ensureGitignore(cacheDir);
  const payload = {
    key,
    savedAt: new Date().toISOString(),
    result,
  };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureGitignore(cacheDir: string): Promise<void> {
  const gi = join(cacheDir, "..", ".gitignore");
  try {
    await readFile(gi, "utf8");
  } catch {
    await writeFile(gi, "*\n", "utf8");
  }
}

function buildSchema(req: JudgeRequest): Record<string, unknown> {
  const criteriaIds = req.rubric.criteria.map((c) => c.id);
  const properties: Record<string, { type: "integer"; enum: number[]; description: string }> = {};
  for (const c of req.rubric.criteria) {
    properties[c.id] = {
      type: "integer",
      enum: [...JUDGE_BANDS],
      description: c.description,
    };
  }
  return {
    type: "object",
    required: ["perCriterion", "rationale"],
    properties: {
      perCriterion: {
        type: "object",
        required: criteriaIds,
        properties,
      },
      rationale: {
        type: "string",
        description: "At most 3 sentences explaining the biggest gap or strength.",
      },
    },
  };
}

async function callJudgeApi(
  client: Anthropic,
  req: JudgeRequest,
  model: string,
): Promise<Omit<JudgeResult, "fromCache">> {
  const criteriaIds = req.rubric.criteria.map((c) => c.id);
  const schema = buildSchema(req);

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "record_judgement",
        description: "Record per-criterion banded scores and a short rationale.",
        input_schema: schema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "record_judgement" },
    messages: [
      {
        role: "user",
        content: buildUserPrompt(req),
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (toolUse?.type !== "tool_use") {
    throw new Error(
      `judge(api): model did not call record_judgement (stop_reason=${response.stop_reason})`,
    );
  }

  const parsed = parseJudgeInput(toolUse.input, criteriaIds);
  return finalize(parsed, model);
}

async function callJudgeOpenAI(
  client: OpenAI,
  req: JudgeRequest,
  model: string,
): Promise<Omit<JudgeResult, "fromCache">> {
  const criteriaIds = req.rubric.criteria.map((c) => c.id);
  const schema = buildSchema(req);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(req) },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "record_judgement",
          description: "Record per-criterion banded scores and a short rationale.",
          parameters: schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "record_judgement" } },
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (toolCall?.type !== "function") {
    const stopReason = response.choices[0]?.finish_reason ?? "?";
    throw new Error(
      `judge(openai): model did not call record_judgement (finish_reason=${stopReason})`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    throw new Error(`judge(openai): failed to parse tool arguments: ${(err as Error).message}`);
  }

  const parsed = parseJudgeInput(input, criteriaIds);
  return finalize(parsed, model);
}

async function callJudgeCli(
  req: JudgeRequest,
  model: string,
): Promise<Omit<JudgeResult, "fromCache">> {
  const criteriaIds = req.rubric.criteria.map((c) => c.id);
  const schema = buildSchema(req);
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(req)}`;

  const stdout = await spawnClaude(prompt, [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--model",
    model,
  ]);

  let envelope: {
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
    stop_reason?: string;
  };
  try {
    envelope = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`judge(cli): failed to parse claude JSON envelope: ${(err as Error).message}`);
  }

  if (envelope.is_error) {
    throw new Error(`judge(cli): claude reported error: ${envelope.result ?? "(no message)"}`);
  }
  if (envelope.structured_output === undefined) {
    throw new Error(
      `judge(cli): claude did not return structured_output (stop_reason=${envelope.stop_reason ?? "?"})`,
    );
  }

  const parsed = parseJudgeInput(envelope.structured_output, criteriaIds);
  return finalize(parsed, model);
}

async function callJudgeCodex(
  req: JudgeRequest,
  model: string,
): Promise<Omit<JudgeResult, "fromCache">> {
  const criteriaIds = req.rubric.criteria.map((c) => c.id);
  const schema = buildSchema(req);
  const prompt = [
    SYSTEM_PROMPT,
    "",
    buildUserPrompt(req),
    "",
    "IMPORTANT: Output ONLY a single valid JSON object (no markdown fences, no explanation) that conforms exactly to this schema:",
    JSON.stringify(schema, null, 2),
  ].join("\n");

  const stdout = await spawnCodex(prompt, model);

  // Extract the first JSON object from the output
  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("judge(codex): no JSON object found in codex output");
  }

  let input: unknown;
  try {
    input = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(
      `judge(codex): failed to parse JSON from codex output: ${(err as Error).message}`,
    );
  }

  const parsed = parseJudgeInput(input, criteriaIds);
  return finalize(parsed, model);
}

function spawnClaude(stdin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim() || "(no stderr)"}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

async function spawnCodex(stdin: string, model: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "repofit-codex-"));
  const outputPath = join(tempDir, "last-message.txt");
  try {
    return await new Promise((resolve, reject) => {
      const args = ["--sandbox", "read-only"];
      if (model !== DEFAULT_JUDGE_MODEL_CODEX) args.push("--model", model);
      args.push("exec", "--output-last-message", outputPath, "-");
      const child = spawn("codex", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`codex exited ${code}: ${stderr.trim() || "(no stderr)"}`));
          return;
        }
        readFile(outputPath, "utf8")
          .then(resolve)
          .catch(() => resolve(stdout));
      });
      child.stdin?.write(stdin);
      child.stdin?.end();
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function finalize(
  parsed: { perCriterion: Record<string, JudgeBand>; rationale: string },
  model: string,
): Omit<JudgeResult, "fromCache"> {
  return {
    score: aggregateOverall(parsed.perCriterion),
    perCriterion: parsed.perCriterion,
    rationale: parsed.rationale,
    model,
  };
}

function buildUserPrompt(req: JudgeRequest): string {
  const criteriaList = req.rubric.criteria
    .map((c, i) => `${i + 1}. **${c.id}** — ${c.description}`)
    .join("\n");
  return [
    `# Task\n${req.rubric.task}`,
    `# Criteria (score each in {0, 20, 50, 80, 100})\n${criteriaList}`,
    `# Input to evaluate\n\n\`\`\`\n${req.input}\n\`\`\``,
    "Return JSON with `perCriterion` (one banded integer per criterion id) and `rationale`.",
  ].join("\n\n");
}

export function parseJudgeInput(
  input: unknown,
  criteriaIds: string[],
): { perCriterion: Record<string, JudgeBand>; rationale: string } {
  if (typeof input !== "object" || input === null) {
    throw new Error("judge: tool input was not an object");
  }
  const raw = input as { perCriterion?: unknown; rationale?: unknown };
  if (typeof raw.rationale !== "string") {
    throw new Error("judge: tool input missing string `rationale`");
  }
  if (typeof raw.perCriterion !== "object" || raw.perCriterion === null) {
    throw new Error("judge: tool input missing object `perCriterion`");
  }
  const perCrit = raw.perCriterion as Record<string, unknown>;
  const out: Record<string, JudgeBand> = {};
  for (const id of criteriaIds) {
    const value = perCrit[id];
    if (typeof value !== "number") {
      throw new Error(`judge: criterion '${id}' missing or not a number`);
    }
    out[id] = snapToBand(value);
  }
  return { perCriterion: out, rationale: raw.rationale };
}

export function aggregateOverall(perCriterion: Record<string, number>): JudgeBand {
  const values = Object.values(perCriterion);
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return snapToBand(mean);
}

export function snapToBand(value: number): JudgeBand {
  let nearest: JudgeBand = JUDGE_BANDS[0];
  let best = Math.abs(value - JUDGE_BANDS[0]);
  for (const b of JUDGE_BANDS) {
    const d = Math.abs(value - b);
    if (d < best) {
      best = d;
      nearest = b;
    }
  }
  return nearest;
}
