import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

const FIXTURE_PREFIX = "mcp-rtfm-test-";

export async function createFixtureProject(): Promise<string> {
  const dir = path.join(os.tmpdir(), `${FIXTURE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });

  // package.json with MCP SDK + minisearch (same deps as real project)
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "fixture-project",
      version: "1.0.0",
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.29.0",
        minisearch: "^7.1.1",
      },
    }, null, 2),
  );

  // src/index.ts — exported function + class
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "src", "index.ts"),
    `export function initializeApp(config: Record<string, unknown>): void {\n  console.log("initialized", config);\n}\n\nexport class Application {\n  private config: Record<string, unknown>;\n  constructor(config: Record<string, unknown>) {\n    this.config = config;\n  }\n  start(): void { console.log("started", this.config); }\n}\n`,
  );

  // src/utils.ts — exported const + interface + type
  await fs.writeFile(
    path.join(dir, "src", "utils.ts"),
    `export const DEFAULT_TIMEOUT = 30_000;\n\nexport interface AppConfig {\n  name: string;\n  port: number;\n}\n\nexport type Status = "running" | "stopped";\n`,
  );

  return dir;
}

export async function cleanupFixtureProject(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export function createGitFixture(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync("git add .", { cwd: dir });
  execSync('git commit -m "initial"', { cwd: dir });
}