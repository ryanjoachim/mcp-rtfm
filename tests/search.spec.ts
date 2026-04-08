import { test, expect } from "@playwright/test";
import { McpTestClient } from "./fixtures/mcp-client.js";
import { createFixtureProject, cleanupFixtureProject, createGitFixture } from "./helpers/fixture-project.js";
import { expectSuccess, expectMcpError } from "./helpers/assertions.js";

test.describe("search_docs / get_related_docs", () => {
  let client: McpTestClient;
  let projectDir: string;

  test.beforeAll(async () => {
    client = await McpTestClient.create();
    projectDir = await createFixtureProject();
    createGitFixture(projectDir);

    // Initialize and analyze to populate the search index
    await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "analyze", initDocs: true },
    });
  });

  test.afterAll(async () => {
    await client.close();
    await cleanupFixtureProject(projectDir);
  });

  test("search_docs with populated index returns fuzzy-indexed results", async () => {
    const response = await client.callTool("search_docs", {
      projectPath: projectDir,
      query: "tech",
    });

    const result = expectSuccess(response);
    expect(result.query).toBe("tech");
    expect(result.searchMethod).toBe("fuzzy-indexed");
    expect(Array.isArray(result.results)).toBe(true);
  });

  test("search_docs with empty index falls back to regex-scan", async () => {
    // Fresh client = fresh server = empty search index
    const freshClient = await McpTestClient.create();
    const freshDir = await createFixtureProject();
    createGitFixture(freshDir);

    try {
      // Init docs but don't analyze (so the index stays empty)
      await freshClient.callTool("analyze_project", {
        projectPath: freshDir,
        options: { mode: "init" },
      });

      const response = await freshClient.callTool("search_docs", {
        projectPath: freshDir,
        query: "purpose",
      });

      const result = expectSuccess(response);
      expect(result.searchMethod).toBe("regex-scan");
    } finally {
      await freshClient.close();
      await cleanupFixtureProject(freshDir);
    }
  });

  test("get_related_docs finds docs with shared tags/category", async () => {
    const response = await client.callTool("get_related_docs", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });

    const result = expectSuccess(response);
    expect(result.docFile).toBe("techStack.md");
    expect(Array.isArray(result.related)).toBe(true);
    // metadata should exist after analyze
    expect(result.metadata).toBeDefined();
  });

  test("get_related_docs with no metadata returns empty related list", async () => {
    // Fresh client = no state loaded = no metadata
    const freshClient = await McpTestClient.create();
    const freshDir = await createFixtureProject();
    createGitFixture(freshDir);

    try {
      // Init docs but don't analyze — no metadata loaded
      await freshClient.callTool("analyze_project", {
        projectPath: freshDir,
        options: { mode: "init" },
      });

      const response = await freshClient.callTool("get_related_docs", {
        projectPath: freshDir,
        docFile: "techStack.md",
      });

      const result = expectSuccess(response);
      expect(result.related).toEqual([]);
    } finally {
      await freshClient.close();
      await cleanupFixtureProject(freshDir);
    }
  });
});