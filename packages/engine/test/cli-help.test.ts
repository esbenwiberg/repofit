import { describe, expect, test } from "vitest";
import { createProgram } from "../src/cli/index.js";

describe("cli help", () => {
  test("root help advertises the explicit help command and common examples", () => {
    const chunks: string[] = [];
    const program = createProgram();
    program.configureOutput({ writeOut: (chunk) => chunks.push(chunk) });
    program.outputHelp();

    const help = chunks.join("");
    expect(help).toContain("help [command]");
    expect(help).toContain("Display help for a command.");
    expect(help).toContain("repofit help check");
    expect(help).toContain("repofit check --accept");
    expect(help).toContain("repofit check --include executed,reasoned --html repofit-report.html");
    expect(help).toContain("run the full scan and write an HTML report");
  });

  test("command-specific help includes check options", () => {
    const program = createProgram();
    const check = program.commands.find((command) => command.name() === "check");

    const help = check?.helpInformation() ?? "";
    expect(help).toContain("Usage: repofit check [options]");
    expect(help).toContain("--include <tier>");
    expect(help).toContain("--reporter <name=path>");
  });
});
