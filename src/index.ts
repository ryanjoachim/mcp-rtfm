#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  CallToolRequest,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import * as fs from "fs/promises"
import { execSync } from "child_process"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import MiniSearch from "minisearch"
import pino from "pino"
import QuickLRU from "quick-lru"
import { parse } from "@babel/parser"
import { cruise } from "dependency-cruiser"

// Constants
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const DEFAULT_DOCS = [
  "techStack.md",
  "codebaseDetails.md",
  "workflowDetails.md",
  "integrationGuides.md",
  "errorHandling.md",
  "handoff_notes.md",
]

const TEMPLATES: Record<string, DocTemplate> = {
  standard: {
    name: "Standard Documentation",
    content: `# {title}

## Purpose and Overview
[Why this domain is critical to the project]

## Step-by-Step Explanations
[Concrete, detailed steps for implementation and maintenance]

## Annotated Examples
[Code snippets, diagrams, or flowcharts for clarity]

## Contextual Notes
[Historical decisions, trade-offs, and anticipated challenges]

## Actionable Advice
[Gotchas, edge cases, and common pitfalls to avoid]`,
    metadata: {
      category: "documentation",
      tags: ["guide", "reference"],
    },
  },
  api: {
    name: "API Documentation",
    content: `# {title} API Reference

## Overview
[High-level description of the API]

## Authentication
[Authentication requirements and methods]

## Endpoints
[Detailed endpoint documentation]

## Request/Response Examples
[Example API calls and responses]

## Error Handling
[Error codes and handling strategies]

## Rate Limiting
[Rate limiting policies and quotas]`,
    metadata: {
      category: "api",
      tags: ["api", "reference", "integration"],
    },
  },
  workflow: {
    name: "Workflow Documentation",
    content: `# {title} Workflow

## Overview
[High-level description of the workflow]

## Prerequisites
[Required setup and dependencies]

## Process Flow
[Step-by-step workflow description]

## Decision Points
[Key decision points and criteria]

## Success Criteria
[How to verify successful completion]

## Troubleshooting
[Common issues and solutions]`,
    metadata: {
      category: "workflow",
      tags: ["process", "guide"],
    },
  },
}

const TEMPLATE_CONTENT = `# {title}

## Purpose and Overview
[Why this domain is critical to the project]

## Step-by-Step Explanations
[Concrete, detailed steps for implementation and maintenance]

## Annotated Examples
[Code snippets, diagrams, or flowcharts for clarity]

## Contextual Notes
[Historical decisions, trade-offs, and anticipated challenges]

## Actionable Advice
[Gotchas, edge cases, and common pitfalls to avoid]
`

// Interfaces
interface DocState {
  currentFile: string | null
  completedFiles: string[]
  inProgress: boolean
  lastReadFile: string | null
  lastReadContent: string | null
  continueToNext: boolean
  metadata: Record<string, DocMetadata>
  contextCache: {
    lastQuery?: string
    results?: SearchResult[]
    timestamp?: number
  }
  templateOverrides: Record<string, DocTemplate>
}

interface DocMetadata {
  title: string
  category: string
  tags: string[]
  lastUpdated: string
  relatedDocs: string[]
}

interface SearchResult {
  file: string
  matches: Array<{
    line: string
    lineNumber: number
    highlight: {
      start: number
      end: number
    }
  }>
}

interface DocTemplate {
  name: string
  content: string
  constructor(logger: pino.Logger) {
    this.logger = logger
  }

  protected handleMcpError(error: unknown, context: string): never {
    if (error instanceof McpError) throw error

    const message = error instanceof Error ? error.message : String(error)
    const errorMap: Record<string, ErrorCode> = {
      ENOENT: ErrorCode.InvalidRequest,
      EACCES: ErrorCode.InvalidRequest,
      ECONNRESET: ErrorCode.InternalError,
      ETIMEDOUT: ErrorCode.InternalError,
      EEXIST: ErrorCode.InvalidRequest,
    }

    const code = Object.entries(errorMap).find(([key]) =>
      message.includes(key))?.[1] || ErrorCode.InternalError

    this.logger.error({ error, context }, "Error occurred")
    throw new McpError(code, `${context}: ${message}`)
  }
}

// Technical Analysis Service
class TechnicalAnalysisService extends MCPBaseService {
  private cache: QuickLRU<string, any>

  constructor(logger: pino.Logger) {
    super(logger)
    this.cache = new QuickLRU({ maxSize: 1000 })
  }

  async analyzeCode(content: string, type: string): Promise<any> {
    try {
      const cacheKey = `${type}:${content.length}:${content.slice(0, 50)}:${content.charCodeAt(0)}`
      const cached = this.cache.get(cacheKey)

      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.analysis
      }

      const analysis = await this.performAnalysis(content, type)
      this.cache.set(cacheKey, { analysis, timestamp: Date.now() })

      return analysis
    } catch (error) {
      throw this.handleMcpError(error, "Code analysis failed")
    }
  }

  private async performAnalysis(content: string, type: string): Promise<any> {
    switch (type) {
      case "ast":
        return this.analyzeAST(content)
      case "dependency":
        return this.analyzeDependencies(content)
      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unsupported analysis type: ${type}`)
    }
  }

  private analyzeAST(content: string): any {
    return {
      ast: parse(content, { sourceType: "module", plugins: ["typescript"] }),
    }
  }

  private async analyzeDependencies(content: string): Promise<any> {
    const tempFile = `/tmp/analysis_${Date.now()}.ts`
    await fs.writeFile(tempFile, content)
    const result = await cruise([tempFile], {
      includeOnly: "^src",
      maxDepth: 10,
    })
    await fs.unlink(tempFile)
    return result
  }

  cleanup(): void {
    this.cache.clear()
  }
}

// Documentation Service
class DocumentationService extends MCPBaseService {
  private searchEngine: MiniSearch
  private markdownProcessor: any
  private cache: QuickLRU<string, any>

  constructor(logger: pino.Logger) {
    super(logger)
    this.searchEngine = searchEngine // Use the global instance
    this.markdownProcessor = markdownProcessor // Use the global instance
    this.cache = new QuickLRU({ maxSize: 1000 })
  }

  // ... rest of DocumentationService implementation
}

// Main MCP Server class
class MCPServer extends MCPBaseService {
  private server: Server
  private docService: DocumentationService
  private techService: TechnicalAnalysisService

  constructor() {
    super(logger)
    this.docService = new DocumentationService(logger)
    this.techService = new TechnicalAnalysisService(logger)
    this.setupServer()
  }

  private setupServer() {
    this.server = new Server(
      {
        name: "mcp-rtfm",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {
            templates: {
              "docs://{category}/{name}": {
                name: "Documentation Resource",
                description: "Access documentation files and metadata",
              },
            },
            direct: {
              "docs://architecture/techStack": {
                name: "Technology Stack",
                description:
                  "Documentation of project technologies and configurations",
              },
              "docs://workflows/codebase": {
                name: "Codebase Details",
                description: "Documentation of code structure and patterns",
              },
              "docs://workflows/handoff": {
                name: "Handoff Notes",
                description: "Summary of key themes and next steps",
              },
            },
          },
        },
      }
    )
  }

  async start() {
    try {
      const transport = new StdioServerTransport()
      await this.server.connect(transport)
      this.logger.info("MCP Server started successfully")
    } catch (error) {
      this.logger.error(error, "Server startup failed")
      throw this.handleMcpError(error, "Server startup failed")
    }
  }

  cleanup() {
    this.docService.cleanup()
    this.techService.cleanup()
  }
}

// Helper functions
const formatToolResponse = (data: any) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(data, null, 2),
    },
  ],
})


const server = new Server(
  {
    name: "mcp-rtfm",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {
        templates: {
          "docs://{category}/{name}": {
            name: "Documentation Resource",
            description: "Access documentation files and metadata",
          },
        },
        direct: {
          "docs://architecture/techStack": {
            name: "Technology Stack",
            description:
              "Documentation of project technologies and configurations",
          },
          "docs://workflows/codebase": {
            name: "Codebase Details",
            description: "Documentation of code structure and patterns",
          },
          "docs://workflows/handoff": {
            name: "Handoff Notes",
            description: "Summary of key themes and next steps",
          },
        },
      },
    },
  }
)

// Global state
// Helper functions for context and metadata management
const updateMetadata = async (
  filePath: string,
  metadata: Partial<DocMetadata>
) => {
  const fileName = filePath.split("/").pop() as string
  state.metadata[fileName] = {
    ...state.metadata[fileName],
    ...metadata,
    lastUpdated: new Date().toISOString(),
  } as DocMetadata
}

// Helper function to analyze markdown content
const analyzeContent = async (
  content: string
): Promise<{
  title: string
  headings: string[]
  codeBlocks: string[]
  links: string[]
}> => {
  const ast = await markdownProcessor.parse(content)
  const result = {
    title: "",
    headings: [] as string[],
    codeBlocks: [] as string[],
    links: [] as string[],
  }

  // @ts-ignore - types are not exact but functionality works
  const visit = (node: any) => {
    if (node.type === "heading" && node.depth === 1) {
      result.title = node.children?.[0]?.value || ""
    } else if (node.type === "heading") {
      result.headings.push(node.children?.[0]?.value || "")
    } else if (node.type === "code") {
      result.codeBlocks.push(node.value || "")
    } else if (node.type === "link") {
      result.links.push(node.url || "")
    }

    if (node.children) {
      node.children.forEach(visit)
    }
  }

  visit(ast)
  return result
}

// Helper function to determine document category and tags
const categorizeContent = (
  fileName: string,
  _content: string,
  analysis: Awaited<ReturnType<typeof analyzeContent>>
): { category: string; tags: string[] } => {
  const tags = new Set<string>()
  let category = "documentation"

  // Simple pattern matching instead of NLP
  if (
    fileName.includes("api") ||
    analysis.headings.some((h) => h.toLowerCase().includes("api"))
  ) {
    category = "api"
    tags.add("api")
  } else if (
    fileName.includes("workflow") ||
    analysis.headings.some((h) => h.toLowerCase().includes("workflow"))
  ) {
    category = "workflow"
    tags.add("workflow")
  } else if (
    fileName.includes("tech") ||
    analysis.headings.some((h) => h.toLowerCase().includes("stack"))
  ) {
    category = "technology"
    tags.add("technology")
  }

  // Basic content analysis using simple patterns
  if (analysis.codeBlocks.length > 0) tags.add("code-examples")
  if (analysis.links.length > 0) tags.add("references")

  return { category, tags: Array.from(tags) }
}

// Helper function to update search index
const updateSearchIndex = (
  docFile: string,
  content: string,
  metadata: DocMetadata
) => {
  const docId = docFile.replace(".md", "")
  searchEngine.remove({ id: docId })
  searchEngine.add({
    id: docId,
    title: metadata.title,
    content,
    category: metadata.category,
    tags: metadata.tags,
    lastUpdated: metadata.lastUpdated,
  })
}

const findRelatedDocs = async (
  docFile: string,
  projectPath: string
): Promise<string[]> => {
  const metadata = state.metadata[docFile]
  if (!metadata) return []

  const related = new Set<string>()

  // Find docs with matching tags
  Object.entries(state.metadata).forEach(([file, meta]) => {
    if (
      file !== docFile &&
      meta.tags.some((tag) => metadata.tags.includes(tag))
    ) {
      related.add(file)
    }
  })

  // Find docs in same category
  Object.entries(state.metadata).forEach(([file, meta]) => {
    if (file !== docFile && meta.category === metadata.category) {
      related.add(file)
    }
  })

  // Find docs referenced in content
  const content = await fs.readFile(
    `${projectPath}/.handoff_docs/${docFile}`,
    "utf8"
  )
  const matches = content.match(/\[\[([^\]]+)\]\]/g) || []
  matches.forEach((match) => {
    const linkedDoc = match.slice(2, -2).trim() + ".md"
    if (DEFAULT_DOCS.includes(linkedDoc)) {
      related.add(linkedDoc)
    }
  })

  return Array.from(related)
}

const searchDocContent = async (
  projectPath: string,
  query: string
): Promise<SearchResult[]> => {
  // Check cache first
  if (
    state.contextCache.lastQuery === query &&
    state.contextCache.results &&
    state.contextCache.timestamp &&
    Date.now() - state.contextCache.timestamp < CACHE_TTL
  ) {
    return state.contextCache.results
  }

  const results: SearchResult[] = []
  const docsPath = `${projectPath}/.handoff_docs`
  const searchRegex = new RegExp(query, "gi")

  for (const doc of DEFAULT_DOCS) {
    try {
      const content = await fs.readFile(`${docsPath}/${doc}`, "utf8")
      const lines = content.split("\n")
      const matches = lines
        .map((line, index) => {
          const match = searchRegex.exec(line)
          if (match) {
            return {
              line,
              lineNumber: index + 1,
              highlight: {
                start: match.index,
                end: match.index + match[0].length,
              },
            }
          }
          return null
        })
        .filter((match): match is NonNullable<typeof match> => match !== null)

      if (matches.length > 0) {
        results.push({ file: doc, matches })
      }
    } catch (error) {
      console.error(`Error searching ${doc}:`, error)
    }
  }

  // Update cache
  state.contextCache = {
    lastQuery: query,
    results,
    timestamp: Date.now(),
  }

  return results
}

const initializeState = (): DocState => ({
  currentFile: null,
  completedFiles: [],
  inProgress: false,
  lastReadFile: null,
  lastReadContent: null,
  continueToNext: false,
  metadata: {},
  contextCache: {},
  templateOverrides: {},
})

const resetState = () => {
  state = initializeState()
  searchEngine.removeAll()
}

let state: DocState = initializeState()

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "analyze_existing_docs",
        description:
          "Analyze existing documentation files with enhanced content analysis and metadata generation",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "analyze_project_with_metadata",
        description:
          "Analyze project structure, create initial documentation files, and enhance with metadata/context",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "analyze_project",
        description:
          "Analyze project structure and create initial documentation files",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "read_doc",
        description: "Read a documentation file (required before updating)",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file to read",
            },
          },
          required: ["projectPath", "docFile"],
        },
      },
      {
        name: "update_doc",
        description:
          "Update a specific documentation file using diff-based changes",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file to update",
            },
            searchContent: {
              type: "string",
              description: "Content to search for in the file",
            },
            replaceContent: {
              type: "string",
              description: "Content to replace the search content with",
            },
            continueToNext: {
              type: "boolean",
              description:
                "Whether to continue to the next file after this update",
            },
          },
          required: [
            "projectPath",
            "docFile",
            "searchContent",
            "replaceContent",
          ],
        },
      },
      {
        name: "get_doc_content",
        description: "Get the current content of a documentation file",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file to read",
            },
          },
          required: ["projectPath", "docFile"],
        },
      },
      {
        name: "get_project_info",
        description: "Get information about the project structure and files",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "search_docs",
        description:
          "Search across documentation files with highlighted results",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
            query: {
              type: "string",
              description: "Search query to find in documentation",
            },
          },
          required: ["projectPath", "query"],
        },
      },
      {
        name: "update_metadata",
        description: "Update metadata for a documentation file",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file",
            },
            metadata: {
              type: "object",
              description: "Metadata to update",
              properties: {
                title: { type: "string" },
                category: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
          required: ["projectPath", "docFile", "metadata"],
        },
      },
      {
        name: "get_related_docs",
        description: "Find related documentation files based on metadata",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project root directory",
            },
            docFile: {
              type: "string",
              description: "Name of the documentation file",
            },
          },
          required: ["projectPath", "docFile"],
        },
      },
      {
        name: "customize_template",
        description: "Create or update a custom documentation template",
        inputSchema: {
          type: "object",
          properties: {
            templateName: {
              type: "string",
              description: "Name of the template",
            },
            content: {
              type: "string",
              description: "Template content with {title} placeholder",
            },
            metadata: {
              type: "object",
              description: "Default metadata for the template",
              properties: {
                category: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
          required: ["templateName", "content"],
        },
      },
    ],
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "docs://architecture/techStack",
      name: "Technology Stack",
      description: "Documentation of project technologies and configurations",
      mimeType: "text/markdown",
    },
    {
      uri: "docs://workflows/codebase",
      name: "Codebase Details",
      description: "Documentation of code structure and patterns",
      mimeType: "text/markdown",
    },
    {
      uri: "docs://workflows/handoff",
      name: "Handoff Notes",
      description: "Summary of key themes and next steps",
      mimeType: "text/markdown",
    },
  ],
}))

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "docs://{category}/{name}",
      name: "Documentation Resource",
      description: "Access documentation files and metadata",
      mimeType: "text/markdown",
    },
  ],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const match = request.params.uri.match(/^docs:\/\/([^/]+)\/([^/]+)$/)
  if (!match) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Invalid documentation URI: ${request.params.uri}`
    )
  }

  const [_, category, name] = match
  const docFile = `${name}.md`

  try {
    const content = await fs.readFile(
      `${request.params.projectPath}/.handoff_docs/${docFile}`,
      "utf8"
    )
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/markdown",
          text: content,
        },
      ],
    }
  } catch (error) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Documentation not found: ${docFile}`
    )
  }
})

server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest) => {
    try {
      switch (request.params.name) {
        case "analyze_existing_docs": {
          const { projectPath } = request.params.arguments as {
            projectPath: string
          }
          const docsPath = `${projectPath}/.handoff_docs`

          try {
            // Verify docs directory exists
            try {
              await fs.access(docsPath)
            } catch {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Documentation directory not found at ${docsPath}`
              )
            }

            // Reset state
            state = {
              currentFile: null,
              completedFiles: [],
              inProgress: false,
              lastReadFile: null,
              lastReadContent: null,
              continueToNext: false,
              metadata: {},
              contextCache: {},
              templateOverrides: {},
            }

            // Clear existing search index
            searchEngine.removeAll()

            // Get list of all markdown files in the docs directory
            const files = await fs.readdir(docsPath)
            const markdownFiles = files.filter((file) => file.endsWith(".md"))

            if (markdownFiles.length === 0) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `No markdown files found in ${docsPath}`
              )
            }

            // Analyze each markdown file
            for (const doc of markdownFiles) {
              const filePath = `${docsPath}/${doc}`
              const content = await fs.readFile(filePath, "utf8")

              // Use unified/remark to analyze content structure
              const analysis = await analyzeContent(content)

              // Use enhanced categorization
              const { category, tags } = categorizeContent(
                doc,
                content,
                analysis
              )

              // Generate metadata
              const metadata = {
                title:
                  analysis.title ||
                  doc
                    .replace(".md", "")
                    .split(/[_-]/)
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" "),
                category,
                tags,
                lastUpdated: new Date().toISOString(),
              }

              // Update metadata for the file
              await updateMetadata(filePath, metadata)

              // Find and update related docs
              const relatedDocs = await findRelatedDocs(doc, projectPath)
              await updateMetadata(filePath, { relatedDocs })

              // Update search index with full content and metadata
              updateSearchIndex(doc, content, {
                ...metadata,
                relatedDocs,
              })

              // Add structured front matter to content if it doesn't already have it
              if (!content.startsWith("---")) {
                const enhancedContent = `---
title: ${metadata.title}
category: ${metadata.category}
tags: ${metadata.tags.join(", ")}
lastUpdated: ${metadata.lastUpdated}
relatedDocs: ${relatedDocs.join(", ")}
---

${content}`

                await fs.writeFile(filePath, enhancedContent)
              }

              state.completedFiles.push(doc)
            }

            // Get project info for additional context
            let gitInfo = {}
            try {
              gitInfo = {
                remoteUrl: execSync("git config --get remote.origin.url", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
                branch: execSync("git branch --show-current", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
                lastCommit: execSync("git log -1 --format=%H", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
              }
            } catch {
              // Not a git repository or git not available
            }

            return formatToolResponse({
              message: "Existing documentation analyzed and enhanced",
              docsPath,
              files: markdownFiles,
              metadata: state.metadata,
              gitInfo,
              contextCache: {
                timestamp: state.contextCache.timestamp,
                ttl: CACHE_TTL,
              },
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error analyzing existing documentation: ${errorMessage}`
            )
          }
        }

        case "analyze_project_with_metadata": {
          const { projectPath } = request.params.arguments as {
            projectPath: string
          }
          const docsPath = `${projectPath}/.handoff_docs`

          try {
            // First run the standard analyze_project workflow
            await fs.mkdir(docsPath, { recursive: true })

            // Initialize default documentation files if they don't exist
            for (const doc of DEFAULT_DOCS) {
              const filePath = `${docsPath}/${doc}`
              try {
                await fs.access(filePath)
              } catch {
                const title = doc
                  .replace(".md", "")
                  .split(/[_-]/)
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ")
                await fs.writeFile(
                  filePath,
                  TEMPLATE_CONTENT.replace("{title}", title)
                )
              }
            }

            // Reset state
            state = {
              currentFile: null,
              completedFiles: [],
              inProgress: false,
              lastReadFile: null,
              lastReadContent: null,
              continueToNext: false,
              metadata: {},
              contextCache: {},
              templateOverrides: {},
            }

            // Clear existing search index
            searchEngine.removeAll()

            // Now enhance each file with metadata and context
            for (const doc of DEFAULT_DOCS) {
              const filePath = `${docsPath}/${doc}`
              const content = await fs.readFile(filePath, "utf8")

              // Use unified/remark to analyze content structure
              const analysis = await analyzeContent(content)

              // Use enhanced categorization
              const { category, tags } = categorizeContent(
                doc,
                content,
                analysis
              )

              // Generate metadata
              const metadata = {
                title:
                  analysis.title ||
                  doc
                    .replace(".md", "")
                    .split(/[_-]/)
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" "),
                category,
                tags,
                lastUpdated: new Date().toISOString(),
              }

              // Update metadata for the file
              await updateMetadata(filePath, metadata)

              // Find and update related docs
              const relatedDocs = await findRelatedDocs(doc, projectPath)
              await updateMetadata(filePath, { relatedDocs })

              // Update search index with full content and metadata
              updateSearchIndex(doc, content, {
                ...metadata,
                relatedDocs,
              })

              // Add structured front matter to content
              const enhancedContent = `---
title: ${metadata.title}
category: ${metadata.category}
tags: ${metadata.tags.join(", ")}
lastUpdated: ${metadata.lastUpdated}
relatedDocs: ${relatedDocs.join(", ")}
---

${content}`

              // Update file with enhanced content
              await fs.writeFile(filePath, enhancedContent)
            }

            // Get project info for additional context
            let gitInfo = {}
            try {
              gitInfo = {
                remoteUrl: execSync("git config --get remote.origin.url", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
                branch: execSync("git branch --show-current", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
                lastCommit: execSync("git log -1 --format=%H", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
              }
            } catch {
              // Not a git repository or git not available
            }

            return formatToolResponse({
              message:
                "Documentation structure initialized with metadata and context",
              docsPath,
              files: DEFAULT_DOCS,
              metadata: state.metadata,
              gitInfo,
              contextCache: {
                timestamp: state.contextCache.timestamp,
                ttl: CACHE_TTL,
              },
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error initializing documentation with metadata: ${errorMessage}`
            )
          }
        }

        case "analyze_project": {
          const { projectPath } = request.params.arguments as {
            projectPath: string
          }
          const docsPath = `${projectPath}/.handoff_docs`

          try {
            await fs.mkdir(docsPath, { recursive: true })

            // Initialize default documentation files if they don't exist
            for (const doc of DEFAULT_DOCS) {
              const filePath = `${docsPath}/${doc}`
              try {
                await fs.access(filePath)
              } catch {
                const title = doc
                  .replace(".md", "")
                  .split(/[_-]/)
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ")
                await fs.writeFile(
                  filePath,
                  TEMPLATE_CONTENT.replace("{title}", title)
                )
              }
            }

            state = {
              currentFile: null,
              completedFiles: [],
              inProgress: false,
              lastReadFile: null,
              lastReadContent: null,
              continueToNext: false,
              metadata: {},
              contextCache: {},
              templateOverrides: {},
            }

            return formatToolResponse({
              message: "Documentation structure initialized",
              docsPath,
              files: DEFAULT_DOCS,
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error initializing documentation: ${errorMessage}`
            )
          }
        }

        case "read_doc": {
          const { projectPath, docFile } = request.params.arguments as {
            projectPath: string
            docFile: string
          }

          try {
            const filePath = `${projectPath}/.handoff_docs/${docFile}`
            const content = await fs.readFile(filePath, "utf8")

            state.lastReadFile = docFile
            state.lastReadContent = content
            state.currentFile = docFile
            state.inProgress = true

            return {
              content: [
                {
                  type: "text",
                  text: content,
                },
              ],
            }
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error reading documentation: ${errorMessage}`
            )
          }
        }

        case "update_doc": {
          const {
            projectPath,
            docFile,
            searchContent,
            replaceContent,
            continueToNext = false,
          } = request.params.arguments as {
            projectPath: string
            docFile: string
            searchContent: string
            replaceContent: string
            continueToNext?: boolean
          }

          try {
            // Validate that the file was read first
            if (state.lastReadFile !== docFile || !state.lastReadContent) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Must read ${docFile} before updating it`
              )
            }

            const filePath = `${projectPath}/.handoff_docs/${docFile}`

            // Verify the search content exists in the file
            if (!state.lastReadContent.includes(searchContent)) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Search content not found in ${docFile}`
              )
            }

            // Apply the diff
            const newContent = state.lastReadContent.replace(
              searchContent,
              replaceContent
            )
            await fs.writeFile(filePath, newContent)

            // Update state
            state.lastReadContent = newContent
            if (!state.completedFiles.includes(docFile)) {
              state.completedFiles.push(docFile)
            }
            state.continueToNext = continueToNext

            if (continueToNext) {
              const remainingDocs = DEFAULT_DOCS.filter(
                (doc) => !state.completedFiles.includes(doc)
              )
              if (remainingDocs.length > 0) {
                state.currentFile = remainingDocs[0]
              } else {
                state.currentFile = null
                state.inProgress = false
              }
            }

            return formatToolResponse({
              message: "Documentation updated successfully",
              file: docFile,
              completedFiles: state.completedFiles,
              nextFile: state.currentFile,
              diff: {
                from: searchContent,
                to: replaceContent,
              },
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error updating documentation: ${errorMessage}`
            )
          }
        }

        case "get_doc_content": {
          const { projectPath, docFile } = request.params.arguments as {
            projectPath: string
            docFile: string
          }

          try {
            const filePath = `${projectPath}/.handoff_docs/${docFile}`
            const content = await fs.readFile(filePath, "utf8")

            return formatToolResponse({ content })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error reading documentation: ${errorMessage}`
            )
          }
        }

        case "search_docs": {
          const { projectPath, query } = request.params.arguments as {
            projectPath: string
            query: string
          }

          try {
            const results = await searchDocContent(projectPath, query)
            return formatToolResponse({
              query,
              results,
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error searching documentation: ${errorMessage}`
            )
          }
        }

        case "update_metadata": {
          const { projectPath, docFile, metadata } = request.params
            .arguments as {
            projectPath: string
            docFile: string
            metadata: Partial<DocMetadata>
          }

          try {
            const filePath = `${projectPath}/.handoff_docs/${docFile}`
            await fs.access(filePath) // Verify file exists
            await updateMetadata(filePath, metadata)

            return formatToolResponse({
              message: "Metadata updated successfully",
              file: docFile,
              metadata: state.metadata[docFile],
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error updating metadata: ${errorMessage}`
            )
          }
        }

        case "get_related_docs": {
          const { projectPath, docFile } = request.params.arguments as {
            projectPath: string
            docFile: string
          }

          try {
            const related = await findRelatedDocs(docFile, projectPath)
            return formatToolResponse({
              file: docFile,
              relatedDocs: related,
              metadata: state.metadata[docFile],
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error finding related docs: ${errorMessage}`
            )
          }
        }

        case "customize_template": {
          const { templateName, content, metadata } = request.params
            .arguments as {
            templateName: string
            content: string
            metadata?: Partial<DocMetadata>
          }

          try {
            state.templateOverrides[templateName] = {
              name: templateName,
              content,
              metadata: metadata || {},
            }

            return formatToolResponse({
              message: "Template customized successfully",
              templateName,
              availableTemplates: [
                ...Object.keys(TEMPLATES),
                ...Object.keys(state.templateOverrides),
              ],
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error customizing template: ${errorMessage}`
            )
          }
        }

        case "get_project_info": {
          const { projectPath } = request.params.arguments as {
            projectPath: string
          }

          try {
            // Get git info if available
            let gitInfo = {}
            try {
              gitInfo = {
                remoteUrl: execSync("git config --get remote.origin.url", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
                branch: execSync("git branch --show-current", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
                lastCommit: execSync("git log -1 --format=%H", {
                  cwd: projectPath,
                })
                  .toString()
                  .trim(),
              }
            } catch {
              // Not a git repository or git not available
            }

            // Get package.json if it exists
            let packageInfo = {}
            try {
              const packageJson = await fs.readFile(
                `${projectPath}/package.json`,
                "utf8"
              )
              packageInfo = JSON.parse(packageJson)
            } catch {
              // No package.json or invalid JSON
            }

            // Get directory structure
            const getDirectoryStructure = async (
              dir: string,
              depth = 3
            ): Promise<any> => {
              if (depth === 0) return "..."

              const items = await fs.readdir(dir, { withFileTypes: true })
              const structure: Record<string, any> = {}

              for (const item of items) {
                if (item.name.startsWith(".") || item.name === "node_modules")
                  continue

                if (item.isDirectory()) {
                  structure[item.name] = await getDirectoryStructure(
                    `${dir}/${item.name}`,
                    depth - 1
                  )
                } else {
                  structure[item.name] = null
                }
              }

              return structure
            }

            const projectStructure = await getDirectoryStructure(projectPath)

            return formatToolResponse({
              gitInfo,
              packageInfo,
              projectStructure,
              docsStatus: {
                completed: state.completedFiles,
                current: state.currentFile,
                inProgress: state.inProgress,
                lastRead: state.lastReadFile,
                remaining: DEFAULT_DOCS.filter(
                  (doc) => !state.completedFiles.includes(doc)
                ),
              },
            })
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            throw new McpError(
              ErrorCode.InternalError,
              `Error getting project info: ${errorMessage}`
            )
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          )
      }
    } finally {
      if (!state.inProgress) {
        resetState()
      }
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("Handoff Docs MCP server running on stdio")
}

main().catch((error: unknown) => {
  if (error instanceof McpError) {
    console.error("MCP Error:", error.code, error.message)
  } else {
    console.error(
      "Unhandled Error:",
      handleMcpError(error, "Server initialization")
    )
  }
  process.exit(1)
})
