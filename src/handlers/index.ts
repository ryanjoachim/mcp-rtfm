// ============================================================================
// Tool Definitions and Request Router
// ============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

import * as analyzeHandlers from "./analyze-handlers.js";
import * as docHandlers from "./doc-handlers.js";
import * as searchHandlers from "./search-handlers.js";
import * as refreshHandlers from "./refresh-handlers.js";
import * as projectHandlers from "./project-handlers.js";

export const server = new Server(
  {
    name: "mcp-rtfm",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {
        listChanged: false,  // Tool list is static
      },
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "analyze_project",
        description: "Analyze project structure and manage documentation. Use mode: 'init' to create skeleton docs, mode: 'analyze' (default) to enhance existing docs with metadata and generate content, or mode: 'reset' to clear state and re-analyze from scratch.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            options: {
              type: "object",
              description: "Options for the analyze operation",
              properties: {
                mode: {
                  type: "string",
                  enum: ["init", "analyze", "reset"],
                  description: "'init' creates missing skeleton docs. 'analyze' (default) enhances existing docs with metadata and generates content. 'reset' clears state and re-analyzes.",
                  default: "analyze"
                },
                initDocs: {
                  type: "boolean",
                  description: "If true (default), also initializes missing BASE_DOCS files with generated content before analyzing",
                  default: true
                }
              }
            }
          },
          required: ["projectPath"]
        }
      },
      {
        name: "read_doc",
        description: "Read a documentation file.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file to read"
            }
          },
          required: ["projectPath", "docFile"]
        }
      },
      {
        name: "update_doc",
        description: "Update a specific documentation file. Provide either 'content' for a full replacement, or 'searchContent' and 'replaceContent' for a targeted diff.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file to update"
            },
            searchContent: {
              type: "string",
              description: "Content to search for in the file (for diff-based update)"
            },
            replaceContent: {
              type: "string",
              description: "Content to replace the search content with"
            },
            content: {
              type: "string",
              description: "Full file content for replacement (use instead of searchContent/replaceContent)"
            }
          },
          required: ["projectPath", "docFile"]
        }
      },
      {
        name: "get_project_info",
        description: "Get information about the project structure and files",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            }
          },
          required: ["projectPath"]
        }
      },
      {
        name: "search_docs",
        description: "Search across documentation files with highlighted results",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            query: {
              type: "string",
              description: "Search query to find in documentation"
            }
          },
          required: ["projectPath", "query"]
        }
      },
      {
        name: "get_related_docs",
        description: "Find related documentation files based on metadata",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file"
            }
          },
          required: ["projectPath", "docFile"]
        }
      },
      {
        name: "refresh_documentation",
        description: "Scan codebase for changes since last documentation update and refresh .handoff_docs/ files. Use mode: 'sync' (default) to detect and apply codebase changes, or mode: 'analyze' to re-analyze content and regenerate metadata. Use dryRun mode (default for sync) to preview changes before applying.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            options: {
              type: "object",
              description: "Options for the refresh operation",
              properties: {
                mode: {
                  type: "string",
                  enum: ["sync", "analyze"],
                  description: "'sync' (default) uses git/file change detection. 'analyze' re-analyzes content and regenerates metadata.",
                  default: "sync"
                },
                dryRun: {
                  type: "boolean",
                  description: "If true (default for sync), returns suggestions without applying changes",
                  default: true
                },
                includeStats: {
                  type: "boolean",
                  description: "Include diff statistics in results",
                  default: true
                },
                targetDocs: {
                  type: "array",
                  items: { type: "string" },
                  description: "Specific documentation files to refresh (omit to refresh all)"
                },
                docFile: {
                  type: "string",
                  description: "For analyze mode: name of the doc to update (omit to update all docs)"
                },
                metadata: {
                  type: "object",
                  description: "For analyze mode: optional metadata overrides",
                  properties: {
                    title: { type: "string" },
                    category: { type: "string" },
                    tags: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          required: ["projectPath"]
        }
      },
      {
        name: "analyze_content_gaps",
        description: "Analyze codebase to find undocumented functions, classes, and other symbols that should be documented",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            },
            targetFiles: {
              type: "array",
              items: { type: "string" },
              description: "Optional: specific source files to analyze (omit to scan all)"
            }
          },
          required: ["projectPath"]
        }
      },
      {
        name: "validate_documentation",
        description: "Validate documentation for broken wiki-links",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory"
            }
          },
          required: ["projectPath"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  switch (request.params.name) {
    case "analyze_project":
      return analyzeHandlers.analyzeProject(request);

    case "read_doc":
      return docHandlers.readDoc(request);
    case "update_doc":
      return docHandlers.updateDoc(request);

    case "search_docs":
      return searchHandlers.searchDocs(request);
    case "get_related_docs":
      return searchHandlers.getRelatedDocs(request);

    case "refresh_documentation":
      return refreshHandlers.refreshDocumentation(request);

    case "get_project_info":
      return projectHandlers.getProjectInfo(request);
    case "analyze_content_gaps":
      return projectHandlers.analyzeContentGapsHandler(request);
    case "validate_documentation":
      return projectHandlers.validateDocumentationHandler(request);

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

export function main() {
  const transport = new StdioServerTransport();
  server.connect(transport);
  console.error("Handoff Docs MCP server running on stdio");
}
