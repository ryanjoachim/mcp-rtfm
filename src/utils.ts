// ============================================================================
// Shared utility helpers
// ============================================================================

import * as fs from "fs/promises";
import { execSync } from "child_process";
import { state } from "./state.js";
import type { DocMetadata } from "./types.js";

export const sourceExtensions = [".ts", ".js", ".tsx", ".jsx"] as const;

export const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

export const DOCS_DIR = ".handoff_docs";

/** Returns the absolute path to the .handoff_docs directory for a project. */
export const getDocsPath = (projectPath: string) => `${projectPath}/${DOCS_DIR}`;

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
    newContent = `---
${frontMatter}
---${content.slice(end + 3)}`;
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
export const getGitInfo = (projectPath: string): {
  remoteUrl?: string;
  branch?: string;
  lastCommit?: string;
} => {
  try {
    return {
      remoteUrl: execSync("git config --get remote.origin.url", { cwd: projectPath, timeout: 5000 }).toString().trim(),
      branch: execSync("git branch --show-current", { cwd: projectPath, timeout: 5000 }).toString().trim(),
      lastCommit: execSync("git log -1 --format=%H", { cwd: projectPath, timeout: 5000 }).toString().trim()
    };
  } catch {
    return {};
  }
};

/**
 * Reset the in-memory documentation state (completed files, in-progress flags,
 * caches, etc.) while preserving the lastPersistedAt timestamp.
 */
export const resetState = () => {
  const preservedLastPersistedAt = state.lastPersistedAt;
  state.currentFile = null;
  state.completedFiles = [];
  state.inProgress = false;
  state.lastReadFile = null;
  state.lastReadContent = null;
  state.continueToNext = false;
  state.metadata = {};
  state.contextCache = {};
  state.templateOverrides = {};
  state.validationResults = {};
  state.symbolMap = {};
  state.lastPersistedAt = preservedLastPersistedAt;
};
