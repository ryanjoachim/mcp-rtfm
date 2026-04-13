// ============================================================================
// Zod Schemas for Tool Input Validation
// ============================================================================

import { z } from "zod";

export const AnalyzeProjectSchema = z.object({
  projectPath: z.string().min(1),
  options: z.object({
    mode: z.enum(["init", "analyze", "reset"]).optional(),
    initDocs: z.boolean().optional(),
  }).optional(),
});

export const ReadDocSchema = z.object({
  projectPath: z.string().min(1),
  docFile: z.string().min(1),
});

export const UpdateDocSchema = z.object({
  projectPath: z.string().min(1),
  docFile: z.string().min(1),
  searchContent: z.string().optional(),
  replaceContent: z.string().optional(),
  content: z.string().optional(),
}).refine(
  (data) => data.content !== undefined || (data.searchContent !== undefined && data.replaceContent !== undefined),
  { message: "Must provide either 'content' for full replacement, or both 'searchContent' and 'replaceContent' for diff-based update" }
);

export const GetProjectInfoSchema = z.object({
  projectPath: z.string().min(1),
});

export const SearchDocsSchema = z.object({
  projectPath: z.string().min(1),
  query: z.string().min(1),
});

export const GetRelatedDocsSchema = z.object({
  projectPath: z.string().min(1),
  docFile: z.string().min(1),
});

export const RefreshDocumentationSchema = z.object({
  projectPath: z.string().min(1),
  options: z.object({
    mode: z.enum(["sync", "analyze"]).optional(),
    dryRun: z.boolean().optional(),
    includeStats: z.boolean().optional(),
    targetDocs: z.array(z.string()).optional(),
    docFile: z.string().optional(),
    metadata: z.object({
      title: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

export const AnalyzeContentGapsSchema = z.object({
  projectPath: z.string().min(1),
  targetFiles: z.array(z.string()).optional(),
});

export const ValidateDocumentationSchema = z.object({
  projectPath: z.string().min(1),
});