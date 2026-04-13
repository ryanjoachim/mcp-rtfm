# MCP-RTFM

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![MCP Server](https://img.shields.io/badge/MCP_Server-0.1.0-green.svg)](https://github.com/modelcontextprotocol)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> "RTFM!" they say, but what if there's no FM to R? 🤔 Enter MCP-RTFM: an MCP server that helps you *create* the F*ing Manual everyone keeps telling people to read! Using content analysis, metadata generation, and full-text search, it transforms your non-existent or unreadable docs into an interconnected knowledge base that actually answers those "basic questions" before they're asked.

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
# (The use_mcp_tool syntax below is conceptual — actual usage depends on your MCP client)
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

- `analyze_content_gaps` - Find undocumented functions, classes, and other symbols. Optionally pass `targetFiles` (string[]) to analyze specific source files.
- `analyze_project` - Analyze project and manage documentation. Use `mode: "init"` to create skeleton docs, `mode: "analyze"` (default) to enhance existing docs with metadata and generate content, or `mode: "reset"` to clear state and re-analyze. Use `initDocs: true` with `mode: "analyze"` to also create missing skeleton docs.
- `get_project_info` - Get project structure and documentation status (git info, package.json, doc file list)
- `get_related_docs` - Find related documentation based on metadata and content links
- `read_doc` - Read a documentation file
- `refresh_documentation` - Scan codebase for changes and refresh docs. Use `mode: "sync"` (default) for git-based change detection, or `mode: "analyze"` to re-analyze content and regenerate metadata. Options: `dryRun` (boolean, default true), `includeStats` (boolean, default true), `targetDocs` (string[]) to refresh specific docs, `docFile` (string) for a single doc in analyze mode, `metadata` (object with `title`/`category`/`tags`) to override metadata in analyze mode.
- `search_docs` - Search across documentation files with fuzzy matching via MiniSearch
- `update_doc` - Update a specific documentation file. Provide either `content` for a full file replacement, or `searchContent` and `replaceContent` for a targeted diff.
- `validate_documentation` - Validate documentation for broken wiki-links

### Default Documentation Files

The server automatically creates and manages these core documentation files:

- `codebaseDetails.md` - Low-level explanations of code structure and logic
- `errorHandling.md` - Troubleshooting strategies and practices
- `handoff_notes.md` - Summary of key themes and next steps
- `integrationGuides.md` - Instructions for external system connections
- `techStack.md` - Detailed inventory of tools, libraries, and configurations
- `workflowDetails.md` - Step-by-step workflows for key processes

### Documentation Templates

Built-in template with structured sections for Purpose and Overview, Step-by-Step Explanations, Annotated Examples, Contextual Notes, and Actionable Advice.

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
// Read a document
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "read_doc",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md"
  }
});

// Update with a targeted diff (replaces the first occurrence of searchContent)
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "update_doc",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md",
    searchContent: "[Why this domain is critical to the project]",
    replaceContent: "The tech stack documentation provides essential context for development. See [[workflowDetails]] for implementation steps."
  }
});

// Or replace the entire file content at once
await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "update_doc",
  args: {
    projectPath: "/path/to/project",
    docFile: "techStack.md",
    content: "# Tech Stack\n\nUpdated full content here..."
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

// Search across documentation with fuzzy matching and relevance scoring
const results = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "search_docs",
  args: {
    projectPath: "/path/to/project",
    query: "authentication"
  }
});

// Results include matching lines with highlights and line numbers
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
// Find undocumented functions, classes, and other symbols
const gaps = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "analyze_content_gaps",
  args: {
    projectPath: "/path/to/project"
  }
});

// Results show gaps grouped by type and suggested doc file
```

### 6. Validating Documentation

```typescript
// Validate wiki-links in documentation
const validation = await use_mcp_tool({
  server: "mcp-rtfm",
  tool: "validate_documentation",
  args: {
    projectPath: "/path/to/project"
  }
});

// Results show broken links with file locations
```

## 🔧 Installation

### npm (Global)

```bash
npm install -g mcp-rtfm
```

After global install, the `mcp-rtfm` CLI is available:

```json
{
  "mcpServers": {
    "mcp-rtfm": {
      "command": "mcp-rtfm"
    }
  }
}
```

### From Source

```bash
git clone https://github.com/ryanjoachim/mcp-rtfm.git
cd mcp-rtfm
npm install
npm run build
```

Then reference `build/index.js` in your MCP client config (see below).

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

### Claude Code

For [Claude Code](https://claude.ai/code), add a `.mcp.json` file to your project root:

```json
{
  "mcpServers": {
    "mcp-rtfm": {
      "command": "node",
      "args": ["<path-to-mcp-rtfm>/build/index.js"]
    }
  }
}
```

Or use the CLI after global install:

```json
{
  "mcpServers": {
    "mcp-rtfm": {
      "command": "mcp-rtfm"
    }
  }
}
```

## 🎯 Advanced Features

### Project Auto-Detection

The server automatically analyzes your `package.json` to pre-fill documentation:

- **Framework Detection**: Express, Fastify, React, Vue, Angular, Next.js, Nuxt, Prisma, Mongoose, Sequelize
- **Pattern Detection**: TypeScript, Testing (Jest/Vitest), CLI tools, MiniSearch, Unified/Remark

When running `analyze_project` with `mode: "analyze"`, the server:
- Pre-fills `techStack.md` with detected frameworks table
- Pre-fills `codebaseDetails.md` with extracted code symbols

When running with `mode: "init"`, the server creates bare skeleton files with section headings only. Use `initDocs: true` (default) with `mode: "analyze"` to also create any missing base docs with pre-filled content from project analysis.

### Content Linking

Use `[[document-name]]` syntax to create links between documents. The server automatically tracks these relationships and includes them when finding related documentation.

### Metadata-Driven Organization

Documents are organized using:

- Categories (e.g., "api", "workflow", "technology", "documentation")
- Tags for flexible grouping (auto-generated: "api", "workflow", "technology", "code-examples", "references", "error-handling", "configuration", "security")
- Automatic relationship discovery based on shared metadata
- Content link analysis

### Fuzzy Search with MiniSearch

The server uses MiniSearch for powerful search capabilities:

- Fuzzy matching across all documentation with 0.2 tolerance
- Field-weighted search (titles given 2x priority)
- Full content and metadata indexing
- Efficient caching with TTL management (5-minute cache)
- Real-time search index updates on every doc change
- Falls back to regex scanning if the index is empty (before `analyze_project` is run)
- Search state is scoped per project — multiple projects don't interfere with each other

### Metadata Generation

- Automatic content analysis for categorization
- Tag generation based on content patterns
- Structured front matter in documents
- AST-based title and section detection
- Code snippet identification and tagging

### State Persistence

- State is scoped per project path — each project maintains its own metadata and search index independently
- State stored in `.handoff_docs/.rtfm-state/`
- Persists: metadata and search index
- Survives server restarts — restores search index and all state on startup

### Git Integration

When running inside a git repository:
- Detects changes using `git diff` and `git ls-files`
- Falls back to modification time scanning for non-git projects
- Captures git context: remote URL, branch, last commit
- Generates ASCII project structure trees

### Content Gap Analysis

Automatically finds undocumented code:
- Extracts symbols: functions, constants, classes, interfaces, types
- Checks if each symbol is mentioned in any documentation (with word-boundary matching and backtick awareness)
- Pre-loads all documentation content once for efficient analysis
- Suggests which doc file should contain the documentation
- Reports gaps by type and suggested document

### Documentation Validation

- Validates `[[wiki-link]]` syntax - checks linked files exist
- Reports broken links with file locations

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
- **Command Injection Protection**: Git commands use validated paths and isolated stdio
  - All git operations use `execFile` with argument arrays (not shell strings)
- **Operation Timeouts**: Git operations have 5-second timeouts to prevent hangs

## 🐛 Debugging

Since MCP servers communicate over stdio, debugging can be challenging. Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## 🤝 Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes and add tests if applicable
4. Build and verify: `npm run build`
5. Submit a pull request

Please open an issue first to discuss significant changes.

## 📄 License

MIT © [Ryan Joachim](https://github.com/ryanjoachim)
