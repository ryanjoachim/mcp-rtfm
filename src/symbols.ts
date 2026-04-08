// ============================================================================
// Symbol Extraction and Content Gap Analysis
// ============================================================================

import * as fs from "fs/promises";
import { getActualDocs } from "./templates.js";
import { sourceExtensions } from "./utils.js";
import type { CodeSymbol, ContentGap } from "./types.js";

// Extract symbols from source code files
export const extractSymbols = async (projectPath: string, targetFiles?: string[]): Promise<CodeSymbol[]> => {
  const symbols: CodeSymbol[] = [];

  const scanDir = async (dir: string) => {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["node_modules", ".handoff_docs", "build", "dist"].includes(entry.name)) continue;

      const fullPath = `${dir}/${entry.name}`;
      const relativePath = fullPath.replace(projectPath + "/", "");

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && sourceExtensions.some(ext => entry.name.endsWith(ext))) {
        // Skip if targetFiles is specified and this file isn't in the list
        if (targetFiles && !targetFiles.some(tf => relativePath.endsWith(tf))) {
          continue;
        }

        try {
          const content = await fs.readFile(fullPath, "utf8");
          const lines = content.split("\n");

          // Pattern matching for various symbol types
          const patterns = [
            // Export functions: export function name(... or export const name = ... or export async function name(...
            { type: "function" as const, regex: /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*[=:]/g },
            // Classes: export class Name or class Name
            { type: "class" as const, regex: /(?:export\s+)?class\s+(\w+)/g },
            // Interfaces: export interface Name or interface Name
            { type: "interface" as const, regex: /(?:export\s+)?interface\s+(\w+)/g },
            // Types: export type Name or type Name
            { type: "type" as const, regex: /(?:export\s+)?type\s+(\w+)/g },
            // Express/Fastify routes: app.get('/path', ...), router.post('/path', ...)
            { type: "api_route" as const, regex: /(?:app|router|server)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/g },
            // Decorator-based routes: @Get('/path'), @Post('/path')
            { type: "api_route" as const, regex: /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)/g }
          ];

          for (const { type, regex } of patterns) {
            let match;
            while ((match = regex.exec(content)) !== null) {
              const name = match[1] || match[2];
              if (name && !name.startsWith("_")) {
                // Calculate line number from match position
                const lineNumber = content.substring(0, match.index).split('\n').length;
                // Calculate signature (capture until opening brace or end of line)
                const contentAfterMatch = content.substring(match.index);
                const braceIndex = contentAfterMatch.indexOf('{');
                const signature = braceIndex !== -1
                  ? contentAfterMatch.substring(0, braceIndex).trim()
                  : lines[lineNumber - 1]?.trim();

                symbols.push({
                  name,
                  type,
                  filePath: relativePath,
                  lineNumber,
                  signature
                });
              }
            }
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  };

  await scanDir(projectPath);
  return symbols;
};

// Check if a symbol is mentioned in documentation
export const isSymbolDocumented = async (symbol: CodeSymbol, projectPath: string): Promise<boolean> => {
  const docsPath = `${projectPath}/.handoff_docs`;
  const actualDocs = await getActualDocs(docsPath);

  for (const doc of actualDocs) {
    try {
      const content = await fs.readFile(`${docsPath}/${doc}`, "utf8");
      // Check if symbol name appears in the document
      if (content.includes(symbol.name)) {
        return true;
      }
    } catch {
      // Skip files we can't read
    }
  }
  return false;
};

// Determine which doc file should contain documentation for a symbol
export const suggestDocForSymbol = (symbol: CodeSymbol): string => {
  if (symbol.type === "api_route") {
    return "integrationGuides.md";
  }
  if (["class", "interface", "type"].includes(symbol.type)) {
    return "codebaseDetails.md";
  }
  if (symbol.filePath.includes("util") || symbol.filePath.includes("helper")) {
    return "codebaseDetails.md";
  }
  if (symbol.filePath.includes("test") || symbol.filePath.includes("spec")) {
    return "workflowDetails.md";
  }
  return "codebaseDetails.md";
};

// Analyze content gaps
export const analyzeContentGaps = async (projectPath: string, targetFiles?: string[]): Promise<ContentGap[]> => {
  const symbols = await extractSymbols(projectPath, targetFiles);
  const gaps: ContentGap[] = [];

  for (const symbol of symbols) {
    const isDocumented = await isSymbolDocumented(symbol, projectPath);
    if (!isDocumented) {
      gaps.push({
        symbol,
        suggestedDoc: suggestDocForSymbol(symbol),
        reason: `${symbol.type} '${symbol.name}' in ${symbol.filePath} is not mentioned in any documentation`
      });
    }
  }

  return gaps;
};
