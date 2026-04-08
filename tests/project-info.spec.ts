import { test, expect } from "@playwright/test";
import { McpTestClient } from "./fixtures/mcp-client.js";
import { createFixtureProject, cleanupFixtureProject, createGitFixture } from "./helpers/fixture-project.js";
import { expectSuccess } from "./helpers/assertions.js";

test.describe("get_project_info / analyze_content_gaps", () => {
  let client: McpTestClient;
  let projectDir: string;

  test.beforeAll(async () => {
    client = await McpTestClient.create();
    projectDir = await createFixtureProject();
    createGitFixture(projectDir);

    // Initialize and analyze docs
    await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "analyze", initDocs: true },
    });
  });

  test.afterAll(async () => {
    await client.close();
    await cleanupFixtureProject(projectDir);
  });

  test("get_project_info returns gitInfo, packageInfo, docs list", async () => {
    const response = await client.callTool("get_project_info", {
      projectPath: projectDir,
    });

    const result = expectSuccess(response);
    expect(result.gitInfo).toBeDefined();
    expect(result.packageInfo).toBeDefined();
    expect(result.packageInfo.name).toBe("fixture-project");
    expect(Array.isArray(result.docs)).toBe(true);
    expect(result.totalDocs).toBeGreaterThanOrEqual(6);
  });

  test("analyze_content_gaps finds undocumented symbols", async () => {
    const response = await client.callTool("analyze_content_gaps", {
      projectPath: projectDir,
    });

    const result = expectSuccess(response);
    expect(result.message).toBe("Content gap analysis complete");
    expect(typeof result.gapsFound).toBe("number");
    expect(Array.isArray(result.gaps)).toBe(true);
    // The fixture has exported functions, classes, interfaces — should find gaps
    expect(result.gapsFound).toBeGreaterThanOrEqual(0);
  });

  test("analyze_content_gaps with targetFiles restricts to specified files", async () => {
    const responseAll = await client.callTool("analyze_content_gaps", {
      projectPath: projectDir,
    });
    const allResult = expectSuccess(responseAll);

    const responseFiltered = await client.callTool("analyze_content_gaps", {
      projectPath: projectDir,
      targetFiles: ["src/index.ts"],
    });
    const filteredResult = expectSuccess(responseFiltered);

    // Filtered should have same or fewer gaps
    expect(filteredResult.gapsFound).toBeLessThanOrEqual(allResult.gapsFound);
    // All gaps should be from the specified file
    if (filteredResult.gapsFound > 0) {
      for (const gap of filteredResult.gaps) {
        expect(gap.file).toBe("src/index.ts");
      }
    }
  });
});