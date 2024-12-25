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
const SERVER_NAME = "mcp-rtfm"
const SERVER_VERSION = "0.1.2"

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

const CATEGORY_CONFIG: Record<DocumentCategory, CategoryConfig> = {
  architecture: {
    template: TEMPLATES.standard,
    requiredSections: [
      "System Overview",
      "Components",
      "Design Decisions",
      "Trade-offs",
    ],
    allowedTags: ["architecture", "design", "infrastructure", "deployment"],
    processors: [
      // Example processor that adds links to architecture diagrams
      (content) =>
        content.replace(
          /\b(diagram|architecture diagram)\b/gi,
          "[$1](./diagrams/$1.png)"
        ),
    ],
  },
  workflows: {
    template: TEMPLATES.workflow,
    requiredSections: ["Prerequisites", "Process Flow", "Success Criteria"],
    allowedTags: ["workflow", "process", "automation"],
    validationRules: [
      // Example rule that ensures workflow steps are numbered
      (content) => /\d+\.\s+/.test(content),
    ],
  },
  api: {
    template: TEMPLATES.api,
    requiredSections: [
      "Authentication",
      "Endpoints",
      "Request/Response Examples",
    ],
    allowedTags: ["api", "endpoints", "integration"],
    processors: [
      // Example processor that formats API examples
      (content) =>
        content.replace(
          /```api-example([\s\S]*?)```/g,
          (_, code) =>
            `\`\`\`json\n${JSON.stringify(
              JSON.parse(code.trim()),
              null,
              2
            )}\n\`\`\``
        ),
    ],
  },
  guides: {
    template: TEMPLATES.standard,
    requiredSections: ["Purpose", "Step-by-Step Guide", "Common Issues"],
    allowedTags: ["guide", "tutorial", "how-to"],
  },
  general: {
    template: TEMPLATES.standard,
    allowedTags: ["documentation", "general", "reference"],
  },
}

interface McpErrorWithMetadata extends McpError {
  metadata?: any
}

interface EnhancedDocState {
  documentState: {
    currentFile: string | null
    lastReadFile: string | null
    lastReadContent: string | null
    completedFiles: string[]
    inProgress: boolean
    continueToNext: boolean
    metadata: Record<string, DocMetadata>
  }

  cacheState: {
    contextCache: {
      lastQuery?: string
      results?: SearchResult[]
      timestamp?: number
    }
    templateOverrides: Record<string, DocTemplate>
  }

  contextualState: {
    currentWorkflow?: string
    completedSteps: string[]
    availableTools: string[]
    suggestedNextTools: string[]
    modelContext: {
      lastToolResult?: any
      accumulatedContext: string[]
      relevantResources: string[]
    }
    executionHistory: Array<{
      toolName: string
      timestamp: string
      success: boolean
      context: string
      result: any
    }>
  }

  validationState: {
    lastValidation: string
    validationErrors: string[]
    pendingValidations: string[]
  }

  projectContext: {
    rootPath: string
    documentationPath: string
    gitInfo?: {
      repository: string
      branch: string
      lastCommit: string
    }
    packageInfo?: {
      name: string
      version: string
      dependencies: Record<string, string>
    }
  }
}

interface EnhancedToolDefinition {
  name: string;
  description: string;
  handler: (args: any, context: any) => Promise<any>;
  contextRequirements?: string[];
  validationRules?: Array<(args: any, context: any) => boolean>;
  postProcessors?: Array<(result: any, context: any) => any>;
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
  metadata: {
    category: string
    tags: string[]
  }
}

interface CategoryConfig {
  template: DocTemplate
  validationRules?: Array<(content: string) => boolean>
  processors?: Array<(content: string) => string>
  requiredSections?: string[]
  allowedTags?: string[]
}

type DocumentCategory =
  | "architecture"
  | "workflows"
  | "api"
  | "guides"
  | "general"

// Base Service class
abstract class MCPBaseService {
  protected logger: pino.Logger

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

    const code =
      Object.entries(errorMap).find(([key]) => message.includes(key))?.[1] ||
      ErrorCode.InternalError

    this.logger.error({ error, context }, "Error occurred")
    throw new McpError(code, `${context}: ${message}`)
  }

  abstract cleanup(): void
}

// Create a singleton state manager
class StateManager {
  private static instance: StateManager
  private state: EnhancedDocState

  private constructor() {
    this.state = this.initializeState()
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager()
    }
    return StateManager.instance
  }

  private initializeState(): EnhancedDocState {
    return {
      documentState: {
        currentFile: null,
        lastReadFile: null,
        lastReadContent: null,
        completedFiles: [],
        inProgress: false,
        continueToNext: false,
        metadata: {},
      },
      cacheState: {
        contextCache: {},
        templateOverrides: {},
      },
      contextualState: {
        currentWorkflow: undefined,
        completedSteps: [],
        availableTools: Object.keys(SERVER_CAPABILITIES.tools),
        suggestedNextTools: [],
        modelContext: {
          lastToolResult: undefined,
          accumulatedContext: [],
          relevantResources: [],
        },
        executionHistory: [],
      },
      validationState: {
        lastValidation: "",
        validationErrors: [],
        pendingValidations: [],
      },
      projectContext: {
        rootPath: "",
        documentationPath: "",
      },
    }
  }

  public getState(): EnhancedDocState {
    return this.state
  }

  public updateState(partial: Partial<EnhancedDocState>): void {
    this.state = { ...this.state, ...partial }
  }
}

// Use the state manager in services
const stateManager = StateManager.getInstance();

// Technical Analysis Service
class TechnicalAnalysisService extends MCPBaseService {
  private cache: QuickLRU<string, any>

  constructor(logger: pino.Logger) {
    super(logger)
    this.cache = new QuickLRU({ maxSize: 1000 })
  }

  async analyzeCode(content: string, type: string): Promise<any> {
    try {
      const cacheKey = `${type}:${content.length}:${content.slice(
        0,
        50
      )}:${content.charCodeAt(0)}`
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
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unsupported analysis type: ${type}`
        )
    }
  }

  private analyzeAST(content: string): any {
    return {
      ast: parse(content, { sourceType: "module", plugins: ["typescript"] }),
    }
  }

  private async analyzeDependencies(content: string): Promise<any> {
    const tempFile = `/tmp/analysis_${Date.now()}.ts`
    try {
      await fs.writeFile(tempFile, content)
      const result = await cruise([tempFile], {
        includeOnly: "^src",
        maxDepth: 10,
      })
      return result
    } finally {
      await fs.unlink(tempFile).catch(() => { }) // Cleanup temp file
    }
  }

  cleanup(): void {
    this.cache.clear()
  }
}

// Documentation Service
class DocumentationService extends MCPBaseService {
  private state: EnhancedDocState
  private searchEngine: MiniSearch
  private markdownProcessor: any
  private cache: QuickLRU<string, any>

  constructor(logger: pino.Logger) {
    super(logger)
    this.state = this.initializeState()
    this.searchEngine = new MiniSearch({
      fields: ["title", "content"],
      storeFields: ["title", "category", "tags", "lastUpdated"],
    })
    this.markdownProcessor = unified().use(remarkParse).use(remarkStringify)
    this.cache = new QuickLRU({ maxSize: 1000 })
  }

  private initializeState(): EnhancedDocState {
    return {
      documentState: {
        currentFile: null,
        lastReadFile: null,
        lastReadContent: null,
        completedFiles: [],
        inProgress: false,
        continueToNext: false,
        metadata: {},
      },
      cacheState: {
        contextCache: {},
        templateOverrides: {},
      },
      contextualState: {
        currentWorkflow: undefined,
        completedSteps: [],
        availableTools: Object.keys(SERVER_CAPABILITIES.tools),
        suggestedNextTools: [],
        modelContext: {
          lastToolResult: undefined,
          accumulatedContext: [],
          relevantResources: [],
        },
        executionHistory: [],
      },
      validationState: {
        lastValidation: "",
        validationErrors: [],
        pendingValidations: [],
      },
      projectContext: {
        rootPath: "",
        documentationPath: "",
      },
    }
  }

  async analyzeExistingDocs(projectPath: string) {
    const docsPath = `${projectPath}/.handoff_docs`
    try {
      await fs.access(docsPath)

      // Update project context
      this.state.projectContext.rootPath = projectPath
      this.state.projectContext.documentationPath = docsPath

      // Reset state for new analysis
      this.state.documentState.completedFiles = []
      this.state.documentState.inProgress = true
      this.state.contextualState.currentWorkflow = "documentation_analysis"

      await fs.access(docsPath)
    } catch {
      this.state.validationState.validationErrors.push(
        `Documentation directory not found at ${docsPath}`
      )
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Documentation directory not found at ${docsPath}`
      )
    }

    try {
      const files = await fs.readdir(docsPath)
      const markdownFiles = files.filter((file) => file.endsWith(".md"))

      if (markdownFiles.length === 0) {
        this.state.validationState.validationErrors.push(
          `No markdown files found in ${docsPath}`
        )
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No markdown files found in ${docsPath}`
        )
      }

      for (const doc of markdownFiles) {
        const filePath = `${docsPath}/${doc}`
        const content = await fs.readFile(filePath, "utf8")

        // Analyze content and update state
        const analysis = await this.analyzeContent(content)
        const { category, tags } = this.categorizeContent(
          doc,
          content,
          analysis
        )

        const metadata: DocMetadata = {
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
          relatedDocs: [],
        }

        await this.updateMetadata(filePath, metadata)
        const relatedDocs = await this.findRelatedDocs(doc, projectPath)
        await this.updateMetadata(filePath, { relatedDocs })

        this.updateSearchIndex(doc, content, {
          ...metadata,
          relatedDocs,
        })

        // Update state with processed file
        this.state.documentState.completedFiles.push(doc)
        this.state.contextualState.completedSteps.push(`analyzed_${doc}`)
        this.state.contextualState.modelContext?.accumulatedContext.push(
          JSON.stringify({ file: doc, metadata, analysis })
        )

        // Add content enhancement suggestions if needed
        if (!content.startsWith("---")) {
          const enhancedContent = this.generateEnhancedContent(
            content,
            metadata
          )
          await fs.writeFile(filePath, enhancedContent)
          this.state.contextualState.completedSteps.push(`enhanced_${doc}`)
        }
      }

      // Update completion state
      this.state.documentState.inProgress = false
      this.state.contextualState.currentWorkflow = undefined

      return {
        docsPath,
        files: markdownFiles,
        metadata: this.state.documentState.metadata,
        contextCache: {
          timestamp: this.state.cacheState.contextCache.timestamp,
          ttl: CACHE_TTL,
        },
        analysisState: {
          completedFiles: this.state.documentState.completedFiles,
          executionHistory: this.state.contextualState.executionHistory,
        },
      }
    } catch (error) {
      this.handleError(error, "Error analyzing documentation")
    }
  }

  async initializeProject(projectPath: string) {
    const docsPath = `${projectPath}/.handoff_docs`

    // Update project context
    this.state.projectContext.rootPath = projectPath
    this.state.projectContext.documentationPath = docsPath
    this.state.contextualState.currentWorkflow = "project_initialization"

    try {
      await fs.mkdir(docsPath, { recursive: true })

      for (const doc of DEFAULT_DOCS) {
        const filePath = `${docsPath}/${doc}`
        try {
          await fs.access(filePath)
          this.state.contextualState.completedSteps.push(`verified_${doc}`)
        } catch {
          const title = doc
            .replace(".md", "")
            .split(/[_-]/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ")

          await fs.writeFile(
            filePath,
            TEMPLATES.standard.content.replace("{title}", title)
          )
          this.state.contextualState.completedSteps.push(`created_${doc}`)
          this.state.documentState.completedFiles.push(doc)
        }
      }

      // Update state after initialization
      this.state.documentState.inProgress = false
      this.state.contextualState.currentWorkflow = undefined

      return {
        message: "Documentation structure initialized",
        docsPath,
        files: DEFAULT_DOCS,
        state: {
          completedFiles: this.state.documentState.completedFiles,
          steps: this.state.contextualState.completedSteps,
        },
      }
    } catch (error) {
      this.handleError(error, "Error initializing project")
    }
  }

  async readDoc(
    projectPath: string,
    docFile: string,
    category?: DocumentCategory
  ) {
    try {
      const filePath = `${projectPath}/.handoff_docs/${docFile}`
      const content = await fs.readFile(filePath, "utf8")

      // Update state
      this.state.documentState.lastReadFile = docFile
      this.state.documentState.lastReadContent = content
      this.state.documentState.currentFile = docFile
      this.state.documentState.inProgress = true
      this.state.contextualState.currentWorkflow = "document_reading"

      // Add to context
      this.state.contextualState.modelContext?.accumulatedContext.push(
        JSON.stringify({
          action: "read",
          file: docFile,
          timestamp: new Date().toISOString(),
        })
      )

      if (category) {
        const validation = await this.validateContentForCategory(
          content,
          category
        )
        if (!validation.valid) {
          this.state.validationState.validationErrors.push(...validation.issues)
          this.logger.warn(
            { docFile, category, issues: validation.issues },
            "Document has validation issues"
          )
        }

        return await this.processContentByCategory(content, category)
      }

      return content
    } catch (error) {
      this.handleError(error, "Error reading documentation")
    }
  }

  async updateDoc(
    projectPath: string,
    docFile: string,
    searchContent: string,
    replaceContent: string,
    continueToNext = false
  ) {
    try {
      if (this.state.documentState.lastReadFile !== docFile || !this.state.documentState.lastReadContent) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Must read ${docFile} before updating it`
        )
      }

      const filePath = `${projectPath}/.handoff_docs/${docFile}`

      if (!this.state.documentState.lastReadContent.includes(searchContent)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Search content not found in ${docFile}`
        )
      }

      // Create new content
      const newContent = this.state.documentState.lastReadContent.replace(
        searchContent,
        replaceContent
      )
      await fs.writeFile(filePath, newContent)

      // Update state
      this.state.documentState.lastReadContent = newContent
      if (!this.state.documentState.completedFiles.includes(docFile)) {
        this.state.documentState.completedFiles.push(docFile)
      }
      this.state.documentState.continueToNext = continueToNext
      this.state.contextualState.completedSteps.push(`updated_${docFile}`)

      // Handle continuation logic
      if (continueToNext) {
        const remainingDocs = DEFAULT_DOCS.filter(
          (doc) => !this.state.documentState.completedFiles.includes(doc)
        )
        if (remainingDocs.length > 0) {
          this.state.documentState.currentFile = remainingDocs[0]
          this.state.contextualState.currentWorkflow = "document_updating"
        } else {
          this.state.documentState.currentFile = null
          this.state.documentState.inProgress = false
          this.state.contextualState.currentWorkflow = undefined
        }
      }

      // Record the update in context
      this.state.contextualState.modelContext?.accumulatedContext.push(
        JSON.stringify({
          action: "update",
          file: docFile,
          timestamp: new Date().toISOString(),
          changes: { from: searchContent, to: replaceContent },
        })
      )

      return {
        message: "Documentation updated successfully",
        file: docFile,
        completedFiles: this.state.documentState.completedFiles,
        nextFile: this.state.documentState.currentFile,
        diff: {
          from: searchContent,
          to: replaceContent,
        },
        state: {
          workflow: this.state.contextualState.currentWorkflow,
          completedSteps: this.state.contextualState.completedSteps,
        },
      }
    } catch (error) {
      this.handleError(error, "Error updating documentation")
    }
  }

  private async analyzeContent(content: string): Promise<{
    title: string
    headings: string[]
    codeBlocks: string[]
    links: string[]
  }> {
    const ast = await this.markdownProcessor.parse(content)
    const result = {
      title: "",
      headings: [] as string[],
      codeBlocks: [] as string[],
      links: [] as string[],
    }

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

  private generateEnhancedContent(
    content: string,
    metadata: DocMetadata
  ): string {
    return `---
title: ${metadata.title}
category: ${metadata.category}
tags: ${metadata.tags.join(", ")}
lastUpdated: ${metadata.lastUpdated}
relatedDocs: ${metadata.relatedDocs.join(", ")}
---

${content}`
  }

  private categorizeContent(
    fileName: string,
    content: string,
    analysis: {
      title: string
      headings: string[]
      codeBlocks: string[]
      links: string[]
    }
  ): { category: string; tags: string[] } {
    const tags = new Set<string>()
    let category = "documentation"

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

    if (analysis.codeBlocks.length > 0) tags.add("code-examples")
    if (analysis.links.length > 0) tags.add("references")

    return { category, tags: Array.from(tags) }
  }

  private async updateMetadata(
    filePath: string,
    metadata: Partial<DocMetadata>
  ): Promise<void> {
    const fileName = filePath.split("/").pop() as string
    this.state.documentState.metadata[fileName] = {
      ...this.state.documentState.metadata[fileName],
      ...metadata,
      lastUpdated: new Date().toISOString(),
    } as DocMetadata
  }

  private updateSearchIndex(
    docFile: string,
    content: string,
    metadata: DocMetadata
  ): void {
    const docId = docFile.replace(".md", "")
    this.searchEngine.remove({ id: docId })
    this.searchEngine.add({
      id: docId,
      title: metadata.title,
      content,
      category: metadata.category,
      tags: metadata.tags,
      lastUpdated: metadata.lastUpdated,
    })
  }

  async searchContent(
    projectPath: string,
    query: string
  ): Promise<SearchResult[]> {
    // Cache check
    if (
      this.state.cacheState.contextCache.lastQuery === query &&
      this.state.cacheState.contextCache.results &&
      this.state.cacheState.contextCache.timestamp &&
      Date.now() - this.state.cacheState.contextCache.timestamp < CACHE_TTL
    ) {
      return this.state.cacheState.contextCache.results
    }

    const results: SearchResult[] = []
    const docsPath = `${projectPath}/.handoff_docs`
    const searchRegex = new RegExp(query, "gi")

    try {
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
            .filter(
              (match): match is NonNullable<typeof match> => match !== null
            )

          if (matches.length > 0) {
            results.push({ file: doc, matches })
          }
        } catch (error) {
          this.logger.error(`Error searching ${doc}:`, error)
        }
      }

      // Update cache
      // Update cache
      this.state.cacheState.contextCache = {
        lastQuery: query,
        results,
        timestamp: Date.now(),
      }

      // Update contextual state
      this.state.contextualState.currentWorkflow = "content_search"
      this.state.contextualState.completedSteps.push(`searched_${query}`)
      this.state.contextualState.modelContext?.accumulatedContext.push(
        JSON.stringify({
          action: "search",
          query,
          resultsCount: results.length,
          timestamp: new Date().toISOString(),
        })
      )

      return results
    } catch (error) {
      this.handleError(error, "Error searching documentation")
      return []
    }
  }

  async findRelatedDocs(
    docFile: string,
    projectPath: string
  ): Promise<string[]> {
    const metadata = this.state.documentState.metadata[docFile]
    if (!metadata) return []

    const related = new Set<string>()

    // Find docs with matching tags
    Object.entries(this.state.documentState.metadata).forEach(([file, meta]) => {
      if (
        file !== docFile &&
        meta.tags.some((tag) => metadata.tags.includes(tag))
      ) {
        related.add(file)
      }
    })

    // Find docs in same category
    Object.entries(this.state.documentState.metadata).forEach(([file, meta]) => {
      if (file !== docFile && meta.category === metadata.category) {
        related.add(file)
      }
    })

    // Find explicitly linked docs
    try {
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

      // Update contextual state
      this.state.contextualState.completedSteps.push(`found_related_${docFile}`)
      this.state.contextualState.modelContext?.accumulatedContext.push(
        JSON.stringify({
          action: "find_related",
          file: docFile,
          relatedCount: related.size,
          timestamp: new Date().toISOString(),
        })
      )
    } catch (error) {
      this.logger.error(`Error finding related docs for ${docFile}:`, error)
    }

    return Array.from(related)
  }

  private async validateContentForCategory(
    content: string,
    category: DocumentCategory
  ): Promise<{ valid: boolean; issues: string[] }> {
    const config = CATEGORY_CONFIG[category]
    const issues: string[] = []

    if (config.requiredSections) {
      const missingRequiredSections = config.requiredSections.filter(
        (section) => !content.includes(`## ${section}`)
      )
      if (missingRequiredSections.length > 0) {
        issues.push(
          `Missing required sections: ${missingRequiredSections.join(", ")}`
        )
      }
    }

    if (config.validationRules) {
      for (const rule of config.validationRules) {
        if (!rule(content)) {
          issues.push("Content does not match required format")
        }
      }
    }

    if (config.allowedTags) {
      const contentTags = this.extractTags(content)
      const invalidTags = contentTags.filter(
        (tag) => !config.allowedTags!.includes(tag)
      )
      if (invalidTags.length > 0) {
        issues.push(`Invalid tags for category: ${invalidTags.join(", ")}`)
      }
    }

    // Update validation state
    this.state.validationState.lastValidation = new Date().toISOString()
    if (issues.length > 0) {
      this.state.validationState.validationErrors.push(...issues)
    }

    return {
      valid: issues.length === 0,
      issues,
    }
  }

  private extractTags(content: string): string[] {
    const frontMatter = content.match(/---\n([\s\S]*?)\n---/)
    if (!frontMatter) return []

    const tagsMatch =
      frontMatter[1].match(/tags:\s*\[(.*?)\]/) ||
      frontMatter[1].match(/tags:\s*(.*?)(?:\n|$)/)
    if (!tagsMatch) return []

    return tagsMatch[1]
      .split(",")
      .map((tag) => tag.trim().replace(/[\[\]]/g, ""))
      .filter((tag) => tag.length > 0)
  }

  async processContentByCategory(
    content: string,
    category: DocumentCategory
  ): Promise<string> {
    const config = CATEGORY_CONFIG[category]
    if (!config) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid category: ${category}`
      )
    }

    let processedContent = content

    if (config.processors) {
      for (const processor of config.processors) {
        processedContent = processor(processedContent)
      }
    }

    // Update contextual state
    this.state.contextualState.completedSteps.push(`processed_${category}`)
    this.state.contextualState.modelContext?.accumulatedContext.push(
      JSON.stringify({
        action: "process_category",
        category,
        timestamp: new Date().toISOString(),
      })
    )

    return processedContent
  }

  private handleError(error: unknown, context: string): never {
    // Update error state
    if (error instanceof Error) {
      this.state.validationState.validationErrors.push(error.message)
    }

    this.state.contextualState.executionHistory.push({
      toolName: this.state.contextualState.currentWorkflow || "unknown",
      timestamp: new Date().toISOString(),
      success: false,
      context,
      result: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof McpError) throw error

    const message = error instanceof Error ? error.message : String(error)
    throw new McpError(ErrorCode.InternalError, `${context}: ${message}`)
  }

  getState(): EnhancedDocState {
    return this.state
  }

  cleanup(): void {
    this.cache.clear()
    this.state = this.initializeState()
    this.searchEngine.removeAll()
  }
}

// Context-Aware Tool Handler
class ContextAwareToolHandler {
  private state: EnhancedDocState
  private tools: Record<string, EnhancedToolDefinition>
  private readonly logger: pino.Logger

  constructor(logger: pino.Logger) {
    this.logger = logger
    this.state = this.initializeState()
    this.tools = this.loadToolDefinitions()
  }

  private initializeState(): EnhancedDocState {
    return {
      documentState: {
        currentFile: null,
        lastReadFile: null,
        lastReadContent: null,
        completedFiles: [],
        inProgress: false,
        continueToNext: false,
        metadata: {},
      },
      cacheState: {
        contextCache: {},
        templateOverrides: {},
      },
      contextualState: {
        currentWorkflow: undefined,
        completedSteps: [],
        availableTools: Object.keys(SERVER_CAPABILITIES.tools),
        suggestedNextTools: [],
        modelContext: {
          lastToolResult: undefined,
          accumulatedContext: [],
          relevantResources: [],
        },
        executionHistory: [],
      },
      validationState: {
        lastValidation: "",
        validationErrors: [],
        pendingValidations: [],
      },
      projectContext: {
        rootPath: "",
        documentationPath: "",
      },
    }
  }

  private loadToolDefinitions(): Record<string, EnhancedToolDefinition> {
    return {
      analyze_existing_docs: {
        name: "analyze_existing_docs",
        description: "Analyze existing documentation files",
        handler: async (args: any, context: any) => {
          const docService = new DocumentationService(this.logger)
          return docService.analyzeExistingDocs(args.projectPath)
        },
        contextRequirements: ["projectPath"],
        validationRules: [
          (args) => !!args.projectPath,
          (args) => typeof args.projectPath === "string",
        ],
        postProcessors: [
          (result) => {
            this.state.contextualState.suggestedNextTools = [
              "read_doc",
              "update_doc",
            ]
            return result
          },
        ],
      },
      // Add other tools similarly...
    }
  }

  private async validateToolExecution(
    toolName: string,
    context: any
  ): Promise<void> {
    const tool = this.tools[toolName]
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Tool not found: ${toolName}`
      )
    }

    if (tool.contextRequirements?.length) {
      const missingContext = tool.contextRequirements.filter(
        (req) => !context || !context[req]
      )
      if (missingContext.length > 0) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Missing required context: ${missingContext.join(", ")}`
        )
      }
    }

    if (tool.validationRules) {
      const validationErrors = tool.validationRules
        .map((rule) => rule(context, tool))
        .filter((result) => !result)

      if (validationErrors.length > 0) {
        this.state.validationState.validationErrors.push(
          `Tool ${toolName} validation failed`
        )
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Validation failed for tool: ${toolName}`
        )
      }
    }
  }

  private async buildExecutionContext(
    toolName: string,
    context: any
  ): Promise<any> {
    const enrichedContext = {
      ...context,
      state: this.state,
      timestamp: new Date().toISOString(),
      tool: this.tools[toolName],
      previousTools: this.state.contextualState.completedSteps,
      modelContext: this.state.contextualState.modelContext,
    }

    // Update project context if available
    if (context.projectPath) {
      this.state.projectContext.rootPath = context.projectPath
      this.state.projectContext.documentationPath = `${context.projectPath}/.handoff_docs`

      // Try to gather git info
      try {
        const gitInfo = {
          repository: execSync("git config --get remote.origin.url", {
            cwd: context.projectPath,
          })
            .toString()
            .trim(),
          branch: execSync("git branch --show-current", {
            cwd: context.projectPath,
          })
            .toString()
            .trim(),
          lastCommit: execSync("git log -1 --format=%H", {
            cwd: context.projectPath,
          })
            .toString()
            .trim(),
        }
        this.state.projectContext.gitInfo = gitInfo
      } catch (error) {
        this.logger.warn("Could not gather git info")
      }
    }

    return enrichedContext
  }

  private async executeTool(
    toolName: string,
    args: any,
    context: any
  ): Promise<any> {
    const tool = this.tools[toolName]
    const result = await tool.handler(args, context)

    if (tool.postProcessors) {
      return tool.postProcessors.reduce(
        (processedResult, processor) => processor(processedResult, context),
        result
      )
    }

    return result
  }

  public async executeToolWithContext(
    toolName: string,
    args: any,
    context: any
  ): Promise<any> {
    await this.validateToolExecution(toolName, args)
    const enrichedContext = await this.buildExecutionContext(toolName, context)
    const result = await this.executeTool(toolName, args, enrichedContext)
    await this.updateContextualState(toolName, result, enrichedContext)
    return result
  }

  private async updateContextualState(
    toolName: string,
    result: any,
    context: any
  ): Promise<void> {
    this.state.contextualState.modelContext.lastToolResult = result
    this.state.contextualState.completedSteps.push(toolName)
    this.state.contextualState.modelContext.accumulatedContext.push(
      JSON.stringify({
        tool: toolName,
        result,
        timestamp: new Date().toISOString(),
      })
    )

    // Update execution history
    this.state.contextualState.executionHistory.push({
      toolName,
      timestamp: new Date().toISOString(),
      success: true,
      context: JSON.stringify(context),
      result,
    })

    // Update suggested next tools based on current tool
    this.updateSuggestedNextTools(toolName, result)
  }

  private updateSuggestedNextTools(toolName: string, result: any): void {
    // Logic to suggest next tools based on current execution
    const suggestionMap: Record<string, string[]> = {
      analyze_existing_docs: ["read_doc", "search_docs"],
      read_doc: ["update_doc", "get_related_docs"],
      update_doc: ["read_doc", "search_docs", "get_related_docs"],
      search_docs: ["read_doc", "get_related_docs"],
      get_related_docs: ["read_doc", "update_doc"],
    }

    this.state.contextualState.suggestedNextTools =
      suggestionMap[toolName] || []
  }

  private recordExecution(
    toolName: string,
    startTime: number,
    result: any,
    success: boolean
  ): void {
    const duration = Date.now() - startTime
    this.logger.info(
      {
        tool: toolName,
        duration,
        success,
        result: success ? result : "error",
      },
      "Tool execution completed"
    )
  }

  private handleToolError(
    error: unknown,
    toolName: string,
    context: any
  ): McpError {
    const errorMessage = error instanceof Error ? error.message : String(error)

    this.state.contextualState.executionHistory.push({
      toolName,
      timestamp: new Date().toISOString(),
      success: false,
      context: JSON.stringify(context),
      result: errorMessage,
    })

    this.state.validationState.validationErrors.push(errorMessage)

    if (error instanceof McpError) return error

    this.logger.error(
      { tool: toolName, error: errorMessage, context },
      "Tool execution failed"
    )

    return new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${errorMessage}`
    )
  }

  public getState(): EnhancedDocState {
    return this.state
  }

  public getSuggestedNextTools(): string[] {
    return this.state.contextualState.suggestedNextTools
  }
}

// Initialize services
const logger = pino.default({
  level: "info",
  transport: {
    target: "pino-pretty",
  },
})

const docService = new DocumentationService(logger)
const techAnalysisService = new TechnicalAnalysisService(logger)
const toolHandler = new ContextAwareToolHandler(logger);

// Helper function for formatting tool responses
const formatToolResponse = (data: any) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(data, null, 2),
    },
  ],
})

// Initialize server
const SERVER_CAPABILITIES = {
  tools: {
    analyze_existing_docs: {
      name: "analyze_existing_docs",
      description:
        "Analyze existing documentation files with enhanced content analysis and metadata generation",
    },
    analyze_project_with_metadata: {
      name: "analyze_project_with_metadata",
      description:
        "Analyze project structure, create initial documentation files, and enhance with metadata/context",
    },
    analyze_project: {
      name: "analyze_project",
      description:
        "Analyze project structure and create initial documentation files",
    },
    read_doc: {
      name: "read_doc",
      description: "Read a documentation file (required before updating)",
    },
    update_doc: {
      name: "update_doc",
      description:
        "Update a specific documentation file using diff-based changes",
    },
    search_docs: {
      name: "search_docs",
      description: "Search across documentation files with highlighted results",
    },
    get_related_docs: {
      name: "get_related_docs",
      description: "Find related documentation files based on content analysis",
    },
    get_project_info: {
      name: "get_project_info",
      description: "Get project information including git and package details",
    },
    customize_template: {
      name: "customize_template",
      description:
        "Customize documentation template with custom content and metadata",
    },
  },
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
        description: "Documentation of project technologies and configurations",
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
} as const

const server = new Server(
  {
    name: "mcp-rtfm",
    version: "0.1.0",
  },
  {
    capabilities: SERVER_CAPABILITIES,
  }
)

// Request Handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(SERVER_CAPABILITIES.tools),
}))

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: Object.entries(SERVER_CAPABILITIES.resources.direct).map(
    ([uri, resource]) => ({
      uri,
      ...resource,
      mimeType: "text/markdown",
    })
  ),
}))

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: Object.entries(
    SERVER_CAPABILITIES.resources.templates
  ).map(([uriTemplate, template]) => ({
    uriTemplate,
    ...template,
    mimeType: "text/markdown",
  })),
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  type RequestParams = typeof request.params
  const projectPath = (
    request.params as RequestParams & { projectPath: string }
  ).projectPath

  const validateUri = (uri: string): { category: string; name: string } => {
    const match = uri.match(/^docs:\/\/([^/]+)\/([^/]+)$/)
    if (!match) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid documentation URI: ${uri}. Expected format: docs://{category}/{name}`
      )
    }

    const [_, category, name] = match

    if (!(category in CATEGORY_CONFIG)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid documentation category: ${category}. Must be one of: ${Object.keys(
          CATEGORY_CONFIG
        ).join(", ")}`
      )
    }

    if (!name || name.includes('/') || name.includes('..')) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Invalid document name: ${name}. Name cannot be empty or contain path traversal`
      )
    }

    return { category, name }
  }

  if (!projectPath) {
    throw new McpError(ErrorCode.InvalidRequest, "Project path is required")
  }

  const { category, name } = validateUri(request.params.uri)
  const docFile = `${name}.md`

  try {
    const content = await docService.readDoc(
      projectPath,
      docFile,
      category as DocumentCategory
    )

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/markdown",
          text: content,
          metadata: {
            category,
            template:
              CATEGORY_CONFIG[category as DocumentCategory].template.name,
          },
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

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  try {
    // Initialize context-aware handling
    if (!request.params.arguments) {
      throw new McpError(ErrorCode.InvalidRequest, "Missing arguments")
    }

    const contextualResult = await toolHandler.executeToolWithContext(
      request.params.name,
      request.params.arguments,
      {
        previousTools: toolHandler.getState().contextualState.completedSteps,
        modelContext: request.params.modelContext,
        projectState: docService.getState(),
        projectPath: request.params.arguments.projectPath,
      }
    )

    // Process tool-specific logic
    let result
    switch (request.params.name) {
      case "analyze_existing_docs": {
        const { projectPath } = request.params.arguments as {
          projectPath: string
        }
        if (!projectPath) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path is required"
          )
        }
        result = await docService.analyzeExistingDocs(projectPath)
        break
      }

      case "analyze_project_with_metadata":
      case "analyze_project": {
        const { projectPath } = request.params.arguments as {
          projectPath: string
        }
        if (!projectPath) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path is required"
          )
        }
        result = await docService.initializeProject(projectPath)
        break
      }

      case "read_doc": {
        const { projectPath, docFile } = request.params.arguments as {
          projectPath: string
          docFile: string
        }
        if (!projectPath || !docFile) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path and doc file are required"
          )
        }
        const content = await docService.readDoc(projectPath, docFile)
        result = { content }
        break
      }

      case "update_doc": {
        const {
          projectPath,
          docFile,
          searchContent,
          replaceContent,
          continueToNext,
        } = request.params.arguments as {
          projectPath: string
          docFile: string
          searchContent: string
          replaceContent: string
          continueToNext?: boolean
        }
        if (!projectPath || !docFile || !searchContent || !replaceContent) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path, doc file, search content, and replace content are required"
          )
        }
        result = await docService.updateDoc(
          projectPath,
          docFile,
          searchContent,
          replaceContent,
          continueToNext
        )
        break
      }

      case "search_docs": {
        const { projectPath, query } = request.params.arguments as {
          projectPath: string
          query: string
        }
        if (!projectPath || !query) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path and query are required"
          )
        }
        const searchResults = await docService.searchContent(
          projectPath,
          query
        )
        result = { query, results: searchResults }
        break
      }

      case "get_related_docs": {
        const { projectPath, docFile } = request.params.arguments as {
          projectPath: string
          docFile: string
        }
        if (!projectPath || !docFile) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path and doc file are required"
          )
        }
        const relatedDocs = await docService.findRelatedDocs(
          docFile,
          projectPath
        )
        result = {
          file: docFile,
          relatedDocs,
          metadata: docService.getState().documentState.metadata[docFile],
        }
        break
      }

      case "customize_template": {
        const { templateName, content, metadata } = request.params
          .arguments as {
            templateName: string
            content: string
            metadata?: Partial<DocMetadata>
          }
        if (!templateName || !content) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Template name and content are required"
          )
        }
        const state = docService.getState()
        state.cacheState.templateOverrides[templateName] = {
          name: templateName,
          content,
          metadata: {
            category: metadata?.category || "documentation",
            tags: metadata?.tags || [],
          },
        }

        result = {
          message: "Template customized successfully",
          templateName,
          availableTemplates: [
            ...Object.keys(TEMPLATES),
            ...Object.keys(state.cacheState.templateOverrides),
          ],
        }
        break
      }

      case "get_project_info": {
        const { projectPath } = request.params.arguments as {
          projectPath: string
        }
        if (!projectPath) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Project path is required"
          )
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

          const state = docService.getState()
          result = {
            gitInfo,
            packageInfo,
            docsStatus: {
              completed: state.documentState.completedFiles,
              current: state.documentState.currentFile,
              inProgress: state.documentState.inProgress,
              lastRead: state.documentState.lastReadFile,
              remaining: DEFAULT_DOCS.filter(
                (doc) => !state.documentState.completedFiles.includes(doc)
              ),
            },
          }
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Error getting project info: ${error instanceof Error ? error.message : String(error)
            }`
          )
        }
        break
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        )
    }

    // Combine tool-specific result with contextual information
    const enhancedResponse = {
      ...formatToolResponse(result),
      metadata: {
        suggestedNextTools: toolHandler.getSuggestedNextTools(),
        executionHistory: toolHandler
          .getState()
          .contextualState.executionHistory.slice(-5), // Last 5 executions
        validationState: toolHandler.getState().validationState,
        contextualState: {
          currentWorkflow:
            toolHandler.getState().contextualState.currentWorkflow,
          completedSteps:
            toolHandler.getState().contextualState.completedSteps,
          lastToolResult: contextualResult,
        },
        projectContext: {
          rootPath: toolHandler.getState().projectContext.rootPath,
          documentationPath:
            toolHandler.getState().projectContext.documentationPath,
          gitInfo: toolHandler.getState().projectContext.gitInfo,
          packageInfo: toolHandler.getState().projectContext.packageInfo,
        },
      },
    }

    // Cleanup if processing is complete
    if (!docService.getState().documentState.inProgress) {
      docService.cleanup()
    }

    return enhancedResponse
  } catch (error) {
    // Enhanced error handling with context
    const errorContext = {
      tool: request.params.name,
      arguments: request.params.arguments,
      state: toolHandler.getState().contextualState,
    }

    logger.error({ error, context: errorContext }, "Error executing tool")

    if (error instanceof McpError) {
      // Add context to MCP errors using the enhanceMcpError function
      throw enhanceMcpError(error, {
        context: errorContext,
        validationState: toolHandler.getState().validationState,
      })
    }

    throw enhanceMcpError(
      new McpError(
        ErrorCode.InternalError,
        `Error executing tool: ${error instanceof Error ? error.message : String(error)
        }`
      ),
      { context: errorContext }
    )
  }
}
)

// Cleanup handler
const cleanup = () => {
  try {
    docService.cleanup()
    techAnalysisService.cleanup()
    logger.info("Services cleaned up successfully")
  } catch (error) {
    logger.error({ error }, "Error during cleanup")
  }
  process.exit(0)
}

// Register cleanup handlers
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('uncaughtException', (error) => {
  logger.error({ error }, "Uncaught exception")
  cleanup()
})
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, "Unhandled rejection")
  cleanup()
})

function enhanceMcpError(error: McpError, metadata: any): McpErrorWithMetadata {
  const enhanced = error as McpErrorWithMetadata
  enhanced.metadata = metadata
  return enhanced
}

// Main function
async function main() {
  try {
    const transport = new StdioServerTransport()

    // Initialize server
    await server.connect(transport)
    logger.info(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        tools: Object.keys(SERVER_CAPABILITIES.tools).length,
        resources:
          Object.keys(SERVER_CAPABILITIES.resources.direct).length +
          Object.keys(SERVER_CAPABILITIES.resources.templates).length,
      },
      "MCP Server started successfully"
    )
  } catch (error) {
    if (error instanceof McpError) {
      logger.error(
        { code: error.code, message: error.message },
        "MCP Error during startup"
      )
    } else {
      logger.error({ error }, "Server startup failed")
    }
    process.exit(1)
  }
}

// Start server
main().catch((error: unknown) => {
  if (error instanceof McpError) {
    logger.error({ code: error.code, message: error.message }, "MCP Error during startup")
  } else {
    const message = error instanceof Error ? error.message : String(error)
    logger.error({ message }, "Unhandled error during startup")
  }
  process.exit(1)
})
