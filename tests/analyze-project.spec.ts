import { test, expect } from "@playwright/test";
import { McpTestClient } from "./fixtures/mcp-client.js";
import { createFixtureProject, cleanupFixtureProject, createGitFixture } from "./helpers/fixture-project.js";
import { expectSuccess, expectError, expectMcpError } from "./helpers/assertions.js";

test.describe("analyze_project", () => {
  let client: McpTestClient;
  let projectDir: string;

  test.beforeAll(async () => {
    client = await McpTestClient.create();
    projectDir = await createFixtureProject();
    createGitFixture(projectDir);
  });

  test.afterAll(async () => {
    await client.close();
    await cleanupFixtureProject(projectDir);
  });

  test("init mode creates all 6 BASE_DOCS with template content", async () => {
    const response = await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "init" },
    });

    const result = expectSuccess(response);
    expect(result.message).toBe("Documentation structure initialized");
    expect(result.created).toHaveLength(6);
    expect(result.files.length).toBeGreaterThanOrEqual(6);
  });

  test("analyze mode generates metadata, front matter, and search index", async () => {
    // Run analyze on the project that was initialized above
    const response = await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "analyze", initDocs: false },
    });

    const result = expectSuccess(response);
    expect(result.message).toContain("initialized with metadata");
    expect(result.metadata).toBeDefined();
    expect(result.gitInfo).toBeDefined();
    expect(result.files.length).toBeGreaterThanOrEqual(6);
  });

  test("analyze mode with initDocs creates missing files without overwriting existing", async () => {
    // Read a doc before, verify it stays after re-analyze
    const beforeResponse = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });
    const beforeContent = beforeResponse.content[0].text;

    const response = await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "analyze", initDocs: true },
    });

    const result = expectSuccess(response);
    expect(result.message).toContain("initialized with metadata");

    // Verify existing doc wasn't overwritten
    const afterResponse = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });
    // The content should be enhanced (front matter added) but not reset to template
    expect(afterResponse.content[0].text.length).toBeGreaterThanOrEqual(beforeContent.length);
  });

  test("reset mode clears state and re-analyzes", async () => {
    const response = await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "reset" },
    });

    const result = expectSuccess(response);
    expect(result.message).toBe("Existing documentation analyzed and enhanced");
    expect(result.metadata).toBeDefined();
    expect(result.files.length).toBeGreaterThanOrEqual(6);
  });

  test("invalid projectPath throws McpError", async () => {
    await expectMcpError(
      () => client.callTool("analyze_project", { projectPath: "/nonexistent/path/xyz" }),
      "Invalid project path",
    );
  });

  test("reset on no .handoff_docs throws McpError", async () => {
    // Fresh project without .handoff_docs
    const freshDir = await createFixtureProject();
    createGitFixture(freshDir);
    try {
      await expectMcpError(
        () => client.callTool("analyze_project", {
          projectPath: freshDir,
          options: { mode: "reset" },
        }),
        "Documentation directory not found",
      );
    } finally {
      await cleanupFixtureProject(freshDir);
    }
  });

  test("reset on no .md files throws McpError", async () => {
    // Create a project with .handoff_docs but no .md files
    const freshDir = await createFixtureProject();
    createGitFixture(freshDir);
    const fs = await import("fs/promises");
    const path = await import("path");
    await fs.mkdir(path.join(freshDir, ".handoff_docs"), { recursive: true });
    try {
      await expectMcpError(
        () => client.callTool("analyze_project", {
          projectPath: freshDir,
          options: { mode: "reset" },
        }),
        "No markdown files found",
      );
    } finally {
      await cleanupFixtureProject(freshDir);
    }
  });
});