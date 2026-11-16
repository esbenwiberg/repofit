import type { Fact, FileFacts, TextFact } from "./types.js";

type Token = { value: string; line: number; start: number; end: number; string?: boolean };
const CONTROL = new Set([
  "if",
  "for",
  "foreach",
  "while",
  "switch",
  "catch",
  "using",
  "lock",
  "with",
]);
const BEHAVIOR = new Set([
  "await",
  "throw",
  "try",
  "catch",
  "finally",
  "return",
  "yield",
  "using",
  "lock",
  "async",
  "new",
]);
const unique = (xs: string[]) => [...new Set(xs)].sort();

/** Lexical adapters, deliberately no framework/type/overload resolution. Strings/comments cannot become calls. */
export function extract(path: string, text: string, hash: string, stamp: string): FileFacts {
  const adapter = /\.cs$/i.test(path)
    ? "csharp"
    : /\.(?:md|mdx)$/i.test(path)
      ? "documentation"
      : /\.(?:jsonc?|ya?ml|toml|xml|csproj|sh|bash)$/i.test(path)
        ? "configuration"
        : "typescript";
  const texts: TextFact[] = [];
  const tokens: Token[] = [];
  const truncated: string[] = [];
  let line = 1;
  const re =
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\$*"{3,}[\s\S]*?"{3,}|\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\r\n\\])+\/[dgimsuvy]*|@?"(?:""|\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|=>|\?\.|[^\s]/g;
  let previous = 0;
  for (const m of text.matchAll(re)) {
    line += (text.slice(previous, m.index).match(/\n/g) ?? []).length;
    const value = m[0];
    if (value.startsWith("//") || value.startsWith("/*")) {
      if (texts.length < 128) texts.push({ kind: "comment", line, text: value.slice(0, 2048) });
      if (texts.length >= 128) truncated.push("comment collection");
      if (value.length > 2048) truncated.push("comment excerpt");
    } else {
      tokens.push({
        value,
        line,
        start: m.index,
        end: m.index + value.length,
        string: /^(?:\$*"|@"|'|`|\/)/.test(value),
      });
    }
    line += (value.match(/\n/g) ?? []).length;
    previous = m.index + value.length;
  }
  if (adapter === "documentation" || adapter === "configuration") {
    const lines = text.split(/\r?\n/);
    let fenced = false;
    texts.length = 0;
    for (let i = 0; i < lines.length; i++) {
      const value = lines[i] ?? "";
      if (/^\s*```|^\s*~~~/.test(value)) {
        fenced = !fenced;
        continue;
      }
      if (!value.trim()) continue;
      if (value.length > 2048) truncated.push("documentation line excerpt");
      if (texts.length < 256)
        texts.push({
          kind: fenced ? "example" : "documentation",
          line: i + 1,
          text: value.slice(0, 2048),
        });
      else truncated.push("documentation lines");
    }
    return {
      path,
      hash,
      stamp,
      adapter,
      imports: [],
      symbols: [],
      texts,
      contracts: false,
      truncated: unique(truncated),
      unknowns: [],
    };
  }
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  let unmatched = false;
  const closing: Record<string, string> = { ")": "(", "}": "{", "]": "[" };
  tokens.forEach((t, i) => {
    if (t.string) return;
    if (["(", "{", "["].includes(t.value)) stack.push(i);
    else if (closing[t.value]) {
      const start = stack.pop();
      if (start === undefined || tokens[start]?.value !== closing[t.value]) unmatched = true;
      else pairs.set(start, i);
    }
  });
  const imports: FileFacts["imports"] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (["import", "from", "require"].includes(t.value)) {
      const next = tokens.slice(i + 1, i + 30).find((x) => x.string);
      if (next && next.line <= t.line + 3)
        imports.push({ name: next.value.slice(1, -1), line: next.line });
    }
    if (adapter === "csharp" && t.value === "using") {
      let end = i + 1;
      while (
        end < tokens.length &&
        tokens[end]?.value !== ";" &&
        (tokens[end]?.line ?? 0) <= t.line + 1
      )
        end++;
      const name = tokens
        .slice(i + 1, end)
        .map((x) => x.value)
        .join("")
        .replace(/^static/, "");
      if (/^[\w.]+$/.test(name)) imports.push({ name, line: t.line });
    }
  }
  function calls(start: number, end: number): Fact["calls"] {
    const out: Fact["calls"] = [];
    for (let i = start; i < end; i++) {
      const t = tokens[i];
      if (!t || t.string || !/^[A-Za-z_$]/.test(t.value) || CONTROL.has(t.value)) continue;
      let j = i + 1;
      while (
        [".", "?."].includes(tokens[j]?.value ?? "") &&
        /^[\w$]+$/.test(tokens[j + 1]?.value ?? "")
      )
        j += 2;
      const end = pairs.get(j);
      const declaration = end !== undefined && ["{", ":"].includes(tokens[end + 1]?.value ?? "");
      if (tokens[j]?.value === "(" && !declaration && tokens[i - 1]?.value !== "function") {
        out.push({
          name: tokens
            .slice(i, j)
            .map((x) => x.value)
            .join("")
            .replaceAll("?.", "."),
          line: t.line,
        });
        i = j - 1;
      }
      if (out.length >= 512) {
        truncated.push("call facts");
        break;
      }
    }
    return out;
  }
  const symbols: Fact[] = [];
  for (let i = 0; i < tokens.length && symbols.length < 256; i++) {
    const t = tokens[i];
    if (
      !t ||
      t.string ||
      CONTROL.has(t.value) ||
      tokens[i + 1]?.value !== "(" ||
      !/^[A-Za-z_$][\w$]*$/.test(t.value)
    )
      continue;
    const parenEnd = pairs.get(i + 1);
    if (parenEnd === undefined) continue;
    let body = parenEnd + 1;
    if (tokens[body]?.value === ":") {
      while (body < parenEnd + 24 && !["{", ";", "=>", "="].includes(tokens[body]?.value ?? ""))
        body++;
    }
    if (
      tokens[body]?.value !== "{" ||
      tokens[i - 1]?.value === "." ||
      tokens[i - 1]?.value === "new"
    )
      continue;
    const end = pairs.get(body);
    if (end === undefined) continue;
    const segment = tokens.slice(body + 1, end);
    const before = tokens.slice(Math.max(0, i - 20), i);
    const annotations = before
      .filter((_x, n) => before[n - 1]?.value === "@" || before[n - 1]?.value === "[")
      .map((x) => x.value);
    const excerpt = text.slice(t.start, tokens[end]?.end).slice(0, 4096);
    if ((tokens[end]?.end ?? t.start) - t.start > 4096) truncated.push("symbol excerpt");
    symbols.push({
      name: t.value,
      location: { path, range: { startLine: t.line, endLine: tokens[end]?.line } },
      calls: calls(body + 1, end),
      annotations: unique(annotations),
      behavior: unique(
        segment.filter((x) => !x.string && BEHAVIOR.has(x.value)).map((x) => x.value),
      ),
      shape: `${tokens.slice(i + 2, parenEnd).filter((x) => x.value === ",").length + (parenEnd > i + 2 ? 1 : 0)}-args`,
      excerpt,
    });
  }
  // A module fact keeps top-level calls and unnamed arrow implementations eligible.
  if (text.length > 4096) truncated.push("module excerpt");
  symbols.push({
    name: "<module>",
    location: { path, range: { startLine: 1 } },
    calls: calls(0, tokens.length),
    annotations: [],
    behavior: unique(tokens.filter((x) => !x.string && BEHAVIOR.has(x.value)).map((x) => x.value)),
    shape: "module",
    excerpt: text.slice(0, 4096),
  });
  if (symbols.length >= 256) truncated.push("symbol facts");
  if (imports.length > 512) truncated.push("import facts");
  return {
    path,
    hash,
    stamp,
    adapter,
    imports: [...new Map(imports.map((x) => [x.name, x])).values()].slice(0, 512),
    symbols,
    texts,
    contracts: tokens.some(
      (x) => !x.string && ["interface", "record", "enum", "namespace", "type"].includes(x.value),
    ),
    truncated: unique(truncated),
    unknowns: [
      "Lexical facts only: unresolved aliases, overloads, dynamic calls, framework behavior, ambiguous slash expressions and interpolation bodies are unknown. Literal bodies are opaque.",
      ...(unmatched || stack.length
        ? ["Unbalanced delimiters: some symbols could not be recognized."]
        : []),
    ],
  };
}
