// ============================================================================
// Template Management
// ============================================================================

import * as fs from "fs/promises";
import { state } from "./state.js";
import type { DocTemplate } from "./types.js";

// Base set of docs created by default; actual doc list is derived from the filesystem
export const BASE_DOCS = [
  "techStack.md",
  "codebaseDetails.md",
  "workflowDetails.md",
  "integrationGuides.md",
  "errorHandling.md",
  "handoff_notes.md"
];

export const TEMPLATES: Record<string, DocTemplate> = {
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
      tags: ["guide", "reference"]
    }
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
      tags: ["api", "reference", "integration"]
    }
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
      tags: ["process", "guide"]
    }
  }
};

export const TEMPLATE_CONTENT = `# {title}

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
`;

// Template override lookup - checks custom overrides before default
export const getTemplateForFile = (fileName: string): string => {
  const override = state.templateOverrides[fileName];
  if (override) return override.content;
  return TEMPLATE_CONTENT;
};

// Returns the actual docs in the project (BASE_DOCS + any custom ones added to the filesystem)
export const getActualDocs = async (docsPath: string): Promise<string[]> => {
  try {
    const files = await fs.readdir(docsPath);
    return files.filter(f => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
};
