/**
 * src/manifest.ts — Manifest loading and validation
 * Loads /assets/manifest.json at runtime, validates entries, exports typed manifest.
 */

import type { Manifest, ManifestEntry } from './types.js';

// ─── Module state ─────────────────────────────────────────────────────────────

let cachedManifest: Manifest | null = null;
const entryIndex: Map<string, ManifestEntry> = new Map();

// ─── Path validation ──────────────────────────────────────────────────────────

/** Valid path pattern: lowercase alphanumeric, slashes, dashes, underscores, .md extension */
const VALID_PATH_RE = /^[a-z0-9/_-]+\.md$/;

function isValidPathFormat(p: string): boolean {
  return VALID_PATH_RE.test(p);
}

function validateEntry(entry: unknown): entry is ManifestEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e['path'] === 'string' &&
    typeof e['title'] === 'string' &&
    Array.isArray(e['sections']) &&
    (e['sections'] as unknown[]).every((s) => typeof s === 'string') &&
    typeof e['excerpt'] === 'string' &&
    typeof e['hash'] === 'string'
  );
}

function validateManifest(data: unknown): data is Manifest {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  return (
    Array.isArray(m['entries']) &&
    (m['entries'] as unknown[]).every(validateEntry) &&
    typeof m['version'] === 'string'
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch and validate /assets/manifest.json.
 * Caches the result; subsequent calls return the cached manifest.
 */
export async function loadManifest(): Promise<Manifest> {
  if (cachedManifest) return cachedManifest;

  const resp = await fetch('/assets/manifest.json');
  if (!resp.ok) {
    throw new Error(`Failed to load manifest: ${resp.status} ${resp.statusText}`);
  }

  const data: unknown = await resp.json();
  if (!validateManifest(data)) {
    throw new Error('Manifest validation failed: unexpected shape');
  }

  cachedManifest = data;

  // Build index for O(1) path lookups
  entryIndex.clear();
  for (const entry of cachedManifest.entries) {
    entryIndex.set(entry.path, entry);
  }

  return cachedManifest;
}

/**
 * Look up a manifest entry by path.
 * Returns null if not found or manifest not yet loaded.
 */
export function getManifestEntry(path: string): ManifestEntry | null {
  return entryIndex.get(path) ?? null;
}

/**
 * Return all valid file paths from the manifest.
 */
export function getAllPaths(): string[] {
  return Array.from(entryIndex.keys());
}

/**
 * Validate that a path exists in the manifest and has a valid format.
 * Security check: paths must be in the manifest before the backend emits focus_item events.
 */
export function validatePath(p: string): boolean {
  return isValidPathFormat(p) && entryIndex.has(p);
}
