// ============================================================================
// Path Validation and Security
// ============================================================================

import * as fs from "fs/promises";
import path from "path";
import { sourceExtensions } from "./utils.js";

// Characters that could enable command injection or path traversal
const DANGEROUS_CHARS = /[;&|`$()>{}[\]!\\]/;
const PATH_TRAVERSAL = /\.\.\//;

export interface PathValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate that a project path is safe to use.
 * Prevents command injection and path traversal attacks.
 */
export const validateProjectPath = async (projectPath: string): Promise<PathValidationResult> => {
  if (!projectPath || typeof projectPath !== "string") {
    return { isValid: false, error: "Project path must be a non-empty string" };
  }

  // Check for dangerous shell characters
  if (DANGEROUS_CHARS.test(projectPath)) {
    return { isValid: false, error: "Project path contains invalid characters" };
  }

  // Check for path traversal attempts
  if (PATH_TRAVERSAL.test(projectPath)) {
    return { isValid: false, error: "Project path contains path traversal sequences" };
  }

  // Resolve to absolute path and verify it exists
  let absolutePath: string;
  try {
    absolutePath = path.resolve(projectPath);
  } catch {
    return { isValid: false, error: "Invalid project path" };
  }

  // Check that the path exists and is a directory
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      return { isValid: false, error: "Project path must be a directory" };
    }
  } catch {
    return { isValid: false, error: "Project path does not exist" };
  }

  return { isValid: true };
};

/**
 * Ensure a file path is within the expected directory (prevents path traversal)
 */
export const ensurePathWithinDirectory = (filePath: string, baseDir: string): string => {
  const resolvedFile = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
    throw new Error(`Path traversal attempt detected: ${filePath}`);
  }

  return resolvedFile;
};

// ============================================================================
// Documentation Validation
// ============================================================================

import { getActualDocs } from "./templates.js";
import { analyzeContent } from "./content.js";
import type { ValidationResult as DocValidationResult } from "./types.js";

// Normalize code snippet for comparison (remove extra whitespace, comments, etc.)
export const normalizeSnippet = (snippet: string): string => {
  return snippet
    .replace(/\/\/.*$/gm, "") // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
};

// Find code snippet in source files
export const findSnippetInSource = async (projectPath: string, snippet: string): Promise<boolean> => {
  const normalizedSnippet = normalizeSnippet(snippet);
  if (normalizedSnippet.length < 20) return true; // Too short to validate reliably


  const searchDir = async (dir: string): Promise<boolean> => {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".handoff_docs") continue;

      const fullPath = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        if (await searchDir(fullPath)) return true;
      } else if (entry.isFile() && sourceExtensions.some(ext => entry.name.endsWith(ext))) {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          if (content.includes(normalizedSnippet)) {
            return true;
          }
        } catch {
          // Skip files we can't read
        }
      }
    }

    return false;
  };

  return await searchDir(projectPath);
};

// Validate documentation
export const validateDocumentation = async (
  projectPath: string,
  level: "basic" | "deep" = "basic"
): Promise<DocValidationResult> => {
  const issues: DocValidationResult["issues"] = [];
  const docsPath = `${projectPath}/.handoff_docs`;
  const actualDocs = await getActualDocs(docsPath);

  let checkedLinks = 0;
  let checkedSnippets = 0;

  for (const doc of actualDocs) {
    const filePath = `${docsPath}/${doc}`;
    const content = await fs.readFile(filePath, "utf8");
    const analysis = await analyzeContent(content);

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

    // Validate code snippets in deep mode
    if (level === "deep") {
      for (const codeBlock of analysis.codeBlocks) {
        checkedSnippets++;
        const exists = await findSnippetInSource(projectPath, codeBlock);
        if (!exists) {
          issues.push({
            file: doc,
            type: "stale_snippet",
            location: "Code block",
            message: "Code snippet may be outdated (not found in current source)",
            severity: "warning"
          });
        }
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
      checkedSnippets
    }
  };
};
