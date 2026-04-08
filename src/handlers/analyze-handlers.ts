// ============================================================================
// Analysis Tool Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { state, searchEngine, loadStateFromDisk, saveStateToDisk } from "../persistence.js";
import {
  BASE_DOCS, getActualDocs, TEMPLATE_CONTENT,
  enhanceDoc, getGitInfo, resetState, slugToTitle,
  handleToolError, getDocsPath, invalidateContextCache
} from "../utils.js";
import { analyzeAndIndexDoc } from "../content.js";
import { generatePreFilledContent } from "../project.js";
import { validateProjectPath } from "../validation.js";
import { CACHE_TTL } from "../types.js";
import { clearSignatureCache } from "../project.js";

// ---------------------------------------------------------------------------
// Init mode — creates missing BASE_DOCS skeleton files
// ---------------------------------------------------------------------------

async function handleInitMode(projectPath: string) {
  const docsPath = getDocsPath(projectPath);
  await fs.mkdir(docsPath, { recursive: true });

  const created: string[] = [];
  for (const doc of BASE_DOCS) {
    const filePath = `${docsPath}/${doc}`;
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, TEMPLATE_CONTENT.replace("{title}", slugToTitle(doc)));
      created.push(doc);
    }
  }

  return {
    message: "Documentation structure initialized",
    docsPath,
    files: await getActualDocs(docsPath),
    created
  };
}

// ---------------------------------------------------------------------------
// Core doc enhancement — analyze, index, and enhance front matter
// ---------------------------------------------------------------------------

async function enhanceDocFile(doc: string, projectPath: string) {
  const docsPath = getDocsPath(projectPath);
  const filePath = `${docsPath}/${doc}`;
  const content = await fs.readFile(filePath, "utf8");

  const { relatedDocs } = await analyzeAndIndexDoc(doc, filePath, content, projectPath);
  const metadata = state.metadata[doc]!;
  await enhanceDoc(filePath, content, metadata, relatedDocs);
}

// ---------------------------------------------------------------------------
// Analyze mode — enhances existing docs with metadata, preserves state
// ---------------------------------------------------------------------------

async function handleAnalyzeMode(projectPath: string, initDocs: boolean) {
  const docsPath = getDocsPath(projectPath);
  await fs.mkdir(docsPath, { recursive: true });

  if (initDocs) {
    for (const doc of BASE_DOCS) {
      const filePath = `${docsPath}/${doc}`;
      try {
        await fs.access(filePath);
        // File exists — skip to preserve user edits
      } catch {
        // File doesn't exist — create with pre-filled content
        await fs.writeFile(filePath, await generatePreFilledContent(doc, projectPath));
      }
    }
  }

  // Clear search engine BEFORE loading state to avoid duplicate ID errors
  // The search engine singleton persists across tool calls in the MCP server
  searchEngine.removeAll();

  await loadStateFromDisk(projectPath);

  const actualDocs = await getActualDocs(docsPath);
  for (const doc of actualDocs) {
    await enhanceDocFile(doc, projectPath);
  }

  invalidateContextCache();
  const gitInfo = await getGitInfo(projectPath);
  await saveStateToDisk(projectPath);

  return {
    message: "Documentation structure initialized with metadata and context",
    docsPath,
    files: actualDocs,
    metadata: state.metadata,
    gitInfo,
    contextCache: { timestamp: state.contextCache.timestamp, ttl: CACHE_TTL },
    persistedAt: state.lastPersistedAt
  };
}

// ---------------------------------------------------------------------------
// Reset mode — clears state + search index, then re-analyzes
// ---------------------------------------------------------------------------

async function handleResetMode(projectPath: string) {
  const docsPath = getDocsPath(projectPath);

  try {
    await fs.access(docsPath);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `Documentation directory not found at ${docsPath}`);
  }

  await loadStateFromDisk(projectPath);
  resetState();
  searchEngine.removeAll();
  clearSignatureCache();

  const files = await fs.readdir(docsPath);
  const markdownFiles = files.filter(f => f.endsWith(".md"));

  if (markdownFiles.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `No markdown files found in ${docsPath}`);
  }

  for (const doc of markdownFiles) {
    await enhanceDocFile(doc, projectPath);
  }

  invalidateContextCache();
  const gitInfo = await getGitInfo(projectPath);
  await saveStateToDisk(projectPath);

  return {
    message: "Existing documentation analyzed and enhanced",
    docsPath,
    files: markdownFiles,
    metadata: state.metadata,
    gitInfo,
    contextCache: { timestamp: state.contextCache.timestamp, ttl: CACHE_TTL },
    persistedAt: state.lastPersistedAt
  };
}

// ---------------------------------------------------------------------------
// Combined handler
// ---------------------------------------------------------------------------

export const analyzeProject = async (request: CallToolRequest) => {
  const { projectPath, options = {} } = request.params.arguments as {
    projectPath: string;
    options?: {
      mode?: "init" | "analyze" | "reset";
      initDocs?: boolean;
    };
  };

  const { mode = "analyze", initDocs = true } = options;

  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid project path: ${validation.error}`);
  }

  try {
    let result: Record<string, unknown>;

    switch (mode) {
      case "init":
        result = await handleInitMode(projectPath);
        break;
      case "analyze":
        result = await handleAnalyzeMode(projectPath, initDocs);
        break;
      case "reset":
        result = await handleResetMode(projectPath);
        break;
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "analyzing project");
  }
};
