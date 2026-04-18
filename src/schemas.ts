// ============================================================================
// Zod Schemas for Tool Input Validation
// ============================================================================

import { z } from "zod";

const PATH_MAX = 4096;
const DOC_FILE_MAX = 255;
const QUERY_MAX = 1000;
const CONTENT_MAX = 1_000_000;
const TAG_MAX = 256;

export const AnalyzeProjectSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  options: z.object({
    mode: z.enum(["init", "analyze", "reset"]).optional(),
    initDocs: z.boolean().optional(),
  }).optional(),
});

export const ReadDocSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  docFile: z.string().min(1).max(DOC_FILE_MAX),
});

export const UpdateDocSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  docFile: z.string().min(1).max(DOC_FILE_MAX),
  searchContent: z.string().max(CONTENT_MAX).optional(),
  replaceContent: z.string().max(CONTENT_MAX).optional(),
  content: z.string().max(CONTENT_MAX).optional(),
}).refine(
  (data) => data.content !== undefined || (data.searchContent !== undefined && data.replaceContent !== undefined),
  { message: "Must provide either 'content' for full replacement, or both 'searchContent' and 'replaceContent' for diff-based update" }
);

export const GetProjectInfoSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
});

export const SearchDocsSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  query: z.string().min(1).max(QUERY_MAX),
});

export const GetRelatedDocsSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  docFile: z.string().min(1).max(DOC_FILE_MAX),
});

export const RefreshDocumentationSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  options: z.object({
    mode: z.enum(["sync", "analyze"]).optional(),
    dryRun: z.boolean().optional(),
    includeStats: z.boolean().optional(),
    targetDocs: z.array(z.string().min(1).max(DOC_FILE_MAX)).max(100).optional(),
    docFile: z.string().min(1).max(DOC_FILE_MAX).optional(),
    metadata: z.object({
      title: z.string().max(DOC_FILE_MAX).optional(),
      category: z.string().max(DOC_FILE_MAX).optional(),
      tags: z.array(z.string().max(TAG_MAX)).max(50).optional(),
    }).optional(),
  }).optional(),
});

export const AnalyzeContentGapsSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
  targetFiles: z.array(
    z.string().min(1).max(512).refine(
      p => !p.includes("..") && !p.includes("\0") && !p.startsWith("/") && !/^[A-Za-z]:/.test(p),
      { message: "targetFiles entries must not contain traversal sequences, null bytes, or absolute paths" }
    )
  ).max(100).optional(),
});

export const ValidateDocumentationSchema = z.object({
  projectPath: z.string().min(1).max(PATH_MAX),
});