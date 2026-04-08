// ============================================================================
// Content Analysis, Metadata, and Search Index Management
// ============================================================================

import * as fs from "fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { state, searchEngine } from "./state.js";
import { getActualDocs } from "./templates.js";
import { slugToTitle, freshTimestamp } from "./utils.js";
import { CACHE_TTL } from "./types.js";
import type { DocMetadata, SearchResult } from "./types.js";

// Initialize unified processor for markdown
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkStringify);

// Helper function to analyze markdown content
export const analyzeContent = async (content: string): Promise<{
  title: string;
  headings: string[];
  codeBlocks: string[];
  links: string[];
}> => {
  const ast = await markdownProcessor.parse(content);
  const result = {
    title: "",
    headings: [] as string[],
    codeBlocks: [] as string[],
    links: [] as string[]
  };

  // @ts-ignore - types are not exact but functionality works
  const visit = (node: any) => {
    if (node.type === "heading" && node.depth === 1) {
      result.title = node.children?.[0]?.value || "";
    } else if (node.type === "heading") {
      result.headings.push(node.children?.[0]?.value || "");
    } else if (node.type === "code") {
      result.codeBlocks.push(node.value || "");
    } else if (node.type === "link") {
      result.links.push(node.url || "");
    }

    if (node.children) {
      node.children.forEach(visit);
    }
  };

  visit(ast);
  return result;
};

// Helper function to determine document category and tags
export const categorizeContent = (
  fileName: string,
  content: string,
  analysis: Awaited<ReturnType<typeof analyzeContent>>
): { category: string; tags: string[] } => {
  const tags = new Set<string>();
  let category = "documentation";

  // Category detection based on filename and headings
  if (fileName.includes("api") || analysis.headings.some(h => h.toLowerCase().includes("api"))) {
    category = "api";
    tags.add("api");
  } else if (fileName.includes("workflow") || analysis.headings.some(h => h.toLowerCase().includes("workflow"))) {
    category = "workflow";
    tags.add("workflow");
  } else if (fileName.includes("tech") || analysis.headings.some(h => h.toLowerCase().includes("stack"))) {
    category = "technology";
    tags.add("technology");
  }

  // Tag detection based on content analysis
  if (analysis.codeBlocks.length > 0) tags.add("code-examples");
  if (analysis.links.length > 0) tags.add("references");
  if (content.match(/\b(error|exception|debug|troubleshoot)\b/i)) tags.add("error-handling");
  if (content.match(/\b(config|setup|installation)\b/i)) tags.add("configuration");
  if (content.match(/\b(security|auth|authentication|authorization)\b/i)) tags.add("security");

  return { category, tags: Array.from(tags) };
};

// Helper functions for context and metadata management
export const updateMetadata = async (filePath: string, metadata: Partial<DocMetadata>) => {
  const fileName = filePath.split(/[\\/]/).pop() as string;
  state.metadata[fileName] = {
    ...state.metadata[fileName],
    ...metadata,
    lastUpdated: freshTimestamp()
  } as DocMetadata;
};

// Helper function to update search index
export const updateSearchIndex = (docFile: string, content: string, metadata: DocMetadata) => {
  const docId = docFile.replace(".md", "");
  try {
    searchEngine.remove({ id: docId });
  } catch {
    // Document didn't exist in index, which is fine
  }
  searchEngine.add({
    id: docId,
    title: metadata.title,
    content,
    category: metadata.category,
    tags: metadata.tags,
    lastUpdated: metadata.lastUpdated
  });
};

export const findRelatedDocs = async (docFile: string, projectPath: string): Promise<string[]> => {
  const metadata = state.metadata[docFile];
  if (!metadata) return [];

  const related = new Set<string>();

  // Find docs with matching tags
  Object.entries(state.metadata).forEach(([file, meta]) => {
    if (file !== docFile && meta.tags.some(tag => metadata.tags.includes(tag))) {
      related.add(file);
    }
  });

  // Find docs in same category
  Object.entries(state.metadata).forEach(([file, meta]) => {
    if (file !== docFile && meta.category === metadata.category) {
      related.add(file);
    }
  });

  // Find docs referenced in content
  const content = await fs.readFile(`${projectPath}/.handoff_docs/${docFile}`, "utf8");
  const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
  const actualDocs = await getActualDocs(`${projectPath}/.handoff_docs`);
  matches.forEach(match => {
    const linkedDoc = match.slice(2, -2).trim() + ".md";
    if (actualDocs.includes(linkedDoc)) {
      related.add(linkedDoc);
    }
  });

  return Array.from(related);
};

/**
 * Run the full per-doc analysis pipeline: analyze content, categorize,
 * update metadata, and update search index. Returns extracted fields.
 */
export const analyzeAndIndexDoc = async (
  doc: string,
  filePath: string,
  content: string,
  projectPath: string
): Promise<{ category: string; tags: string[]; relatedDocs: string[] }> => {
  const analysis = await analyzeContent(content);
  const { category, tags } = categorizeContent(doc, content, analysis);
  const relatedDocs = await findRelatedDocs(doc, projectPath);
  const metadata: DocMetadata = {
    title: analysis.title || slugToTitle(doc),
    category,
    tags,
    lastUpdated: freshTimestamp(),
    relatedDocs
  };
  await updateMetadata(filePath, metadata);
  updateSearchIndex(doc, content, metadata);
  return { category, tags, relatedDocs };
};

export const searchDocContent = async (projectPath: string, query: string): Promise<SearchResult[]> => {
  // Check cache first
  if (
    state.contextCache.lastQuery === query &&
    state.contextCache.results &&
    state.contextCache.timestamp &&
    Date.now() - state.contextCache.timestamp < CACHE_TTL
  ) {
    return state.contextCache.results;
  }

  const results: SearchResult[] = [];
  const docsPath = `${projectPath}/.handoff_docs`;
  const searchRegex = new RegExp(query, "gi");
  const actualDocs = await getActualDocs(docsPath);

  for (const doc of actualDocs) {
    try {
      const content = await fs.readFile(`${docsPath}/${doc}`, "utf8");
      const lines = content.split("\n");
      const matches = lines
        .map((line, index) => {
          const match = searchRegex.exec(line);
          if (match) {
            return {
              line,
              lineNumber: index + 1,
              highlight: {
                start: match.index,
                end: match.index + match[0].length
              }
            };
          }
          return null;
        })
        .filter((match): match is NonNullable<typeof match> => match !== null);

      if (matches.length > 0) {
        results.push({ file: doc, matches });
      }
    } catch (error) {
      console.error(`Error searching ${doc}:`, error);
    }
  }

  // Update cache
  state.contextCache = {
    lastQuery: query,
    results,
    timestamp: Date.now()
  };

  return results;
};
