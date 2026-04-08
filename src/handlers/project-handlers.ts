// ============================================================================
// Project Info, Content Gaps, Validation, and Template Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { state, saveStateToDisk } from "../persistence.js";
import { getActualDocs, getGitInfo, handleToolError } from "../utils.js";
import { analyzeContentGaps as findContentGaps } from "../project.js";
import { validateDocumentation as validateDocs, validateProjectPath } from "../validation.js";

// Handler for get_project_info
export const getProjectInfo = async (request: CallToolRequest) => {
  const { projectPath } = request.params.arguments as { projectPath: string };

  // Validate project path before use
  const validation = await validateProjectPath(projectPath);
  if (!validation.isValid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid project path: ${validation.error}`
    );
  }

  try {
    const gitInfo = await getGitInfo(projectPath);

    // Get package.json if it exists
    let packageInfo = {};
    try {
      const packageJson = await fs.readFile(`${projectPath}/package.json`, "utf8");
      packageInfo = JSON.parse(packageJson);
    } catch {
      // No package.json or invalid JSON
    }

    const docsPath = `${projectPath}/.handoff_docs`;
    const actualDocs = await getActualDocs(docsPath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            gitInfo,
            packageInfo,
            docs: actualDocs,
            totalDocs: actualDocs.length
          }, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "getting project info");
  }
};

// Handler for analyze_content_gaps
export const analyzeContentGapsHandler = async (request: CallToolRequest) => {
  const { projectPath, targetFiles } = request.params.arguments as {
    projectPath: string;
    targetFiles?: string[];
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
    const gaps = await findContentGaps(projectPath, targetFiles);

    // Store in state for persistence
    state.symbolMap = gaps.reduce((acc, gap: any) => {
      if (!acc[gap.symbol.filePath]) acc[gap.symbol.filePath] = [];
      acc[gap.symbol.filePath].push(gap.symbol.name);
      return acc;
    }, {} as Record<string, string[]>);

    await saveStateToDisk(projectPath);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Content gap analysis complete",
          gapsFound: gaps.length,
          gaps: gaps.map((g: any) => ({
            symbol: g.symbol.name,
            type: g.symbol.type,
            file: g.symbol.filePath,
            line: g.symbol.lineNumber,
            suggestedDoc: g.suggestedDoc,
            reason: g.reason
          })),
          summary: {
            byType: gaps.reduce((acc: Record<string, number>, g: any) => {
              acc[g.symbol.type] = (acc[g.symbol.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            bySuggestedDoc: gaps.reduce((acc: Record<string, number>, g: any) => {
              acc[g.suggestedDoc] = (acc[g.suggestedDoc] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          },
          persistedAt: state.lastPersistedAt
        }, null, 2)
      }]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "analyzing content gaps");
  }
};

// Handler for validate_documentation
export const validateDocumentationHandler = async (request: CallToolRequest) => {
  const { projectPath } = request.params.arguments as {
    projectPath: string;
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
    const result = await validateDocs(projectPath);

    // Store validation results in state
    state.validationResults = {
      lastRun: new Date().toISOString(),
      ...result.summary
    };

    await saveStateToDisk(projectPath);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Documentation validation complete",
          ...result,
          persistedAt: state.lastPersistedAt
        }, null, 2)
      }]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "validating documentation");
  }
};
