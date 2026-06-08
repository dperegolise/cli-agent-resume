/**
 * src/editor/fileLoader.ts — Markdown file loading
 * Fetches markdown files from the built assets, validating against the manifest first.
 */

import { getManifestEntry, loadManifest } from '../manifest.js';

// ─── Cache ────────────────────────────────────────────────────────────────────

const contentCache: Map<string, string> = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a markdown file by its manifest path.
 *
 * 1. Ensures the manifest is loaded.
 * 2. Validates the path is in the manifest (security check).
 * 3. Fetches `/assets/www/{path}` (Vite build output) with a `/www/{path}` dev fallback.
 * 4. Returns the raw markdown text.
 *
 * Throws if the path is invalid or the fetch fails.
 */
export async function loadFile(path: string): Promise<string> {
  // Ensure manifest is loaded for validation
  await loadManifest();

  const entry = getManifestEntry(path);
  if (!entry) {
    throw new Error(`loadFile: path not found in manifest: "${path}"`);
  }

  // Return cached copy if available
  if (contentCache.has(path)) {
    return contentCache.get(path)!;
  }

  const content = await fetchMarkdown(path);
  contentCache.set(path, content);
  return content;
}

/**
 * Return the default landing file content (www/index.md).
 * Fetches directly without manifest validation (index.md is always present).
 */
export async function getDefaultFile(): Promise<string> {
  // Try the manifest path first
  try {
    return await loadFile('index.md');
  } catch {
    // Fallback: direct fetch without manifest check
    return await fetchMarkdown('index.md');
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function fetchMarkdown(path: string): Promise<string> {
  // In production (Vite build), markdown files are emitted under dist/www/
  // and served at /assets/www/{path} (see vite.config.ts emitFile path).
  // However the vite config emits them to dist/www/{path} (not dist/assets/www).
  // So try /www/{path} first (works for both dev server and production nginx),
  // then /assets/www/{path} as a fallback.
  const candidates = [
    `/www/${path}`,
    `/assets/www/${path}`,
  ];

  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        return await resp.text();
      }
      lastErr = new Error(`HTTP ${resp.status} from ${url}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr ?? new Error(`Failed to fetch markdown file: "${path}"`);
}
