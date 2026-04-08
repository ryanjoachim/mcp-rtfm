import { test, expect } from "@playwright/test";
import { McpTestClient } from "./fixtures/mcp-client.js";
import { createFixtureProject, cleanupFixtureProject, createGitFixture } from "./helpers/fixture-project.js";
import { expectSuccess } from "./helpers/assertions.js";

test.describe("validate_documentation", () => {
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

  test("valid wiki-links: isValid=true, errors=0", async () => {
    // After analyze, docs should have valid relatedDocs links
    const response = await client.callTool("validate_documentation", {
      projectPath: projectDir,
    });

    const result = expectSuccess(response);
    expect(result.message).toBe("Documentation validation complete");
    // With properly initialized docs, there should be no broken links
    // (links reference docs that exist in .handoff_docs)
    expect(result.isValid).toBe(true);
    expect(result.summary.errors).toBe(0);
  });

  test("broken wiki-links: isValid=false, errors>=1", async () => {
    // Add a broken wiki-link to a doc
    await client.callTool("update_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
      searchContent: "#",
      replaceContent: "# [[nonexistent-doc]]\n\n#",
    });

    const response = await client.callTool("validate_documentation", {
      projectPath: projectDir,
    });

    const result = expectSuccess(response);
    expect(result.isValid).toBe(false);
    expect(result.summary.errors).toBeGreaterThanOrEqual(1);

    // Check that the broken link appears in issues
    const brokenIssues = result.issues.filter(
      (i: any) => i.type === "broken_link",
    );
    expect(brokenIssues.length).toBeGreaterThanOrEqual(1);
    expect(brokenIssues[0].message).toContain("nonexistent-doc");

    // Clean up: remove the broken link
    await client.callTool("update_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
      searchContent: "# [[nonexistent-doc]]\n\n#",
      replaceContent: "#",
    });
  });
});