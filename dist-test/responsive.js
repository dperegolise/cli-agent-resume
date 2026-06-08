/**
 * src/layout/responsive.ts — Mobile breakpoint logic
 * Manages hamburger menu, mobile sidebar, backdrop, and drawer collapse.
 *
 * MobileLayout handles viewports < 768px:
 *   - Shows hamburger button
 *   - Slides in file explorer as an overlay sidebar
 *   - Shows/hides backdrop
 *   - Resets styles when viewport returns to ≥ 768px
 *
 * DrawerToggle handles the collapsible #cli-drawer:
 *   - Click on #drawer-toggle / #divider-bottom toggles .collapsed
 *   - Ctrl+` keyboard shortcut also toggles
 */
/** Mobile breakpoint in pixels (matches CSS @media query). */
const MOBILE_BREAKPOINT = 768;
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
    mq;
    sidebarEl = null;
    backdropEl = null;
    hamburgerEl = null;
    _open = false;
    constructor() {
        this.mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    }
    /**
     * Initialise the mobile layout.
     * Safe to call before or after DOM ready — elements are looked up lazily.
     */
    init(_mainLayout) {
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
            const target = e.target;
            if (target.closest('.file-item, .nerd-tree-item, a, [data-path]')) {
                this.close();
            }
        });
        // MediaQueryList change listener
        this.mq.addEventListener('change', (e) => {
            if (!e.matches) {
                // Viewport grew ≥ 768px — reset mobile state
                this.close();
            }
        });
    }
    /** Open the mobile file explorer sidebar. */
    open() {
        this._open = true;
        this.sidebarEl?.classList.add('open', 'sidebar-open');
        if (this.backdropEl) {
            this.backdropEl.style.display = 'block';
            this.backdropEl.classList.add('visible');
        }
    }
    /** Close the mobile file explorer sidebar. */
    close() {
        this._open = false;
        this.sidebarEl?.classList.remove('open', 'sidebar-open');
        if (this.backdropEl) {
            this.backdropEl.style.display = 'none';
            this.backdropEl.classList.remove('visible');
        }
    }
    /** Toggle open/close. */
    toggleSidebar() {
        if (this._open) {
            this.close();
        }
        else {
            this.open();
        }
    }
    /** Returns true when the viewport is currently in mobile mode. */
    isMobile() {
        return this.mq.matches;
    }
}
/**
 * DrawerToggle manages the collapsible #cli-drawer.
 *
 * - Clicking #drawer-toggle (or #divider-bottom) toggles .collapsed on #cli-drawer
 * - Ctrl+` (backtick) keyboard shortcut does the same
 */
export class DrawerToggle {
    drawerEl = null;
    /**
     * Initialise the drawer toggle.
     * Attaches click listener to #drawer-toggle (falls back to #divider-bottom)
     * and a global keydown listener for Ctrl+`.
     */
    init() {
        this.drawerEl = document.getElementById('cli-drawer');
        const toggleBar = document.getElementById('drawer-toggle') ??
            document.getElementById('divider-bottom');
        toggleBar?.addEventListener('click', () => this.toggle());
        // Ctrl+` keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === '`') {
                e.preventDefault();
                this.toggle();
            }
        });
    }
    /** Toggle the collapsed state of the drawer. */
    toggle() {
        this.drawerEl?.classList.toggle('collapsed');
    }
    /** Collapse the drawer. */
    collapse() {
        this.drawerEl?.classList.add('collapsed');
    }
    /** Expand the drawer. */
    expand() {
        this.drawerEl?.classList.remove('collapsed');
    }
    /** Returns true when the drawer is currently collapsed. */
    isCollapsed() {
        return this.drawerEl?.classList.contains('collapsed') ?? false;
    }
}
/**
 * Convenience: create and initialise both MobileLayout and DrawerToggle.
 * Returns the instances so callers can interact with them programmatically.
 */
export function initLayout() {
    const mobile = new MobileLayout();
    const drawer = new DrawerToggle();
    mobile.init();
    drawer.init();
    return { mobile, drawer };
}
