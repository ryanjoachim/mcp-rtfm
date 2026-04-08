// ============================================================================
// Git/File Change Detection and Refresh Suggestions
// ============================================================================

import * as fs from "fs/promises";
import { execSync } from "child_process";
import type { ChangedFile, RefreshSuggestion, RefreshResult } from "./types.js";
import { getActualDocs } from "./templates.js";
import { validateProjectPath } from "./validation.js";

// Validate project path before using with git commands
const validatePathForGit = async (projectPath: string): Promise<boolean> =>
  isGitRepository(projectPath);

// Check if directory is inside a git work tree
export const isGitRepository = async (dir: string): Promise<boolean> => {
  const validation = await validateProjectPath(dir);
  if (!validation.isValid) {
    return false;
  }
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: dir, stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

// Parse a single-letter git status to ChangedFile status
export const parseStatus = (status: string): ChangedFile["status"] => {
  const statusMap: Record<string, ChangedFile["status"]> = {
    "M": "modified",
    "A": "added",
    "D": "deleted",
    "R": "renamed",
    "C": "modified",
    "U": "modified"
  };
  return statusMap[status] || "modified";
};

// Generate ASCII project structure tree
export const generateProjectStructure = async (projectPath: string): Promise<string> => {
  const items: string[] = [];
  const projectName = projectPath.split(/[\\/]/).pop() as string;

  const getDir = async (dir: string, prefix = "") => {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries
      .filter(e => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== ".git")
      .sort((a, b) => a.name.localeCompare(b.name));

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const isLast = i === sorted.length - 1;
      const current = prefix + (isLast ? "└── " : "├── ");
      const nextPrefix = prefix + (isLast ? "    " : "│   ");

      if (entry.isDirectory()) {
        items.push(`${current}${entry.name}/`);
        await getDir(`${dir}/${entry.name}`, nextPrefix);
      } else {
        items.push(`${current}${entry.name}`);
      }
    }
  };

  items.push(`${projectName}/`);
  await getDir(projectPath, "");
  return items.join("\n");
};

// Calculate summary of refresh work needed
export const calculateSummary = (suggestions: RefreshSuggestion[]): RefreshResult["summary"] => {
  const docsToUpdate = new Set(suggestions.map(s => s.docFile)).size;
  let estimatedWork: "minimal" | "moderate" | "significant" = "minimal";

  if (suggestions.length > 10 || docsToUpdate > 4) {
    estimatedWork = "significant";
  } else if (suggestions.length > 3 || docsToUpdate > 2) {
    estimatedWork = "moderate";
  }

  return {
    totalFilesChanged: suggestions.length,
    docsToUpdate,
    estimatedWork
  };
};

/**
 * Apply a single refresh suggestion to its doc file.
 * Returns true if the file was modified.
 */
export const applySuggestion = async (docPath: string, suggestion: RefreshSuggestion): Promise<boolean> => {
  const content = await fs.readFile(docPath, "utf8");
  let newContent: string;

  if (suggestion.section === "lastUpdated") {
    newContent = content.replace(
      `lastUpdated: ${suggestion.currentContent.split("lastUpdated: ")[1]}`,
      `lastUpdated: ${suggestion.suggestedContent.split("lastUpdated: ")[1]}`
    );
  } else if (suggestion.section === "Project Structure") {
    newContent = content.replace(suggestion.currentContent, suggestion.suggestedContent);
  } else if (suggestion.section === "New Files") {
    newContent = suggestion.currentContent === ""
      ? content + "\n\n" + suggestion.suggestedContent
      : content;
  } else {
    newContent = content.replace(suggestion.currentContent, suggestion.suggestedContent);
  }

  if (newContent !== content) {
    await fs.writeFile(docPath, newContent, "utf8");
    return true;
  }
  return false;
};

// Detect changes using git
export const detectGitChanges = async (projectPath: string): Promise<ChangedFile[]> => {
  // Validate path before use
  const isValid = await validatePathForGit(projectPath);
  if (!isValid) {
    return [];
  }

  const changes: ChangedFile[] = [];

  try {
    // Get modified/staged files
    const diffOutput = execSync(
      "git diff --name-status HEAD",
      { cwd: projectPath, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
    ).toString().trim();

    // Get untracked files
    const untrackedOutput = execSync(
      "git ls-files --others --exclude-standard",
      { cwd: projectPath, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
    ).toString().trim();

    // Parse diff output (format: "M file.txt", "A newfile.txt", etc.)
    for (const line of diffOutput.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const status = parts[0];
      const path = parts.slice(1).join("\t");
      changes.push({
        path,
        status: parseStatus(status),
        isDocumentation: path.startsWith(".handoff_docs/")
      });
    }

    // Parse untracked files
    for (const path of untrackedOutput.split("\n")) {
      if (!path) continue;
      changes.push({
        path,
        status: "added",
        isDocumentation: path.startsWith(".handoff_docs/")
      });
    }
  } catch {
    // Git commands failed - return empty
  }

  return changes;
};

// Detect file changes by modification time
export const detectFileChanges = async (projectPath: string, since: string): Promise<ChangedFile[]> => {
  const sinceDate = new Date(since);
  const changes: ChangedFile[] = [];

  const scanDir = async (dir: string) => {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.mtime > sinceDate) {
            changes.push({
              path: fullPath.replace(projectPath + "/", ""),
              status: "modified",
              lastModified: stat.mtime.toISOString(),
              isDocumentation: fullPath.includes(".handoff_docs/")
            });
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  };

  await scanDir(projectPath);
  return changes;
};

// Generate refresh suggestions based on detected changes
export const generateRefreshSuggestions = async (
  projectPath: string,
  changes: ChangedFile[],
  since: string | null
): Promise<RefreshSuggestion[]> => {
  const suggestions: RefreshSuggestion[] = [];
  const docsPath = `${projectPath}/.handoff_docs`;

  // Suggest updating lastUpdated for handoff docs that have been modified
  const modifiedHandoffDocs = changes.filter(c => c.isDocumentation);
  for (const changed of modifiedHandoffDocs) {
    const docFile = changed.path.replace(".handoff_docs/", "");
    try {
      const content = await fs.readFile(`${docsPath}/${docFile}`, "utf8");
      const lastUpdatedMatch = content.match(/lastUpdated:\s*([^\n]+)/);
      if (lastUpdatedMatch) {
        suggestions.push({
          docFile,
          section: "lastUpdated",
          currentContent: `lastUpdated: ${lastUpdatedMatch[1]}`,
          suggestedContent: `lastUpdated: ${new Date().toISOString()}`,
          reason: `${changed.status} since last documentation refresh`
        });
      }
    } catch {
      // File not found
    }
  }

  // Check if techStack needs updating (package.json changed)
  if (changes.some(f => f.path === "package.json")) {
    try {
      const techStackPath = `${docsPath}/techStack.md`;
      const content = await fs.readFile(techStackPath, "utf8");
      const lastUpdatedMatch = content.match(/lastUpdated:\s*([^\n]+)/);
      if (lastUpdatedMatch) {
        suggestions.push({
          docFile: "techStack.md",
          section: "lastUpdated",
          currentContent: `lastUpdated: ${lastUpdatedMatch[1]}`,
          suggestedContent: `lastUpdated: ${new Date().toISOString()}`,
          reason: "package.json has been modified"
        });
      }
    } catch {
      // File doesn't exist
    }
  }

  // Check if project structure needs updating (source files changed)
  const sourceChanges = changes.filter(c => !c.isDocumentation && c.path.match(/\.(ts|js|tsx|jsx)$/));
  if (sourceChanges.length > 0) {
    try {
      const handoffPath = `${docsPath}/handoff_notes.md`;
      const content = await fs.readFile(handoffPath, "utf8");
      const structureMatch = content.match(/## Project Structure\n```\n([\s\S]*?)```/);
      if (structureMatch) {
        const newStructure = await generateProjectStructure(projectPath);
        if (structureMatch[1] !== newStructure) {
          suggestions.push({
            docFile: "handoff_notes.md",
            section: "Project Structure",
            currentContent: structureMatch[0],
            suggestedContent: `## Project Structure\n\`\`\`\n${newStructure}\`\`\``,
            reason: `${sourceChanges.length} source file(s) changed`
          });
        }
      }
    } catch {
      // File doesn't exist
    }
  }

  // Check for new source files that might need documenting
  const newSourceFiles = changes.filter(c => !c.isDocumentation && c.status === "added");
  if (newSourceFiles.length > 0) {
    suggestions.push({
      docFile: "codebaseDetails.md",
      section: "New Files",
      currentContent: "",
      suggestedContent: newSourceFiles.map(f => `- ${f.path}`).join("\n"),
      reason: `${newSourceFiles.length} new file(s) detected`
    });
  }

  return suggestions;
};
