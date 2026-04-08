// ============================================================================
// Search and Related Docs Handlers
// ============================================================================

import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { state } from "../state.js";
import { searchDocContent, findRelatedDocs } from "../content.js";
import { validateProjectPath } from "../validation.js";
import { handleToolError } from "../utils.js";

// Handler for search_docs
export const searchDocs = async (request: CallToolRequest) => {
  const { projectPath, query } = request.params.arguments as {
    projectPath: string;
    query: string;
  };

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  try {
    const results = await searchDocContent(projectPath, query);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query,
            results,
            cached: state.contextCache.lastQuery === query,
            timestamp: state.contextCache.timestamp
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
  const { projectPath, docFile } = request.params.arguments as {
    projectPath: string;
    docFile: string;
  };

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  try {
    const related = await findRelatedDocs(docFile, projectPath);
    const metadata = state.metadata[docFile];

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
