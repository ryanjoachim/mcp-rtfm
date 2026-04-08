// ============================================================================
// Project Signature Detection and Template Generation
// ============================================================================

import * as fs from "fs/promises";
import { getTemplateForFile } from "./templates.js";
import { sourceExtensions } from "./utils.js";
import { extractSymbols } from "./symbols.js";
import type { ProjectSignature, CodeSymbol } from "./types.js";

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

const getHandlerDescription = (name: string) => {
  return name
    .replace(/^handle/i, "Handles ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (str) => str.toUpperCase()) + " request";
};

// Detect project signature from codebase
export const detectProjectSignature = async (projectPath: string): Promise<ProjectSignature> => {
  const signature: ProjectSignature = {
    frameworks: [],
    patterns: [],
    apiEndpoints: [],
    components: []
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
    // No package.json
  }

  // Scan for API endpoints and components

  // Detect MCP handlers
  const mcpHandlerRegex = /(?:server|router)\.setRequestHandler\s*\(\s*['"`]([^'"`]+)['"`]/g;
  // Detect CLI argument parsing patterns
  const cliRegex = /(?:yargs|commander|arg|meow)\s*\.(?:command|option|positional)\s*\(['"`]/g;
  // Detect event emitters
  const eventEmitterRegex = /(?:EventEmitter|emitter|emit|on\s*\()\s*['"`]([^'"`]+)['"`]/g;
  // Detect database operations
  const dbOperationRegex = /(?:query|find|create|update|delete|insert)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  const scanDir = async (dir: string) => {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
  if (entry.name.startsWith(".") || ["node_modules", ".handoff_docs", "build", "dist"].includes(entry.name)) continue;

      // Skip handlers directory - it defines MCP tools, not API endpoints
      // The setRequestHandler regex falsely matches tool names in tools: [{ name: "..."}] arrays
      if (entry.isDirectory() && entry.name === "handlers") continue;

      const fullPath = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && sourceExtensions.some(ext => entry.name.endsWith(ext))) {
        try {
          const content = await fs.readFile(fullPath, "utf8");

          // Detect MCP handlers
          let mcpMatch;
          while ((mcpMatch = mcpHandlerRegex.exec(content)) !== null) {
            signature.apiEndpoints.push({
              method: "MCP",
              path: mcpMatch[1]
            });
          }

          // Detect CLI patterns
          let cliMatch;
          while ((cliMatch = cliRegex.exec(content)) !== null) {
            signature.patterns.push(`CLI: ${cliMatch[1]}`);
          }

          // Detect event patterns
          let eventMatch;
          while ((eventMatch = eventEmitterRegex.exec(content)) !== null) {
            signature.patterns.push(`Event: ${eventMatch[1]}`);
          }

          // Detect database operations
          let dbMatch;
          while ((dbMatch = dbOperationRegex.exec(content)) !== null) {
            if (!signature.patterns.includes(`DB: ${dbMatch[1]}`)) {
              signature.patterns.push(`DB: ${dbMatch[1]}`);
            }
          }

          // Detect Express/Fastify routes (existing pattern)
          const routeRegex = /(?:app|router|server)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
          let match;
          while ((match = routeRegex.exec(content)) !== null) {
            // Skip placeholder paths - they come from code comments/examples, not real endpoints
            if (match[2] === "/path") continue;
            signature.apiEndpoints.push({
              method: match[1].toUpperCase(),
              path: match[2]
            });
          }

          // Detect React/Vue components
          if (content.includes("export default function") || content.includes("export function")) {
            const componentMatch = content.match(/export\s+(?:default\s+)?function\s+(\w+)/);
            if (componentMatch && (entry.name.endsWith(".tsx") || entry.name.endsWith(".jsx"))) {
              signature.components.push(componentMatch[1]);
            }
          }

          // Detect exported symbols (functions, classes, interfaces)
          const exportRegex = /^export\s+(?:type|interface|class|const|function)\s+(\w+)/gm;
          let exportMatch;
          while ((exportMatch = exportRegex.exec(content)) !== null) {
            signature.patterns.push(exportMatch[1]);
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  };

  await scanDir(projectPath);
  return signature;
};

// Generate pre-filled content based on project signature AND extracted symbols
export const generatePreFilledContent = async (docFile: string, projectPath: string): Promise<string> => {
  const signature = await detectProjectSignature(projectPath);
  const symbols = await extractSymbols(projectPath);

  const title = docFile.replace(".md", "")
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  let content = getTemplateForFile(docFile).replace("{title}", title);

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

  if (docFile === "integrationGuides.md") {
    // Filter MCP tools - they are not traditional API endpoints
    const httpEndpoints = signature.apiEndpoints.filter(e => e.method !== "MCP");

    if (httpEndpoints.length > 0) {
      const endpointsSection = `

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
${httpEndpoints.slice(0, 10).map(e => `| ${e.method} | ${e.path} | Auto-detected endpoint |`).join("\n")}

*Detected from source code. Please add descriptions.*
`;
      content = content.replace("## Purpose and Overview", `## Purpose and Overview${endpointsSection}`);
    }

    const mcpEndpoints = signature.apiEndpoints.filter(e => e.method === "MCP");
    if (mcpEndpoints.length > 0) {
      const toolsSection = `

## MCP Tools (${mcpEndpoints.length} detected)
*Note: MCP tools are not traditional HTTP endpoints. They are documented via tool definitions in \`src/handlers/index.ts\`.*
`;
      if (content.includes("## API Endpoints")) {
        content = content.replace("## API Endpoints", `## API Endpoints${toolsSection}`);
      } else {
        content = content.replace("## Purpose and Overview", `## Purpose and Overview${toolsSection}`);
      }
    }

    // Document MCP tool handlers (functions that handle MCP requests)
    const mcpHandlers = functions.filter(f =>
      f.filePath.includes("handlers/") ||
      f.name.toLowerCase().includes("handler") ||
      f.name.toLowerCase().includes("request")
    );

    if (mcpHandlers.length > 0) {
      const handlerSection = `

## MCP Tool Handlers
| Handler | File | Description |
|---------|------|-------------|
${mcpHandlers.slice(0, 20).map(f => `| \`${f.name}\` | ${f.filePath} | ${getHandlerDescription(f.name)} |`).join("\n")}

*Auto-detected from source code. Please add descriptions for each handler.*
`;
      if (content.includes("## MCP Tools")) {
        content = content.replace("## MCP Tools", `## MCP Tools${handlerSection}`);
      } else {
        content = content.replace("## Purpose and Overview", `## Purpose and Overview${handlerSection}`);
      }
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

    // UI Components (if any React/Vue components detected)
    if (signature.components.length > 0) {
      sections.push(`## UI Components\n${signature.components.slice(0, 10).map(c => `- **${c}**: Component (auto-detected)`).join("\n")}\n*Please add descriptions for each component.*`);
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

    const cliPatterns = signature.patterns.filter(p => p.startsWith("CLI:"));
    if (cliPatterns.length > 0) {
      sections.push(`## CLI Commands\n${cliPatterns.map(p => `- \`${p.replace("CLI: ", "")}\``).join("\n")}\n*Auto-detected from source code.*`);
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

    const dbPatterns = signature.patterns.filter(p => p.startsWith("DB:"));
    if (dbPatterns.length > 0) {
      sections.push(`## Database Operations\nDetected operations: ${dbPatterns.map(p => `\`${p.replace("DB: ", "")}\``).join(", ")}\n*Ensure all database operations are wrapped in try-catch with meaningful error messages.*`);
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

    const cliPatterns = signature.patterns.filter(p => p.startsWith("CLI:"));
    if (cliPatterns.length > 0) {
      sections.push(`## CLI Workflows
| Command | Purpose |
|---------|---------|
${cliPatterns.map(p => `| \`${p.replace("CLI: ", "")}\` | Auto-detected |`).join("\n")}
*Detected from source code.*`);
    }

    if (signature.frameworks.includes("MCP SDK")) {
      sections.push(`## MCP Tool Workflow
1. Client sends \`CallToolRequest\` with tool name and arguments
2. Server matches tool name in \`switch\` statement
3. Handler function is invoked with \`request\` object
4. Handler returns \`{ content: [{ type: "text", text: ... }] }\`
5. Errors should be caught and returned as \`McpError\``);
    }

    // Document handler functions (MCP tools)
    const mcpHandlers = functions.filter(f =>
      f.filePath.includes("handlers/") ||
      f.name.toLowerCase().includes("handler")
    );

    if (mcpHandlers.length > 0) {
      sections.push(`## MCP Tool Handlers
| Handler | File | Description |
|---------|------|-------------|
${mcpHandlers.slice(0, 20).map(f => `| \`${f.name}\` | ${f.filePath} | ${getHandlerDescription(f.name)} |`).join("\n")}

*Auto-detected from source code.*`);
    }

    if (sections.length > 0) {
      content = content.replace("## Purpose and Overview", `${sections.join("\n\n")}\n\n## Purpose and Overview`);
    }
  }

  return content;
};

// Refresh existing doc content based on current project signature
// Only modifies content if signature has changed or sections are outdated
export const refreshDocContent = (docFile: string, existingContent: string, signature: ProjectSignature): string => {
  let content = existingContent;

  // Only refresh content if we detected something meaningful
  if (signature.frameworks.length === 0 &&
      signature.apiEndpoints.length === 0 &&
      signature.components.length === 0) {
    return content;
  }

  if (docFile === "techStack.md") {
    // Refresh frameworks section
    if (signature.frameworks.length > 0) {
      const frameworksTable = `
## Detected Frameworks
| Framework | Purpose |
|-----------|---------|
${signature.frameworks.map(f => `| ${f} | Primary framework |`).join("\n")}
${signature.database ? `| ${signature.database} | Database/ORM |` : ""}
`;

      // Replace existing Detected Frameworks section or insert before Purpose and Overview
      if (content.includes("## Detected Frameworks")) {
        const regex = /## Detected Frameworks[\s\S]*?(?=## Purpose and Overview|$)/;
        content = content.replace(regex, frameworksTable + "\n");
      } else if (content.includes("## Purpose and Overview")) {
        content = content.replace("## Purpose and Overview", `${frameworksTable}\n\n## Purpose and Overview`);
      }
    }
  }

  if (docFile === "integrationGuides.md") {
    // Filter MCP tools - they are not traditional API endpoints
    const httpEndpoints = signature.apiEndpoints.filter(e => e.method !== "MCP");
    const mcpEndpoints = signature.apiEndpoints.filter(e => e.method === "MCP");

    // Refresh API endpoints section
    if (httpEndpoints.length > 0) {
      const endpointsSection = `

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
${httpEndpoints.slice(0, 10).map(e => `| ${e.method} | ${e.path} | Auto-detected endpoint |`).join("\n")}

*Detected from source code. Please add descriptions.*
`;

      if (content.includes("## API Endpoints")) {
        const regex = /## API Endpoints[\s\S]*?(?=## Purpose and Overview|# |## MCP Tools|$)/;
        content = content.replace(regex, endpointsSection + "\n");
      } else if (content.includes("## Purpose and Overview")) {
        content = content.replace("## Purpose and Overview", `## Purpose and Overview${endpointsSection}`);
      }
    }

    // Refresh MCP tools section
    if (mcpEndpoints.length > 0) {
      const toolsSection = `

## MCP Tools (${mcpEndpoints.length} detected)
*Note: MCP tools are not traditional HTTP endpoints.*
`;

      if (content.includes("## MCP Tools")) {
        const regex = /## MCP Tools[\s\S]*?(?=## Purpose and Overview|# |$)/;
        content = content.replace(regex, toolsSection + "\n");
      } else if (content.includes("## Purpose and Overview")) {
        content = content.replace("## Purpose and Overview", `## Purpose and Overview${toolsSection}`);
      }
    }
  }

  if (docFile === "codebaseDetails.md") {
    // Refresh components section
    if (signature.components.length > 0) {
      const componentsSection = `

## UI Components
${signature.components.slice(0, 10).map(c => `- **${c}**: Component (auto-detected)`).join("\n")}

*Please add descriptions for each component.*
`;

      if (content.includes("## UI Components")) {
        const regex = /## UI Components[\s\S]*?(?=## Purpose and Overview|# )/;
        content = content.replace(regex, componentsSection + "\n");
      } else if (content.includes("## Purpose and Overview")) {
        content = content.replace("## Purpose and Overview", `## Purpose and Overview${componentsSection}`);
      }
    }
  }

  return content;
};
