// ============================================================================
// Project Info, Content Gaps, Validation, and Template Handlers
// ============================================================================

import * as fs from "fs/promises";
import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { state } from "../state.js";
import { saveStateToDisk } from "../persistence.js";
import { getActualDocs } from "../templates.js";
import { analyzeContentGaps as findContentGaps } from "../symbols.js";
import { validateDocumentation as validateDocs, validateProjectPath } from "../validation.js";
import { getGitInfo, handleToolError } from "../utils.js";
import type { DocTemplate } from "../types.js";

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
    const gitInfo = getGitInfo(projectPath);

    // Get package.json if it exists
    let packageInfo = {};
    try {
      const packageJson = await fs.readFile(`${projectPath}/package.json`, "utf8");
      packageInfo = JSON.parse(packageJson);
    } catch {
      // No package.json or invalid JSON
    }

    // Get directory structure
    const getDirectoryStructure = async (dir: string, depth = 3): Promise<any> => {
      if (depth === 0) return "...";

      const items = await fs.readdir(dir, { withFileTypes: true });
      const structure: Record<string, any> = {};

      for (const item of items) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;

        if (item.isDirectory()) {
          structure[item.name] = await getDirectoryStructure(`${dir}/${item.name}`, depth - 1);
        } else {
          structure[item.name] = null;
        }
      }

      return structure;
    };

    const projectStructure = await getDirectoryStructure(projectPath);
    const docsPath = `${projectPath}/.handoff_docs`;
    const actualDocs = await getActualDocs(docsPath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            gitInfo,
            packageInfo,
            projectStructure,
            docsStatus: {
              completed: state.completedFiles,
              current: state.currentFile,
              inProgress: state.inProgress,
              lastRead: state.lastReadFile,
              remaining: actualDocs.filter(doc => !state.completedFiles.includes(doc))
            }
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
  const { projectPath, validationLevel = "basic" } = request.params.arguments as {
    projectPath: string;
    validationLevel?: "basic" | "deep";
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
    const result = await validateDocs(projectPath, validationLevel);

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
          validationLevel,
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

// Handler for customize_template
export const customizeTemplate = async (request: CallToolRequest) => {
  const { projectPath, templateName, content, metadata } = request.params.arguments as {
    projectPath?: string;
    templateName: string;
    content: string;
    metadata?: { category?: string; tags?: string[] };
  };

  // Validate project path if provided
  if (projectPath) {
    const validation = await validateProjectPath(projectPath);
    if (!validation.isValid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid project path: ${validation.error}`
      );
    }
  }

  try {
    const template: DocTemplate = {
      name: templateName,
      content,
      metadata: metadata || {}
    };

    state.templateOverrides[templateName] = template;

    // Persist if projectPath is provided
    if (projectPath) {
      await saveStateToDisk(projectPath);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: projectPath
              ? `Template '${templateName}' saved and persisted`
              : `Template '${templateName}' saved (not persisted - no projectPath provided)`,
            template: {
              name: templateName,
              metadata: template.metadata
            },
            persistedAt: state.lastPersistedAt
          }, null, 2)
        }
      ]
    };
  } catch (error: unknown) {
    if (error instanceof McpError) throw error;
    return handleToolError(error, "customizing template");
  }
};
