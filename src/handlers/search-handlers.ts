// ============================================================================
// Search and Related Docs Handlers
// ============================================================================

import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { contextManager } from "../project-context.js";
import { searchDocContent, findRelatedDocs } from "../content.js";
import { validateProjectPath, validateDocFile } from "../validation.js";
import { handleToolError } from "../utils.js";
import { SearchDocsSchema, GetRelatedDocsSchema } from "../schemas.js";

// Handler for search_docs
export const searchDocs = async (request: CallToolRequest) => {
  const parsed = SearchDocsSchema.safeParse(request.params.arguments);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  const { projectPath, query } = parsed.data;

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  const ctx = contextManager.getContext(projectPath);

  try {
    const results = await searchDocContent(ctx, projectPath, query);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query,
            totalResults: results.length,
            results,
            searchMethod: ctx.searchEngine.documentCount > 0 ? "fuzzy-indexed" : "regex-scan"
          }, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "searching documentation");
  }
};

// Handler for get_related_docs
export const getRelatedDocs = async (request: CallToolRequest) => {
  const parsed = GetRelatedDocsSchema.safeParse(request.params.arguments);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  const { projectPath, docFile } = parsed.data;

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  validateDocFile(docFile, projectPath);

  const ctx = contextManager.getContext(projectPath);

  try {
    const related = await findRelatedDocs(ctx, docFile, projectPath);
    const metadata = ctx.state.metadata[docFile];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            docFile,
            related,
            metadata
          }, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "finding related docs");
  }
};