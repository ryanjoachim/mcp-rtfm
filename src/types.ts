// ============================================================================
// Shared Type Definitions
// ============================================================================

export interface DocState {
  metadata: Record<string, DocMetadata>;
  contextCache: {
    lastQuery?: string;
    results?: SearchResult[];
    timestamp?: number;
  };
  lastPersistedAt?: string;
  validationResults: Record<string, any>;
  symbolMap: Record<string, string[]>;
}

export interface DocMetadata {
  title: string;
  category: string;
  tags: string[];
  lastUpdated: string;
  relatedDocs: string[];
}

export interface SearchResult {
  file: string;
  matches: Array<{
    line: string;
    lineNumber: number;
    highlight: {
      start: number;
      end: number;
    };
  }>;
}

// Interfaces for refresh_documentation tool
export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  isDocumentation: boolean;
  lastModified?: string;
}

export interface RefreshSuggestion {
  docFile: string;
  section: string;
  currentContent: string;
  suggestedContent: string;
  reason: string;
}

export interface RefreshResult {
  dryRun: boolean;
  timestamp: string;
  sinceLastPersisted: string | null;
  changes: {
    detected: ChangedFile[];
    documentation: ChangedFile[];
    source: ChangedFile[];
  };
  suggestions: RefreshSuggestion[];
  summary: {
    totalFilesChanged: number;
    docsToUpdate: number;
    estimatedWork: 'minimal' | 'moderate' | 'significant';
  };
}

export interface CodeSymbol {
  name: string;
  type: 'function' | 'constant' | 'class' | 'interface' | 'type';
  filePath: string;
  lineNumber?: number;
  signature?: string;
}

export interface ContentGap {
  symbol: CodeSymbol;
  suggestedDoc: string;
  reason: string;
}

export interface ValidationIssue {
  file: string;
  type: 'broken_link' | 'stale_snippet';
  location: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  summary: {
    totalIssues: number;
    errors: number;
    warnings: number;
    checkedDocs: number;
    checkedLinks: number;
    checkedSnippets: number;
  };
}

export interface ProjectSignature {
  frameworks: string[];
  patterns: string[];
  database?: string;
}

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
