import { test, expect } from "@playwright/test";
import { McpTestClient } from "./fixtures/mcp-client.js";
import { createFixtureProject, cleanupFixtureProject, createGitFixture } from "./helpers/fixture-project.js";
import { expectSuccess, expectError, expectMcpError } from "./helpers/assertions.js";

test.describe("read_doc / update_doc", () => {
  let client: McpTestClient;
  let projectDir: string;

  test.beforeAll(async () => {
    client = await McpTestClient.create();
    projectDir = await createFixtureProject();
    createGitFixture(projectDir);

    // Initialize docs so there's something to read/write
    await client.callTool("analyze_project", {
      projectPath: projectDir,
      options: { mode: "init" },
    });
  });

  test.afterAll(async () => {
    await client.close();
    await cleanupFixtureProject(projectDir);
  });

  test("read_doc returns raw file content", async () => {
    const response = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    // read_doc returns raw markdown, not JSON
    expect(text).toContain("#");
    expect(typeof text).toBe("string");
  });

  test("read_doc on nonexistent file returns error", async () => {
    const response = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "nonexistent.md",
    });

    expectError(response, "reading documentation");
  });

  test("update_doc with content replaces entire file", async () => {
    const newContent = "---\ntitle: Test\ncategory: test\ntags: []\n---\n# Replaced Content\n";
    const response = await client.callTool("update_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
      content: newContent,
    });

    const result = expectSuccess(response);
    expect(result.message).toContain("updated");

    // Verify the file was actually replaced
    const readResponse = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });
    expect(readResponse.content[0].text).toBe(newContent);
  });

  test("update_doc with searchContent/replaceContent does targeted diff", async () => {
    // First, set known content
    await client.callTool("update_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
      content: "---\ntitle: Test\ncategory: test\ntags: []\n---\n# Tech Stack\nOld content here\n",
    });

    const response = await client.callTool("update_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
      searchContent: "Old content here",
      replaceContent: "New content here",
    });

    const result = expectSuccess(response);
    expect(result.message).toContain("updated");

    // Verify only the targeted part changed
    const readResponse = await client.callTool("read_doc", {
      projectPath: projectDir,
      docFile: "techStack.md",
    });
    const text = readResponse.content[0].text;
    expect(text).toContain("New content here");
    expect(text).not.toContain("Old content here");
    expect(text).toContain("# Tech Stack");
  });

  test("update_doc with missing searchContent throws McpError", async () => {
    await expectMcpError(
      () => client.callTool("update_doc", {
        projectPath: projectDir,
        docFile: "techStack.md",
        searchContent: "this text does not exist in the file xyzzy123",
        replaceContent: "replacement",
      }),
      "Search content not found",
    );
  });

  test("update_doc with neither content nor searchContent throws McpError", async () => {
    await expectMcpError(
      () => client.callTool("update_doc", {
        projectPath: projectDir,
        docFile: "techStack.md",
      }),
      "Must provide either",
    );
  });
});