// ============================================================================
// Refresh and Handoff Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { contextManager } from "../project-context.js";
import {
  getActualDocs, handleToolError, slugToTitle, freshTimestamp,
  getDocsPath, enhanceDoc
} from "../utils.js";
import { analyzeAndIndexDoc } from "../content.js";
import { detectProjectSignature, refreshDocContent } from "../project.js";
import {
  isGitRepository, detectGitChanges, detectFileChanges,
  generateRefreshSuggestions, calculateSummary, applySuggestion
} from "../changes.js";
import { validateProjectPath, validateDocFile } from "../validation.js";
import { logger } from "../logger.js";
import { RefreshDocumentationSchema } from "../schemas.js";
import type { DocMetadata } from "../types.js";

// ---------------------------------------------------------------------------
// Combined refresh handler
// ---------------------------------------------------------------------------

export const refreshDocumentation = async (request: CallToolRequest) => {
  const parsed = RefreshDocumentationSchema.safeParse(request.params.arguments);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  const { projectPath, options } = parsed.data;
  const mode = options?.mode ?? "sync";
  const dryRun = options?.dryRun ?? true;
  const includeStats = options?.includeStats ?? true;

  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid project path: ${validation.error}`);
  }

  const ctx = contextManager.getContext(projectPath);

  try {
    return mode === "analyze"
      ? handleRefreshAnalyzeMode(ctx, projectPath, options ?? {})
      : handleSyncMode(ctx, projectPath, options ?? {});
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "refreshing documentation");
  }
};

// ---------------------------------------------------------------------------
// Analyze mode — re-analyzes content, regenerates metadata, refreshes body
// ---------------------------------------------------------------------------

async function handleRefreshAnalyzeMode(ctx: ReturnType<typeof contextManager.getContext>, projectPath: string, options: { docFile?: string; metadata?: Partial<Pick<DocMetadata, "title" | "category" | "tags">> }) {
  const { docFile, metadata } = options;

  if (docFile) {
    validateDocFile(docFile, projectPath);
  }

  const signature = await detectProjectSignature(projectPath);
  const docsPath = getDocsPath(projectPath);
  const docsToUpdate = docFile ? [docFile] : await getActualDocs(docsPath);

  const results: Array<{ file: string; updated: boolean; message: string }> = [];

  for (const doc of docsToUpdate) {
    const filePath = validateDocFile(doc, projectPath);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      logger.warn("refresh", "Failed to read doc file during refresh", error);
      results.push({ file: doc, updated: false, message: "File not found" });
      continue;
    }

    // Re-analyze and build metadata
    const { category, tags, relatedDocs } = await analyzeAndIndexDoc(ctx, doc, filePath, content, projectPath);
    const fullMetadata: DocMetadata = {
      title: metadata?.title || ctx.state.metadata[doc]?.title || slugToTitle(doc),
      category: metadata?.category || category,
      tags: metadata?.tags || tags,
      lastUpdated: freshTimestamp(),
      relatedDocs
    };

    // Refresh body content based on project signature
    let updatedContent = refreshDocContent(doc, content, signature);

    // Update front matter
    const changed = await enhanceDoc(filePath, updatedContent, fullMetadata, relatedDocs);

    results.push({
      file: doc,
      updated: changed,
      message: changed ? "Updated front matter and body" : "No changes needed"
    });
  }

  ctx.invalidateContextCache();
  await ctx.saveStateToDisk();

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        message: docFile ? "Handoff document refreshed" : "All handoff documents refreshed",
        files: results,
        signature: {
          frameworks: signature.frameworks,
          patterns: signature.patterns
        },
        persistedAt: ctx.state.lastPersistedAt
      }, null, 2)
    }]
  };
}

// ---------------------------------------------------------------------------
// Sync mode — detects codebase changes, generates suggestions, applies them
// ---------------------------------------------------------------------------

async function handleSyncMode(ctx: ReturnType<typeof contextManager.getContext>, projectPath: string, options: { dryRun?: boolean; includeStats?: boolean; targetDocs?: string[] }) {
  const { dryRun = true, includeStats = true, targetDocs } = options;
  const docsPath = getDocsPath(projectPath);

  try {
    await fs.access(docsPath);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, `Documentation directory not found at ${docsPath}`);
  }

  const isGit = await isGitRepository(projectPath);
  const changes = isGit
    ? await detectGitChanges(projectPath)
    : await detectFileChanges(projectPath, ctx.state.lastPersistedAt || new Date(0).toISOString());

  const documentation = changes.filter(c => c.isDocumentation);
  const source = changes.filter(c => !c.isDocumentation);
  const suggestions = await generateRefreshSuggestions(projectPath, changes, ctx.state.lastPersistedAt || null);

  const result = {
    dryRun,
    timestamp: freshTimestamp(),
    sinceLastPersisted: ctx.state.lastPersistedAt || null,
    changes: { detected: includeStats ? changes : [], documentation, source },
    suggestions,
    summary: calculateSummary(suggestions)
  };

  if (!dryRun) {
    for (const suggestion of suggestions) {
      if (targetDocs && !targetDocs.includes(suggestion.docFile)) continue;

      // Validate docFile stays within .handoff_docs before writing
      const docPath = validateDocFile(suggestion.docFile, projectPath);
      try {
        const applied = await applySuggestion(docPath, suggestion);
        if (applied) {
          const content = await fs.readFile(docPath, "utf8");
          await analyzeAndIndexDoc(ctx, suggestion.docFile, docPath, content, projectPath);
        }
      } catch (error) {
        logger.warn("refresh", "Failed to apply suggestion to doc file", error);
      }
    }
    ctx.state.lastPersistedAt = freshTimestamp();
    await ctx.saveStateToDisk();
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}