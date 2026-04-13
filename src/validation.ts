// ============================================================================
// Path Validation and Security
// ============================================================================

import * as fs from "fs/promises";
import path from "path";
import { logger } from "./logger.js";

// Path traversal pattern
const PATH_TRAVERSAL = /\.\.\//;

export interface PathValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate that a project path is safe to use.
 * Prevents path traversal attacks and verifies the directory exists.
 */
export const validateProjectPath = async (projectPath: string): Promise<PathValidationResult> => {
  if (!projectPath || typeof projectPath !== "string") {
    return { isValid: false, error: "Project path must be a non-empty string" };
  }

  // Check for path traversal attempts
  if (PATH_TRAVERSAL.test(projectPath)) {
    return { isValid: false, error: "Project path contains path traversal sequences" };
  }

  // Resolve to absolute path and verify it exists
  let absolutePath: string;
  try {
    absolutePath = path.resolve(projectPath);
  } catch (error) {
    logger.warn("validation", "Failed to resolve project path", error);
    return { isValid: false, error: "Invalid project path" };
  }

  // Check that the path exists and is a directory
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      return { isValid: false, error: "Project path must be a directory" };
    }
  } catch (error) {
    logger.warn("validation", "Project path does not exist", error);
    return { isValid: false, error: "Project path does not exist" };
  }

  return { isValid: true };
};

// ============================================================================
// Documentation Validation
// ============================================================================

import { getActualDocs } from "./utils.js";
import type { ValidationResult as DocValidationResult } from "./types.js";

// Validate documentation (basic mode only — checks wiki-links)
export const validateDocumentation = async (
  projectPath: string
): Promise<DocValidationResult> => {
  const issues: DocValidationResult["issues"] = [];
  const docsPath = `${projectPath}/.handoff_docs`;
  const actualDocs = await getActualDocs(docsPath);

  let checkedLinks = 0;

  for (const doc of actualDocs) {
    const content = await fs.readFile(`${docsPath}/${doc}`, "utf8");

    // Validate [[links]]
    const linkMatches = content.match(/\[\[([^\]]+)\]\]/g) || [];
    for (const match of linkMatches) {
      checkedLinks++;
      const linkedDoc = match.slice(2, -2).trim() + ".md";
      if (!actualDocs.includes(linkedDoc)) {
        issues.push({
          file: doc,
          type: "broken_link",
          location: `Line ${content.substring(0, content.indexOf(match)).split("\n").length}`,
          message: `Broken link to [[${linkedDoc.replace(".md", "")}]] - file not found`,
          severity: "error"
        });
      }
    }
  }

  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.filter(i => i.severity === "warning").length;

  return {
    isValid: errors === 0,
    issues,
    summary: {
      totalIssues: issues.length,
      errors,
      warnings,
      checkedDocs: actualDocs.length,
      checkedLinks,
      checkedSnippets: 0
    }
  };
};
