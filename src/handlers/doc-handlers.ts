// ============================================================================
// Document Read/Write Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { state } from "../state.js";
import { withFileLock, saveStateToDisk } from "../persistence.js";
import { analyzeContent, categorizeContent, updateMetadata, updateSearchIndex } from "../content.js";
import { getActualDocs } from "../templates.js";
import { validateProjectPath } from "../validation.js";
import { handleToolError, freshTimestamp, getDocsPath, invalidateContextCache } from "../utils.js";

// Handler for read_doc (combines read_doc and get_doc_content)
export const readDoc = async (request: CallToolRequest) => {
  const { projectPath, docFile, trackState = true } = request.params.arguments as {
    projectPath: string;
    docFile: string;
    trackState?: boolean;
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

    if (trackState) {
      state.lastReadFile = docFile;
      state.lastReadContent = content;
      state.currentFile = docFile;
      state.inProgress = true;
    }

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
  const { projectPath, docFile, searchContent, replaceContent, continueToNext = false, content } =
    request.params.arguments as {
      projectPath: string;
      docFile: string;
      searchContent: string;
      replaceContent: string;
      continueToNext?: boolean;
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

  try {
    const filePath = `${getDocsPath(projectPath)}/${docFile}`;

    await withFileLock(filePath, async () => {
      // Determine source content: provided directly or from state
      let fileContent: string;
      if (content !== undefined) {
        fileContent = content;
      } else if (state.lastReadFile === docFile && state.lastReadContent) {
        fileContent = state.lastReadContent;
      } else {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Must call read_doc first or provide content parameter`
        );
      }

      // Verify the search content exists in the file
      if (!fileContent.includes(searchContent)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Search content not found in ${docFile}`
        );
      }

      // Apply the diff
      const newContent = fileContent.replace(searchContent, replaceContent);
      await fs.writeFile(filePath, newContent, "utf8");

      // Update state
      state.lastReadContent = newContent;
      if (!state.completedFiles.includes(docFile)) {
        state.completedFiles.push(docFile);
      }

      // Advance to next file if continueToNext is true
      if (continueToNext) {
        const allDocs = await getActualDocs(getDocsPath(projectPath));
        const currentIndex = allDocs.indexOf(docFile);
        if (currentIndex < allDocs.length - 1) {
          state.currentFile = allDocs[currentIndex + 1];
        }
        state.continueToNext = true;
      }

      // Update search index and metadata
      try {
        const analysis = await analyzeContent(newContent);
        const { category, tags } = categorizeContent(docFile, newContent, analysis);
        await updateMetadata(filePath, { title: analysis.title || docFile, category, tags });
        updateSearchIndex(docFile, newContent, {
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
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Documentation updated: ${docFile}`,
            updated: docFile,
            continued: continueToNext && state.currentFile !== docFile,
            currentFile: state.currentFile
          }, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "updating documentation");
  }
};

