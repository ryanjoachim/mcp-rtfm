// ============================================================================
// Refresh and Handoff Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { state, saveStateToDisk } from "../persistence.js";
import {
  getActualDocs, handleToolError, slugToTitle, freshTimestamp,
  getDocsPath, invalidateContextCache, enhanceDoc
} from "../utils.js";
import { analyzeAndIndexDoc } from "../content.js";
import { detectProjectSignature, refreshDocContent } from "../project.js";
import {
  isGitRepository, detectGitChanges, detectFileChanges,
  generateRefreshSuggestions, calculateSummary, applySuggestion
} from "../changes.js";
import { validateProjectPath } from "../validation.js";
import type { DocMetadata } from "../types.js";

// ---------------------------------------------------------------------------
// Combined refresh handler
// ---------------------------------------------------------------------------

export const refreshDocumentation = async (request: CallToolRequest) => {
  const { projectPath, options = {} } = request.params.arguments as {
    projectPath: string;
    options?: {
      mode?: "sync" | "analyze";
      dryRun?: boolean;
      includeStats?: boolean;
      targetDocs?: string[];
      docFile?: string;
      metadata?: Partial<Pick<DocMetadata, "title" | "category" | "tags">>;
    };
  };

  const { mode = "sync", dryRun = true, includeStats = true } = options;

  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid project path: ${validation.error}`);
  }

  try {
    return mode === "analyze"
      ? handleRefreshAnalyzeMode(request)
      : handleSyncMode(request);
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "refreshing documentation");
  }
};

// ---------------------------------------------------------------------------
// Analyze mode — re-analyzes content, regenerates metadata, refreshes body
// ---------------------------------------------------------------------------

async function handleRefreshAnalyzeMode(request: CallToolRequest) {
  const { projectPath, options = {} } = request.params.arguments as {
    projectPath: string;
    options?: {
      docFile?: string;
      metadata?: Partial<Pick<DocMetadata, "title" | "category" | "tags">>;
    };
  };

  const { docFile, metadata } = options;

  const signature = await detectProjectSignature(projectPath);
  const docsPath = getDocsPath(projectPath);
  const docsToUpdate = docFile ? [docFile] : await getActualDocs(docsPath);

  const results: Array<{ file: string; updated: boolean; message: string }> = [];

  for (const doc of docsToUpdate) {
    const filePath = `${docsPath}/${doc}`;
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      results.push({ file: doc, updated: false, message: "File not found" });
      continue;
    }

    // Re-analyze and build metadata
    const { category, tags, relatedDocs } = await analyzeAndIndexDoc(doc, filePath, content, projectPath);
    const fullMetadata: DocMetadata = {
      title: metadata?.title || state.metadata[doc]?.title || slugToTitle(doc),
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

  invalidateContextCache();
  await saveStateToDisk(projectPath);

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
        persistedAt: state.lastPersistedAt
      }, null, 2)
    }]
  };
}

// ---------------------------------------------------------------------------
// Sync mode — detects codebase changes, generates suggestions, applies them
// ---------------------------------------------------------------------------

async function handleSyncMode(request: CallToolRequest) {
  const { projectPath, options = {} } = request.params.arguments as {
    projectPath: string;
    options?: {
      dryRun?: boolean;
      includeStats?: boolean;
      targetDocs?: string[];
    };
  };

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
    : await detectFileChanges(projectPath, state.lastPersistedAt || new Date(0).toISOString());

  const documentation = changes.filter(c => c.isDocumentation);
  const source = changes.filter(c => !c.isDocumentation);
  const suggestions = await generateRefreshSuggestions(projectPath, changes, state.lastPersistedAt || null);

  const result = {
    dryRun,
    timestamp: freshTimestamp(),
    sinceLastPersisted: state.lastPersistedAt || null,
    changes: { detected: includeStats ? changes : [], documentation, source },
    suggestions,
    summary: calculateSummary(suggestions)
  };

  if (!dryRun) {
    for (const suggestion of suggestions) {
      if (targetDocs && !targetDocs.includes(suggestion.docFile)) continue;

      const docPath = `${docsPath}/${suggestion.docFile}`;
      try {
        const applied = await applySuggestion(docPath, suggestion);
        if (applied) {
          const content = await fs.readFile(docPath, "utf8");
          await analyzeAndIndexDoc(suggestion.docFile, docPath, content, projectPath);
        }
      } catch {
        // Skip files we can't update
      }
    }
    state.lastPersistedAt = freshTimestamp();
    await saveStateToDisk(projectPath);
  }

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
