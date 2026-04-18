// ============================================================================
// Analysis Tool Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { contextManager } from "../project-context.js";
import {
  BASE_DOCS, getActualDocs, TEMPLATE_CONTENT,
  enhanceDoc, getGitInfo, slugToTitle,
  handleToolError, getDocsPath
} from "../utils.js";
import { logger } from "../logger.js";
import { analyzeAndIndexDoc } from "../content.js";
import { generatePreFilledContent, clearSignatureCache } from "../project.js";
import { validateProjectPath, validateDocFile } from "../validation.js";
import { CACHE_TTL } from "../types.js";
import { AnalyzeProjectSchema } from "../schemas.js";

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
      // File doesn't exist — create it with template content
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

async function enhanceDocFile(ctx: ReturnType<typeof contextManager.getContext>, doc: string, projectPath: string) {
  const filePath = validateDocFile(doc, projectPath);
  const content = await fs.readFile(filePath, "utf8");

  const { relatedDocs } = await analyzeAndIndexDoc(ctx, doc, filePath, content, projectPath);
  const metadata = ctx.state.metadata[doc]!;
  await enhanceDoc(filePath, content, metadata, relatedDocs);
}

// ---------------------------------------------------------------------------
// Analyze mode — enhances existing docs with metadata, preserves state
// ---------------------------------------------------------------------------

async function handleAnalyzeMode(projectPath: string, initDocs: boolean) {
  const ctx = contextManager.getContext(projectPath);
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
  ctx.searchEngine.removeAll();

  await ctx.loadStateFromDisk();

  const actualDocs = await getActualDocs(docsPath);
  for (const doc of actualDocs) {
    await enhanceDocFile(ctx, doc, projectPath);
  }

  ctx.invalidateContextCache();
  const gitInfo = await getGitInfo(projectPath);
  await ctx.saveStateToDisk();

  return {
    message: "Documentation structure initialized with metadata and context",
    docsPath,
    files: actualDocs,
    metadata: ctx.state.metadata,
    gitInfo,
    contextCache: { timestamp: ctx.state.contextCache.timestamp, ttl: CACHE_TTL },
    persistedAt: ctx.state.lastPersistedAt
  };
}

// ---------------------------------------------------------------------------
// Reset mode — clears state + search index, then re-analyzes
// ---------------------------------------------------------------------------

async function handleResetMode(projectPath: string) {
  const ctx = contextManager.getContext(projectPath);
  const docsPath = getDocsPath(projectPath);

  try {
    await fs.access(docsPath);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `Documentation directory not found at ${docsPath}`);
  }

  await ctx.loadStateFromDisk();
  ctx.resetState();
  clearSignatureCache();

  const files = await fs.readdir(docsPath);
  const markdownFiles = files.filter(f => f.endsWith(".md"));

  if (markdownFiles.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `No markdown files found in ${docsPath}`);
  }

  for (const doc of markdownFiles) {
    await enhanceDocFile(ctx, doc, projectPath);
  }

  ctx.invalidateContextCache();
  const gitInfo = await getGitInfo(projectPath);
  await ctx.saveStateToDisk();

  return {
    message: "Existing documentation analyzed and enhanced",
    docsPath,
    files: markdownFiles,
    metadata: ctx.state.metadata,
    gitInfo,
    contextCache: { timestamp: ctx.state.contextCache.timestamp, ttl: CACHE_TTL },
    persistedAt: ctx.state.lastPersistedAt
  };
}

// ---------------------------------------------------------------------------
// Combined handler
// ---------------------------------------------------------------------------

export const analyzeProject = async (request: CallToolRequest) => {
  const parsed = AnalyzeProjectSchema.safeParse(request.params.arguments);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  const { projectPath, options } = parsed.data;
  const mode = options?.mode ?? "analyze";
  const initDocs = options?.initDocs ?? true;

  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid project path: ${validation.error}`);
  }
  const resolvedPath = validation.resolvedPath!;

  try {
    let result: Record<string, unknown>;

    switch (mode) {
      case "init":
        result = await handleInitMode(resolvedPath);
        break;
      case "analyze":
        result = await handleAnalyzeMode(resolvedPath, initDocs);
        break;
      case "reset":
        result = await handleResetMode(resolvedPath);
        break;
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "analyzing project");
  }
};