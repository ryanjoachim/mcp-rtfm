import { expect } from "@playwright/test";

interface McpContentItem {
  type: string;
  text: string;
}

interface McpResponse {
  isError?: boolean;
  content: McpContentItem[];
}

export function parseTextContent(response: McpResponse): any {
  const text = response.content[0]?.text;
  if (!text) throw new Error("No text content in response");
  try {
    return JSON.parse(text);
  } catch {
    // read_doc returns raw markdown, not JSON
    return text;
  }
}

export function expectSuccess(response: McpResponse): any {
  expect(response.isError).toBeFalsy();
  expect(response.content[0]?.type).toBe("text");
  return parseTextContent(response);
}

export function expectError(response: McpResponse, substring?: string): any {
  expect(response.isError).toBe(true);
  const parsed = parseTextContent(response);
  expect(parsed.error).toBe(true);
  if (substring) {
    expect(parsed.message).toContain(substring);
  }
  return parsed;
}

export async function expectMcpError(fn: () => Promise<any>, substring?: string): Promise<void> {
  await expect(fn).rejects.toThrow();
  // If we need to check the message, we need to catch and inspect
  if (substring) {
    try {
      await fn();
    } catch (error: any) {
      expect(error.message).toContain(substring);
      return;
    }
    throw new Error("Expected function to throw but it did not");
  }
}