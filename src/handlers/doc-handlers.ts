// ============================================================================
// Document Read/Write Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { saveStateToDisk } from "../persistence.js";
import { analyzeContent, categorizeContent, updateMetadata, updateSearchIndex } from "../content.js";
import { validateProjectPath } from "../validation.js";
import { handleToolError, freshTimestamp, getDocsPath, invalidateContextCache } from "../utils.js";

// Handler for read_doc
export const readDoc = async (request: CallToolRequest) => {
  const { projectPath, docFile } = request.params.arguments as {
    projectPath: string;
    docFile: string;
  };

  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  try {
    const filePath = `${getDocsPath(projectPath)}/${docFile}`;
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
  const { projectPath, docFile, searchContent, replaceContent, content } =
    request.params.arguments as {
      projectPath: string;
      docFile: string;
      searchContent?: string;
      replaceContent?: string;
      content?: string;
    };

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  // Require either full content or search+replace
  if (!content && (!searchContent || !replaceContent)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Must provide either 'content' for full replacement, or both 'searchContent' and 'replaceContent' for diff-based update"
    );
  }

  try {
    const filePath = `${getDocsPath(projectPath)}/${docFile}`;

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
      fileContent = fileContent.replaceAll(searchContent, replaceContent);
    }

    await fs.writeFile(filePath, fileContent, "utf8");

    // Update search index and metadata
    try {
      const analysis = await analyzeContent(fileContent);
      const { category, tags } = categorizeContent(docFile, fileContent, analysis);
      await updateMetadata(filePath, { title: analysis.title || docFile, category, tags });
      updateSearchIndex(docFile, fileContent, {
        title: analysis.title || docFile,
        category,
        tags,
        lastUpdated: freshTimestamp(),
        relatedDocs: []
      });
    } catch {
      // Non-fatal: skip search index update if content analysis fails
    }

    // Invalidate context cache
    invalidateContextCache();

    // Persist state
    await saveStateToDisk(projectPath);

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