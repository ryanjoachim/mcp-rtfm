// ============================================================================
// Shared utility helpers
// ============================================================================

import * as fs from "fs/promises";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { state } from "./persistence.js";
import type { DocMetadata } from "./types.js";

const execFileAsync = promisify(execFileCb);

export const sourceExtensions = [".ts", ".js", ".tsx", ".jsx"] as const;

// Base set of docs created by default; actual doc list is derived from the filesystem
export const BASE_DOCS = [
  "techStack.md",
  "codebaseDetails.md",
  "workflowDetails.md",
  "integrationGuides.md",
  "errorHandling.md",
  "handoff_notes.md"
];

export const TEMPLATE_CONTENT = `# {title}

## Purpose and Overview
[Why this domain is critical to the project]

## Step-by-Step Explanations
[Concrete, detailed steps for implementation and maintenance]

## Annotated Examples
[Code snippets, diagrams, or flowcharts for clarity]

## Contextual Notes
[Historical decisions, trade-offs, and anticipated challenges]

## Actionable Advice
[Gotchas, edge cases, and common pitfalls to avoid]
`;

// Returns the actual docs in the project (BASE_DOCS + any custom ones added to the filesystem)
export const getActualDocs = async (docsPath: string): Promise<string[]> => {
  try {
    const files = await fs.readdir(docsPath);
    return files.filter(f => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
};

/** Returns the absolute path to the .handoff_docs directory for a project. */
export const getDocsPath = (projectPath: string) => `${projectPath}/.handoff_docs`;

/** Current ISO timestamp — used for lastUpdated fields. */
export const freshTimestamp = () => new Date().toISOString();

/** Clear the context cache in state. */
export const invalidateContextCache = () => { state.contextCache = {}; }

/**
 * Convert a doc filename (e.g. "myDoc.md" or "my_doc.md") to a title string.
 */
export const slugToTitle = (docName: string): string =>
  docName.replace(".md", "")
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Create a tool execution error response (visible to LLM).
 * Use this for business logic failures, file operations, validation during execution.
 * Returns a result with isError: true, making the error visible to the LLM for self-correction.
 */
export const handleToolError = (error: unknown, context: string) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: `Error ${context}: ${errorMessage}` }, null, 2) }],
    isError: true
  };
};

/**
 * Add or update YAML front matter on a doc. Handles both cases:
 * - Doc has no front matter: prepends one
 * - Doc already has front matter: replaces it
 * Returns true if the file was modified.
 */
export const enhanceDoc = async (
  filePath: string,
  content: string,
  metadata: DocMetadata,
  relatedDocs: string[]
): Promise<boolean> => {
  const frontMatter = `title: ${metadata.title}
category: ${metadata.category}
tags: ${metadata.tags.join(", ")}
lastUpdated: ${metadata.lastUpdated}
relatedDocs: ${relatedDocs.join(", ")}`;

  let newContent: string;
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end === -1) return false;
    const bodyContent = content.slice(end + 3);
    const separator = bodyContent.startsWith("\n") ? "" : "\n\n";
    newContent = `---
${frontMatter}
---${separator}${bodyContent}`;
  } else {
    newContent = `---
${frontMatter}
---

${content}`;
  }

  if (newContent !== content) {
    await fs.writeFile(filePath, newContent);
    return true;
  }
  return false;
};

/**
 * Retrieve git remote URL, current branch, and last commit hash for a project.
 * Returns an empty object if not a git repo or git is unavailable.
 */
export const getGitInfo = async (projectPath: string): Promise<{
  remoteUrl?: string;
  branch?: string;
  lastCommit?: string;
}> => {
  try {
    const [remoteUrl, branch, lastCommit] = await Promise.all([
      execFileAsync("git", ["config", "--get", "remote.origin.url"], { cwd: projectPath, timeout: 5000 }),
      execFileAsync("git", ["branch", "--show-current"], { cwd: projectPath, timeout: 5000 }),
      execFileAsync("git", ["log", "-1", "--format=%H"], { cwd: projectPath, timeout: 5000 })
    ]);
    return {
      remoteUrl: remoteUrl.stdout.trim(),
      branch: branch.stdout.trim(),
      lastCommit: lastCommit.stdout.trim()
    };
  } catch {
    return {};
  }
};

/**
 * Reset the in-memory documentation state (metadata, caches, etc.)
 * while preserving the lastPersistedAt timestamp.
 */
export const resetState = () => {
  const preservedLastPersistedAt = state.lastPersistedAt;
  state.metadata = {};
  state.contextCache = {};
  state.validationResults = {};
  state.symbolMap = {};
  state.lastPersistedAt = preservedLastPersistedAt;
};
