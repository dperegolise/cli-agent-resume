/**
 * src/layout/responsive.ts — Mobile breakpoint logic
 * Manages hamburger menu, mobile sidebar, backdrop, and drawer collapse.
 *
 * MobileLayout handles viewports ≤ 767.98px:
 *   - Shows hamburger button
 *   - Slides in file explorer as an overlay sidebar
 *   - Shows/hides backdrop
 *   - Resets styles when viewport returns to > 767.98px
 *
 * DrawerToggle handles the collapsible #cli-drawer:
 *   - Click on #drawer-toggle / #divider-bottom toggles .collapsed
 *   - Ctrl+` keyboard shortcut also toggles
 */

/** Mobile breakpoint in pixels (matches CSS @media query). Use fractional value
 *  to avoid integer-rounding ambiguity on high-DPI screens. */
const MOBILE_BREAKPOINT_PX = '767.98px';

/**
 * MobileLayout manages the responsive hamburger + sidebar behaviour.
 * It operates on named IDs so there is no tight coupling to constructor args.
 *
 * IDs consumed:
 *   #hamburger-btn  (or #hamburger-menu — accepts whichever exists)
 *   #mobile-explorer-sidebar  (or #mobile-sidebar — accepts whichever exists)
 *   #mobile-backdrop
 *   #file-explorer (delegated item click)
 */
export class MobileLayout {
  private mq: MediaQueryList;
  private sidebarEl: HTMLElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private hamburgerEl: HTMLElement | null = null;
  private _open = false;

  constructor() {
    this.mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX})`);
  }

  /**
   * Initialise the mobile layout.
   * Safe to call before or after DOM ready — elements are looked up lazily.
   */
  init(_mainLayout?: HTMLElement): void {
    // Resolve elements (support both naming variants)
    this.hamburgerEl =
      document.getElementById('hamburger-btn') ??
      document.getElementById('hamburger-menu');

    this.sidebarEl =
      document.getElementById('mobile-explorer-sidebar') ??
      document.getElementById('mobile-sidebar');

    this.backdropEl = document.getElementById('mobile-backdrop');

    // Wire hamburger click
    this.hamburgerEl?.addEventListener('click', () => this.open());

    // Wire backdrop click → close
    this.backdropEl?.addEventListener('click', () => this.close());

    // Delegate file-item clicks inside sidebar → close
    this.sidebarEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.file-item, .nerd-tree-item, a, [data-path]')) {
        this.close();
      }
    });

    // MediaQueryList change listener
    this.mq.addEventListener('change', (e) => {
      if (!e.matches) {
        // Viewport grew > 767.98px — reset mobile state
        this.close();
      }
    });
  }

  /** Open the mobile file explorer sidebar. */
  open(): void {
    this._open = true;

    this.sidebarEl?.classList.add('open', 'sidebar-open');

    if (this.backdropEl) {
      this.backdropEl.style.display = 'block';
      this.backdropEl.classList.add('visible');
    }
  }

  /** Close the mobile file explorer sidebar. */
  close(): void {
    this._open = false;

    this.sidebarEl?.classList.remove('open', 'sidebar-open');

    if (this.backdropEl) {
      this.backdropEl.style.display = 'none';
      this.backdropEl.classList.remove('visible');
    }
  }

  /** Toggle open/close. */
  toggleSidebar(): void {
    if (this._open) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Returns true when the viewport is currently in mobile mode. */
  isMobile(): boolean {
    return this.mq.matches;
  }
}

/**
 * DrawerToggle manages the collapsible #cli-drawer.
 *
 * The drawer lives in row 3 of #app's CSS grid. Setting height:0 on the drawer
 * element alone leaves the 220px grid track as a ghost gap. We therefore toggle
 * .drawer-collapsed on #app, which collapses the grid track itself via CSS
 * (grid-template-rows: 1fr 0 0). The drawer height follows automatically.
 *
 * - Clicking #drawer-toggle (or #divider-bottom) toggles collapse
 * - Ctrl+` (backtick) keyboard shortcut does the same (not fired in editable fields)
 */

/** Module-level reference to the current keydown handler. Enables HMR-safe
 *  re-initialisation: the old listener is removed before the new one is added. */
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

export class DrawerToggle {
  private appEl: HTMLElement | null = null;

  /**
   * Initialise the drawer toggle.
   * Attaches click listener to #drawer-toggle (falls back to #divider-bottom)
   * and a global keydown listener for Ctrl+`.
   *
   * Safe to call multiple times (e.g. on Vite HMR): the previous keydown
   * listener is removed before a new one is registered, preventing accumulation.
   */
  init(): void {
    this.appEl = document.getElementById('app');

    const toggleBar =
      document.getElementById('drawer-toggle') ??
      document.getElementById('divider-bottom');

    toggleBar?.addEventListener('click', () => this.toggle());

    // HMR guard: remove any previously-registered keydown handler first
    if (_keydownHandler) {
      document.removeEventListener('keydown', _keydownHandler);
    }

    // Ctrl+` keyboard shortcut — skip when the user is typing in an editable field
    _keydownHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        const tag = (e.target as HTMLElement).tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          (e.target as HTMLElement).isContentEditable;
        if (isEditable) return;
        e.preventDefault();
        this.toggle();
      }
    };
    document.addEventListener('keydown', _keydownHandler);
  }

  /**
   * Toggle the collapsed state of the drawer.
   * Toggles .drawer-collapsed on #app so the CSS grid track collapses,
   * eliminating the ghost gap that height:0 on the drawer alone would leave.
   */
  toggle(): void {
    this.appEl?.classList.toggle('drawer-collapsed');
  }

  /** Collapse the drawer (removes ghost gap via grid track). */
  collapse(): void {
    this.appEl?.classList.add('drawer-collapsed');
  }

  /** Expand the drawer (restores 220px grid track). */
  expand(): void {
    this.appEl?.classList.remove('drawer-collapsed');
  }

  /** Returns true when the drawer is currently collapsed. */
  isCollapsed(): boolean {
    return this.appEl?.classList.contains('drawer-collapsed') ?? false;
  }
}

/**
 * Convenience: create and initialise both MobileLayout and DrawerToggle.
 * Returns the instances so callers can interact with them programmatically.
 */
export function initLayout(): { mobile: MobileLayout; drawer: DrawerToggle } {
  const mobile = new MobileLayout();
  const drawer = new DrawerToggle();
  mobile.init();
  drawer.init();
  return { mobile, drawer };
}
