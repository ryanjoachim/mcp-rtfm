import { test, expect } from "@playwright/test";
import { McpTestClient } from "./fixtures/mcp-client.js";
import { createFixtureProject, cleanupFixtureProject, createGitFixture } from "./helpers/fixture-project.js";
import { expectSuccess, expectMcpError } from "./helpers/assertions.js";

test.describe("refresh_documentation", () => {
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

  test("sync mode dry run returns suggestions without modifying files", async () => {
    // Read a doc before refresh
    const beforeResponse = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });
    const beforeContent = beforeResponse.content[0].text;

    const response = await client.callTool("refresh_documentation", {
      projectPath: projectDir,
      options: { mode: "sync", dryRun: true },
    });

    const result = expectSuccess(response);
    expect(result.dryRun).toBe(true);
    expect(result.suggestions).toBeDefined();
    expect(result.summary).toBeDefined();

    // Verify no changes were applied
    const afterResponse = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });
    expect(afterResponse.content[0].text).toBe(beforeContent);
  });

  test("sync mode apply writes changes to disk", async () => {
    const response = await client.callTool("refresh_documentation", {
      projectPath: projectDir,
      options: { mode: "sync", dryRun: false },
    });

    const result = expectSuccess(response);
    expect(result.dryRun).toBe(false);
    expect(result.timestamp).toBeDefined();
  });

  test("analyze mode regenerates metadata and returns signature", async () => {
    const response = await client.callTool("refresh_documentation", {
      projectPath: projectDir,
      options: { mode: "analyze" },
    });

    const result = expectSuccess(response);
    expect(result.message).toContain("refreshed");
    expect(result.signature).toBeDefined();
    expect(result.files).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
  });

  test("refresh on no .handoff_docs throws McpError", async () => {
    const freshDir = await createFixtureProject();
    createGitFixture(freshDir);
    try {
      await expectMcpError(
        () => client.callTool("refresh_documentation", {
          projectPath: freshDir,
          options: { mode: "sync" },
        }),
        "Documentation directory not found",
      );
    } finally {
      await cleanupFixtureProject(freshDir);
    }
  });
});