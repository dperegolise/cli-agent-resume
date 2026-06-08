/**
 * src/drawer/history.ts — Command history for CLI drawer
 * Stores the last 50 commands; supports Up/Down arrow navigation.
 */

const MAX_HISTORY = 50;

/** Module-level history array (persists across prompt invocations). */
const history: string[] = [];

/** Current cursor position in history (-1 = not browsing; otherwise 0..history.length-1). */
let cursor = -1;

/** Saved partial input while browsing (restored when user returns to end). */
let savedInput = '';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push a command into the history.
 * Ignores blank lines and consecutive duplicate entries.
 */
export function pushHistory(cmd: string): void {
  const trimmed = cmd.trim();
  if (!trimmed) return;
  if (history[history.length - 1] === trimmed) return; // deduplicate consecutive

  history.push(trimmed);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  // Reset cursor whenever a new command is submitted
  cursor = -1;
  savedInput = '';
}

/**
 * Begin a new browsing session with the given partial input.
 * Call this before the first Up/Down key in a new input.
 */
export function resetCursor(partial: string): void {
  cursor = -1;
  savedInput = partial;
}

/**
 * Move backward (Up) in history.
 * Returns the command string to display, or null if already at the oldest entry.
 */
export function historyUp(currentInput: string): string | null {
  if (history.length === 0) return null;

  if (cursor === -1) {
    // First Up press — save whatever is currently typed
    savedInput = currentInput;
    cursor = history.length - 1;
  } else if (cursor > 0) {
    cursor -= 1;
  } else {
    // Already at the oldest entry; don't move
    return null;
  }

  return history[cursor] ?? null;
}

/**
 * Move forward (Down) in history.
 * Returns the next command string, or null when past the end (restore partial input).
 */
export function historyDown(): string | null {
  if (cursor === -1) return null; // Not browsing

  if (cursor < history.length - 1) {
    cursor += 1;
    return history[cursor] ?? null;
  }

  // Moved past the end — restore partial input
  cursor = -1;
  return savedInput;
}

/**
 * Return the saved partial input (what the user was typing before browsing).
 */
export function getSavedInput(): string {
  return savedInput;
}

/**
 * Return a snapshot of the current history (newest last).
 */
export function getHistory(): readonly string[] {
  return history;
}

/**
 * Clear all history (useful for testing / reset).
 */
export function clearHistory(): void {
  history.length = 0;
  cursor = -1;
  savedInput = '';
}
