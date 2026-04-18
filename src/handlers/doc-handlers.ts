// ============================================================================
// Document Read/Write Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { contextManager } from "../project-context.js";
import { analyzeContent, categorizeContent, updateMetadata, updateSearchIndex } from "../content.js";
import { validateProjectPath, validateDocFile } from "../validation.js";
import { handleToolError, freshTimestamp } from "../utils.js";
import { logger } from "../logger.js";
import { ReadDocSchema, UpdateDocSchema } from "../schemas.js";

// Handler for read_doc
export const readDoc = async (request: CallToolRequest) => {
  const parsed = ReadDocSchema.safeParse(request.params.arguments);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  const { projectPath, docFile } = parsed.data;

  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  const filePath = validateDocFile(docFile, projectPath);

  try {
    const content = await fs.readFile(filePath, "utf8");

    return {
      content: [{ type: "text", text: content }]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "reading documentation");
  }
};

// Handler for update_doc
export const updateDoc = async (request: CallToolRequest) => {
  const parsed = UpdateDocSchema.safeParse(request.params.arguments);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  const { projectPath, docFile, searchContent, replaceContent, content } = parsed.data;

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  const filePath = validateDocFile(docFile, projectPath);

  const ctx = contextManager.getContext(projectPath);

  try {

    // Read current file content
    let fileContent = await fs.readFile(filePath, "utf8");

    if (content !== undefined) {
      // Full content replacement
      fileContent = content;
    } else if (searchContent && replaceContent) {
      // Diff-based update: verify the search content exists
      if (!fileContent.includes(searchContent)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Search content not found in ${docFile}`
        );
      }
      fileContent = fileContent.replace(searchContent, replaceContent);
    }

    await fs.writeFile(filePath, fileContent, "utf8");

    // Update search index and metadata
    try {
      const analysis = await analyzeContent(fileContent);
      const { category, tags } = categorizeContent(docFile, fileContent, analysis);
      await updateMetadata(ctx, filePath, { title: analysis.title || docFile, category, tags });
      updateSearchIndex(ctx, docFile, fileContent, {
        title: analysis.title || docFile,
        category,
        tags,
        lastUpdated: freshTimestamp(),
        relatedDocs: []
      });
    } catch (error) {
      logger.error("doc-handlers", "Failed to update search index after doc update", error);
    }

    // Invalidate context cache
    ctx.invalidateContextCache();

    // Persist state
    await ctx.saveStateToDisk();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Documentation updated: ${docFile}`,
            updated: docFile
          }, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "updating documentation");
  }
};