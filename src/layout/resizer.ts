/**
 * src/layout/resizer.ts — Drag-to-resize for the three-panel grid layout.
 *
 * Three resizable seams:
 *   1. #divider-vertical       — drags left/right, resizes col 1 (agent-shell width)
 *   2. #divider-horizontal     — drags up/down, resizes file-explorer height inside right-panel
 *   3. #drawer-toggle          — drags up/down, resizes the CLI drawer row height on #app
 */

const MIN_SIDEBAR_PX = 200;
const MAX_SIDEBAR_PX = 700;
const MIN_EXPLORER_PX = 60;
const MIN_EDITOR_PX = 80;
const MIN_DRAWER_PX = 60;
const MAX_DRAWER_PX = 600;

export function initResizers(): void {
  initVerticalResizer();
  initHorizontalResizer();
  initDrawerResizer();
}

// ─── Vertical: agent-shell width ─────────────────────────────────────────────

function initVerticalResizer(): void {
  const divider = document.getElementById('divider-vertical');
  const app = document.getElementById('app') as HTMLElement | null;
  if (!divider || !app) return;

  let startX = 0;
  let startWidth = 0;

  function onMouseMove(e: MouseEvent): void {
    const delta = e.clientX - startX;
    const newWidth = Math.min(MAX_SIDEBAR_PX, Math.max(MIN_SIDEBAR_PX, startWidth + delta));
    app!.style.gridTemplateColumns = `${newWidth}px 1px 1fr`;
  }

  function onMouseUp(): void {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  divider.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    startX = e.clientX;
    // Read current column width from computed style
    const cols = getComputedStyle(app).gridTemplateColumns.split(' ');
    startWidth = parseFloat(cols[0]) || 420;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
}

// ─── Horizontal divider: file-explorer width inside right-panel ──────────────

function initHorizontalResizer(): void {
  const divider = document.getElementById('divider-horizontal');
  const fileExplorerRaw = document.getElementById('file-explorer');
  if (!divider || !fileExplorerRaw) return;
  const fileExplorer = fileExplorerRaw as HTMLElement;

  let startX = 0;
  let startWidth = 0;

  function onMouseMove(e: MouseEvent): void {
    const delta = e.clientX - startX;
    const rightPanel = fileExplorer.parentElement;
    if (!rightPanel) return;
    const panelWidth = rightPanel.clientWidth;
    const newWidth = Math.min(
      panelWidth - MIN_EDITOR_PX,
      Math.max(MIN_EXPLORER_PX, startWidth + delta),
    );
    fileExplorer.style.width = `${newWidth}px`;
    fileExplorer.style.flexShrink = '0';
  }

  function onMouseUp(): void {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  divider.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = fileExplorer.getBoundingClientRect().width;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
}

// ─── Drawer: CLI drawer row height on #app grid ───────────────────────────────

function initDrawerResizer(): void {
  const toggle = document.getElementById('drawer-toggle') ?? document.getElementById('divider-bottom');
  const appRaw = document.getElementById('app');
  if (!toggle || !appRaw) return;
  const app = appRaw as HTMLElement;

  let startY = 0;
  let startDrawerHeight = 0;
  let isDragging = false;
  let dragMoved = false;

  function onMouseMove(e: MouseEvent): void {
    const delta = startY - e.clientY; // drag up = bigger drawer
    if (Math.abs(delta) > 3) dragMoved = true;
    if (!dragMoved) return;
    isDragging = true;

    // Remove collapsed state while dragging so the grid track is active
    app.classList.remove('drawer-collapsed');

    const newHeight = Math.min(MAX_DRAWER_PX, Math.max(MIN_DRAWER_PX, startDrawerHeight + delta));
    // Rows: top-bar | main | divider | drawer | bottom-status-bar
    app.style.gridTemplateRows = `auto 1fr 1px ${newHeight}px auto`;
  }

  function onMouseUp(): void {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (!dragMoved) {
      // Pure click — toggle collapse (original behaviour)
      app.classList.toggle('drawer-collapsed');
    }

    isDragging = false;
    dragMoved = false;
  }

  toggle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    startY = e.clientY;
    dragMoved = false;
    isDragging = false;

    // Read current drawer height from computed style (1fr resolves to px at
    // runtime). The drawer is the 4th of 5 rows: top-bar, main, divider,
    // drawer, bottom-status-bar.
    const computedRows = getComputedStyle(app).gridTemplateRows.split(' ');
    startDrawerHeight = parseFloat(computedRows[3] ?? '') || 220;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  // Prevent the DrawerToggle click listener from also firing after a drag
  toggle.addEventListener('click', (e: MouseEvent) => {
    if (isDragging || dragMoved) e.stopImmediatePropagation();
  });
}
