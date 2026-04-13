// ============================================================================
// Project Analysis: Signature Detection, Symbol Extraction, and Template Generation
// ============================================================================

import * as fs from "fs/promises";
import { TEMPLATE_CONTENT, getActualDocs, sourceExtensions } from "./utils.js";
import { logger } from "./logger.js";
import type { ProjectSignature, CodeSymbol, ContentGap } from "./types.js";

// Cache signature detection results per project path
const signatureCache = new Map<string, ProjectSignature>();

export const clearSignatureCache = () => { signatureCache.clear(); };

const FRAMEWORK_INSIGHTS: Record<string, string[]> = {
  "Express": [
    "Routes are typically defined via app.get/post",
    "Middleware is used for request processing",
    "Error handling is managed by (err, req, res, next) middleware"
  ],
  "React": [
    "Components are defined as functions returning JSX",
    "State is managed via useState/useReducer hooks",
    "Lifecycle is managed via useEffect"
  ],
  "MCP SDK": [
    "Tools are registered via setRequestHandler",
    "Responses must follow the McpError/content format"
  ]
};

// Detect project signature from package.json only
export const detectProjectSignature = async (projectPath: string): Promise<ProjectSignature> => {
  const cached = signatureCache.get(projectPath);
  if (cached) return cached;

  const signature: ProjectSignature = {
    frameworks: [],
    patterns: []
  };

  // Check package.json for framework dependencies
  try {
    const packageJson = await fs.readFile(`${projectPath}/package.json`, "utf8");
    const pkg = JSON.parse(packageJson);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.express) signature.frameworks.push("Express");
    if (deps.fastify) signature.frameworks.push("Fastify");
    if (deps.react) signature.frameworks.push("React");
    if (deps.vue) signature.frameworks.push("Vue");
    if (deps.angular) signature.frameworks.push("Angular");
    if (deps.next) signature.frameworks.push("Next.js");
    if (deps.nuxt) signature.frameworks.push("Nuxt");
    if (deps.prisma) { signature.frameworks.push("Prisma"); signature.database = "Prisma"; }
    if (deps.mongoose) { signature.frameworks.push("Mongoose"); signature.database = "MongoDB"; }
    if (deps.sequelize) { signature.frameworks.push("Sequelize"); signature.database = "SQL"; }
    if (deps.typescript) signature.patterns.push("TypeScript");
    if (deps.jest || deps.vitest) signature.patterns.push("Testing");
    if (deps["@modelcontextprotocol/sdk"]) signature.frameworks.push("MCP SDK");
    if (deps["minisearch"]) signature.patterns.push("MiniSearch");
    if (deps.unified || deps.remark) signature.patterns.push("Unified/Remark");
    if (deps.yargs || deps.commander || deps.arg || deps.meow) signature.patterns.push("CLI");
  } catch {
    // No package.json — not a Node project
  }

  signatureCache.set(projectPath, signature);
  return signature;
};

// ============================================================================
// Symbol Extraction and Content Gap Analysis
// ============================================================================

// Extract symbols from source code files
export const extractSymbols = async (projectPath: string, targetFiles?: string[]): Promise<CodeSymbol[]> => {
  const symbols: CodeSymbol[] = [];

  const scanDir = async (dir: string) => {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      logger.warn("project", "Failed to read directory during symbol scan", error);
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
            // Export functions: export function name(... or export async function name(...
            { type: "function" as const, regex: /export\s+(?:async\s+)?function\s+(\w+)/g },
            // Export constants: export const name = ...
            { type: "constant" as const, regex: /export\s+const\s+(\w+)\s*[=:]/g },
            // Classes: export class Name or class Name
            { type: "class" as const, regex: /(?:export\s+)?class\s+(\w+)/g },
            // Interfaces: export interface Name or interface Name
            { type: "interface" as const, regex: /(?:export\s+)?interface\s+(\w+)/g },
            // Types: export type Name or type Name
            { type: "type" as const, regex: /(?:export\s+)?type\s+(\w+)/g },
          ];

          for (const { type, regex } of patterns) {
            let match;
            while ((match = regex.exec(content)) !== null) {
              const name = match[1];
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
        } catch (error) {
          logger.warn("project", "Failed to read source file during symbol extraction", error);
        }
      }
    }
  };

  await scanDir(projectPath);
  return symbols;
};

// Check if a symbol is mentioned in documentation
const isSymbolDocumented = (symbol: CodeSymbol, docContents: Map<string, string>): boolean => {
  const escaped = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`);

  for (const content of docContents.values()) {
    if (wordBoundaryRegex.test(content) || content.includes('`' + symbol.name + '`')) {
      return true;
    }
  }
  return false;
};

// Determine which doc file should contain documentation for a symbol
const suggestDocForSymbol = (symbol: CodeSymbol): string => {
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

  // Pre-load all doc content once to avoid O(n*m) file reads
  const docsPath = `${projectPath}/.handoff_docs`;
  const actualDocs = await getActualDocs(docsPath);
  const docContents = new Map<string, string>();
  for (const doc of actualDocs) {
    try {
      docContents.set(doc, await fs.readFile(`${docsPath}/${doc}`, "utf8"));
    } catch (error) {
      logger.warn("project", "Failed to read doc file during content gap analysis", error);
    }
  }

  for (const symbol of symbols) {
    const isDocumented = isSymbolDocumented(symbol, docContents);
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

// ============================================================================
// Template Generation
// ============================================================================

// Generate pre-filled content based on project signature and extracted symbols
export const generatePreFilledContent = async (docFile: string, projectPath: string): Promise<string> => {
  const signature = await detectProjectSignature(projectPath);
  const symbols = await extractSymbols(projectPath);

  const title = docFile.replace(".md", "")
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  let content = TEMPLATE_CONTENT.replace("{title}", title);

  // Organize symbols by type
  const functions = symbols.filter(s => s.type === "function");
  const classes = symbols.filter(s => s.type === "class");
  const interfaces = symbols.filter(s => s.type === "interface");
  const types = symbols.filter(s => s.type === "type");

  // Add pre-filled sections based on doc type and signature
  if (docFile === "techStack.md") {
    const frameworksSection = `
## Detected Frameworks
| Framework | Purpose |
|-----------|---------|
${signature.frameworks.map(f => `| ${f} | Primary framework |`).join("\n")}
${signature.database ? `| ${signature.database} | Database/ORM |` : ""}
`;
    content = content.replace("## Purpose and Overview", `${frameworksSection}\n\n## Purpose and Overview`);

    if (signature.patterns.length > 0) {
      const patternsSection = `

## Detected Patterns
${signature.patterns.slice(0, 15).map(p => `- ${p}`).join("\n")}
`;
      content = content.replace("## Purpose and Overview", `## Purpose and Overview${patternsSection}`);
    }

    const insights = signature.frameworks.flatMap(f => FRAMEWORK_INSIGHTS[f] || []);
    if (insights.length > 0) {
      const insightsSection = `

## Architectural Insights
${insights.map(i => `- ${i}`).join("\n")}
`;
      content = content.replace("## Purpose and Overview", `## Purpose and Overview${insightsSection}`);
    }
  }

  if (docFile === "codebaseDetails.md") {
    const sections: string[] = [];

    // Document functions
    if (functions.length > 0) {
      sections.push(`## Functions
${functions.map(f => `- **${f.name}**(\`${f.filePath}:${f.lineNumber}\`) - ${f.signature || "Auto-detected function"}`).join("\n")}
*Auto-detected from source code.*`);
    }

    // Document classes
    if (classes.length > 0) {
      sections.push(`## Classes
${classes.map(c => `- **${c.name}**(\`${c.filePath}:${c.lineNumber}\`) - ${c.signature || "Auto-detected class"}`).join("\n")}
*Auto-detected from source code.*`);
    }

    // Document interfaces
    if (interfaces.length > 0) {
      sections.push(`## Interfaces
${interfaces.map(i => `- **${i.name}**(\`${i.filePath}:${i.lineNumber}\`) - ${i.signature || "Auto-detected interface"}`).join("\n")}
*Auto-detected from source code.*`);
    }

    // Document types
    if (types.length > 0) {
      sections.push(`## Types
${types.map(t => `- **${t.name}**(\`${t.filePath}:${t.lineNumber}\`) - ${t.signature || "Auto-detected type"}`).join("\n")}
*Auto-detected from source code.*`);
    }

    if (sections.length > 0) {
      content = content.replace("## Purpose and Overview", `${sections.join("\n\n")}\n\n## Purpose and Overview`);
    }
  }

  // handoff_notes.md pre-fill
  if (docFile === "handoff_notes.md") {
    const sections: string[] = [];

    if (signature.frameworks.length > 0) {
      sections.push(`## Key Technologies\n${signature.frameworks.map(f => `- **${f}**`).join("\n")}\n*Auto-detected from package.json dependencies.*`);
    }

    if (signature.database) {
      sections.push(`## Database\n- **${signature.database}** - Auto-detected from project dependencies`);
    }

    // Add symbol summary for handoff
    if (symbols.length > 0) {
      sections.push(`## Code Symbols
- **${functions.length}** functions
- **${classes.length}** classes
- **${interfaces.length}** interfaces
- **${types.length}** types

*Auto-detected from source code.*`);
    }

    if (sections.length > 0) {
      content = content.replace("## Purpose and Overview", `${sections.join("\n\n")}\n\n## Purpose and Overview`);
    }
  }

  // errorHandling.md pre-fill
  if (docFile === "errorHandling.md") {
    const sections: string[] = [];

    if (signature.frameworks.includes("MCP SDK")) {
      sections.push(`## MCP SDK Error Handling
- Uses \`McpError\` class from \`@modelcontextprotocol/sdk/types\`
- Error codes defined in \`ErrorCode\` enum
- Tool handlers should use \`handleToolError\` utility for consistent error responses

\`\`\`typescript
throw new McpError(ErrorCode.MethodNotFound, \`Unknown tool: \${request.params.name}\`);
\`\`\``);
    }

    if (signature.frameworks.includes("Express")) {
      sections.push(`## Express Error Handling
- Use middleware with \`(err, req, res, next)\` signature
- Global error handler should be registered last`);
    }

    // Add error-related functions if detected
    const errorHandlers = functions.filter(f =>
      f.name.toLowerCase().includes("error") ||
      f.name.toLowerCase().includes("exception") ||
      f.name.toLowerCase().includes("catch")
    );

    if (errorHandlers.length > 0) {
      sections.push(`## Detected Error Handlers
${errorHandlers.map(f => `- **${f.name}**(\`${f.filePath}:${f.lineNumber}\`)`).join("\n")}
*Auto-detected from source code.*`);
    }

    if (sections.length > 0) {
      content = content.replace("## Purpose and Overview", `${sections.join("\n\n")}\n\n## Purpose and Overview`);
    }
  }

  // workflowDetails.md pre-fill
  if (docFile === "workflowDetails.md") {
    const sections: string[] = [];

    if (signature.frameworks.includes("MCP SDK")) {
      sections.push(`## MCP Tool Workflow
1. Client sends \`CallToolRequest\` with tool name and arguments
2. Server matches tool name in \`switch\` statement
3. Handler function is invoked with \`request\` object
4. Handler returns \`{ content: [{ type: "text", text: ... }] }\`
5. Errors should be caught and returned as \`McpError\``);
    }

    if (sections.length > 0) {
      content = content.replace("## Purpose and Overview", `${sections.join("\n\n")}\n\n## Purpose and Overview`);
    }
  }

  return content;
};

// Refresh existing doc content based on current project signature
export const refreshDocContent = (docFile: string, existingContent: string, signature: ProjectSignature): string => {
  // Only refresh if we detected frameworks from package.json
  if (signature.frameworks.length === 0) {
    return existingContent;
  }

  let content = existingContent;

  if (docFile === "techStack.md" && signature.frameworks.length > 0) {
    const frameworksTable = `
## Detected Frameworks
| Framework | Purpose |
|-----------|---------|
${signature.frameworks.map(f => `| ${f} | Primary framework |`).join("\n")}
${signature.database ? `| ${signature.database} | Database/ORM |` : ""}
`;

    if (content.includes("## Detected Frameworks")) {
      const regex = /## Detected Frameworks[\s\S]*?(?=## Purpose and Overview|$)/;
      content = content.replace(regex, frameworksTable + "\n");
    } else if (content.includes("## Purpose and Overview")) {
      content = content.replace("## Purpose and Overview", `${frameworksTable}\n\n## Purpose and Overview`);
    }
  }

  return content;
};