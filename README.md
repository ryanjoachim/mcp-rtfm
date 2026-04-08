# MCP-RTFM

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-0.1.0-green.svg)](https://github.com/modelcontextprotocol)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> "RTFM!" they say, but what if there's no FM to R? 🤔 Enter MCP-RTFM: an MCP server that helps you *create* the F*ing Manual everyone keeps telling people to read! Using advanced content analysis, metadata generation, and intelligent search capabilities, it transforms your non-existent or unreadable docs into an interconnected knowledge base that actually answers those "basic questions" before they're asked.

> **Plot twist**: Instead of just telling people to RTFM, now you can actually give them an FM worth R-ing! Because the best response to "read the f*ing manual" is having a manual that's actually worth reading. 📚✨

## 📚 Table of Contents

- [Quick Start](#-quick-start)
- [Features](#-features)
- [Example Workflows](#-example-workflows)
- [Installation](#-installation)
- [Advanced Features](#-advanced-features)
- [Development](#-development)
- [Debugging](#-debugging)

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Build the server
npm run build

# Add to your MCP settings and start using
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "analyze_project",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "analyze", initDocs: true }
  }
});

// This will:
// 1. Create documentation structure (initDocs: true)
// 2. Analyze content with unified/remark
// 3. Generate intelligent metadata
// 4. Build search index with minisearch
// 5. Add structured front matter
// 6. Make your docs actually readable!
```

## ✨ Features

### Documentation Management Tools

- `analyze_content_gaps` - Find undocumented functions, classes, API endpoints, and other symbols
- `analyze_project` - Analyze project and manage documentation. Use `mode: "init"` (default) to create skeleton docs, `mode: "analyze"` to enhance existing docs with metadata, or `mode: "reset"` to clear state and re-analyze. Use `initDocs: true` with `mode: "analyze"` to also create missing skeleton docs.
- `customize_template` - Create or update documentation templates
- `get_project_info` - Get project structure and documentation status
- `get_related_docs` - Find related documentation based on metadata and content links
- `read_doc` - Read a documentation file. Use `trackState: false` for a stateless read.
- `refresh_documentation` - Scan codebase for changes and refresh docs. Use `mode: "sync"` (default) for git-based change detection, or `mode: "analyze"` to re-analyze content and regenerate metadata.
- `search_docs` - Search across documentation files with highlighted results
- `update_doc` - Update documentation using diff-based changes
- `validate_documentation` - Validate documentation for broken links and outdated code snippets

### Default Documentation Files

The server automatically creates and manages these core documentation files:

- `codebaseDetails.md` - Low-level explanations of code structure and logic
- `errorHandling.md` - Troubleshooting strategies and practices
- `handoff_notes.md` - Summary of key themes and next steps
- `integrationGuides.md` - Instructions for external system connections
- `techStack.md` - Detailed inventory of tools, libraries, and configurations
- `workflowDetails.md` - Step-by-step workflows for key processes

### Documentation Templates

Built-in templates for different documentation types:

- Standard Documentation Template
- API Documentation Template
- Workflow Documentation Template

Custom templates can be created using the `customize_template` tool.

## 📝 Example Workflows

### 1. Setting Up Documentation

```typescript
// Initialize and analyze documentation in one step
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "analyze_project",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "analyze", initDocs: true }
  }
});

// Just create skeleton files (no analysis)
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "analyze_project",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "init" }
  }
});

// Re-analyze existing docs (clears state first)
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "analyze_project",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "reset" }
  }
});
```

### 2. Reading and Updating Documentation

```typescript
// Read a document (stateful — sets lastReadFile for multi-file workflows)
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "read_doc",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md"
  }
});

// Read without tracking state
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "read_doc",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md",
    trackState: false
  }
});

// Update with content that links to other docs
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "update_doc",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md",
    searchContent: "[Why this domain is critical to the project]",
    replaceContent: "The tech stack documentation provides essential context for development. See [[workflowDetails]] for implementation steps.",
    continueToNext: true
  }
});
```

### 3. Finding and Reading Related Documentation

```typescript
// Find related documentation
const related = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "get_related_docs",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md"
  }
});

// Search across documentation with intelligent results
const results = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "search_docs",
  args: {
    projectPath: "/path/to/project",
    query: "authentication"
  }
});

// Results include weighted matches, line numbers, and full context
```

### 4. Syncing Documentation with Codebase Changes

```typescript
// Preview changes without applying (dryRun is default)
const preview = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "refresh_documentation",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "sync", dryRun: true }
  }
});

// Apply changes detected since last refresh
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "refresh_documentation",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "sync", dryRun: false }
  }
});

// Re-analyze and regenerate metadata for all docs
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "refresh_documentation",
  args: {
    projectPath: "/path/to/project",
    options: { mode: "analyze" }
  }
});
```

### 5. Finding Documentation Gaps

```typescript
// Find undocumented functions, classes, and API endpoints
const gaps = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "analyze_content_gaps",
  args: {
    projectPath: "/path/to/project"
  }
});

// Results show gaps grouped by type and suggested doc file
```

### 6. Creating Custom Templates

```typescript
// Create a custom template for architecture decisions
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "customize_template",
  args: {
    templateName: "architecture-decision",
    content: `# {title}

## Context
[Background and context for the decision]

## Decision
[The architecture decision made]

## Consequences
[Impact and trade-offs of the decision]

## Related Decisions
[Links to related architecture decisions]`,
    metadata: {
      category: "architecture",
      tags: ["decision-record", "design"]
    }
  }
});
```

## 🔧 Installation

### VSCode

```json
{
  "mcpServers": {
    "mcp-rtfm": {
      "command": "node",
      "args": ["<path-to-mcp-rtfm>/build/index.js"],
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

### Claude Desktop

Add to config file at:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-rtfm": {
      "command": "node",
      "args": ["<path-to-mcp-rtfm>/build/index.js"],
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

## 🎯 Advanced Features

### Project Auto-Detection

The server automatically analyzes your codebase to pre-fill documentation:

- **Framework Detection**: Express, Fastify, React, Vue, Angular, Next.js, Nuxt, Prisma, Mongoose, Sequelize
- **Pattern Detection**: TypeScript, Testing (Jest/Vitest)
- **API Endpoint Discovery**: Scans source for Express/Fastify routes and decorator-based routes
- **Component Detection**: Identifies React/Vue components from source files

When running `analyze_project` with `mode: "analyze"`, the server:
- Pre-fills `techStack.md` with detected frameworks table
- Pre-fills `integrationGuides.md` with discovered API endpoints
- Pre-fills `codebaseDetails.md` with detected UI components

### Content Linking

Use `[[document-name]]` syntax to create links between documents. The server automatically tracks these relationships and includes them when finding related documentation.

### Metadata-Driven Organization

Documents are organized using:

- Categories (e.g., "architecture", "api", "workflow", "technology", "documentation")
- Tags for flexible grouping (auto-generated: "code-examples", "references", "error-handling", "configuration", "security")
- Automatic relationship discovery based on shared metadata
- Content link analysis

### Enhanced Content Analysis

The server uses advanced libraries for better documentation management:

- **unified/remark** for Markdown processing:
  - AST-based content analysis
  - Accurate heading structure detection
  - Code block and link extraction
  - Proper Markdown parsing and manipulation

- **minisearch** for powerful search capabilities:
  - Fast fuzzy searching across all documentation
  - Field-weighted search (titles given higher priority)
  - Full content and metadata indexing
  - Efficient caching with TTL management (5-minute cache)
  - Real-time search index updates

### Intelligent Metadata Generation

- Automatic content analysis for categorization
- Smart tag generation based on content patterns
- Structured front matter in documents
- AST-based title and section detection
- Code snippet identification and tagging
- Context-aware result presentation

### Template System

- Built-in templates for common documentation types
- Custom template support with metadata defaults
- Template inheritance and override capabilities
- Custom templates persist to `.handoff_docs/.rtfm-state/templates.json`

### State Persistence

- State stored in `.handoff_docs/.rtfm-state/`
- Persists: metadata, search index, template overrides, completion state
- Survives server restarts - restores search index and all state on startup
- File locking with 30-second timeout prevents concurrent update conflicts

### Git Integration

When running inside a git repository:
- Detects changes using `git diff` and `git ls-files`
- Falls back to modification time scanning for non-git projects
- Captures git context: remote URL, branch, last commit
- Generates ASCII project structure trees

### Content Gap Analysis

Automatically finds undocumented code:
- Extracts symbols: functions, classes, interfaces, types, API routes
- Checks if each symbol is mentioned in any documentation
- Suggests which doc file should contain the documentation
- Reports gaps by type and suggested document

### Documentation Validation

- **Basic mode**: Validates `[[wiki-link]]` syntax - checks linked files exist
- **Deep mode**: Additionally validates code snippets against actual source files
- Reports broken links, stale snippets, with file locations

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build the server
npm run build

# Development with auto-rebuild
npm run watch
```

## 🔒 Security

MCP-RTFM includes security hardening for safe operation:

- **Path Validation**: All `projectPath` inputs are validated to prevent path traversal attacks
  - Rejects paths containing `../` sequences
  - Validates directory exists and is accessible
  - Resolves to absolute path before use
- **Command Injection Protection**: Git commands use isolated stdio and validated paths
  - Blocks dangerous shell characters: `;&|`$`(){}[]!\\`
  - All git operations use `stdio: ["pipe", "pipe", "pipe"]`
- **Operation Timeouts**: All git and file operations have 5-second timeouts to prevent hangs
- **File Lock Timeouts**: Concurrent file operations use 30-second lock timeouts to prevent deadlocks

## 🐛 Debugging

Since MCP servers communicate over stdio, debugging can be challenging. Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## 📄 License

MIT © [Model Context Protocol](https://github.com/modelcontextprotocol)
