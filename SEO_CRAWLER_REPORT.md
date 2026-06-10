# Crawler & Indexing Report — cli-agent-resume

_Reviewed: 2026-06-10_

---

## Executive summary

This site is a single-page application (SPA) that renders entirely in JavaScript.
From a crawler's perspective the served HTML is almost empty — every panel
(agent terminal, file explorer, editor) is a JS-mounted widget with no
server-rendered text. GoogleBot, Bing, and any tool that reads raw HTML will
see essentially a blank shell with one `<title>` tag and a handful of empty
`<div>` containers. The content that matters — nine rich Markdown files covering
experience, projects, philosophy, and contact — exists as static assets at
`/dist/www/*.md` but is never linked from the HTML and is invisible to crawlers.

There is no `robots.txt`, no `sitemap.xml`, no structured data, no canonical
URL, and no Open Graph metadata. The site also has no `<meta description>`.

---

## What a crawler sees today

```
GET / → dist/index.html
```

Visible text in HTML source:
- `<title>Daniel Peregolise — Developer Portfolio</title>`
- Inline `<span>` text: `www — daniel peregolise`, `portfolio.dev`, `master ✓`, `utf-8 · 100%`
- ARIA labels: `Toggle CLI drawer`, `Toggle file explorer`
- Comments pointing at JS mount points (`<!-- xterm.js AgentTerminal mounts here -->`)

**All actual content** (bio, job titles, skills, project descriptions, education,
contact info) is loaded at runtime from `/assets/manifest.json` and
`/www/*.md` by JavaScript — none of it is in the HTML the crawler fetches.

The `nginx.conf` uses `try_files $uri $uri/ /index.html` as an SPA fallback, so
every path returns the same empty shell with a 200. A crawler hitting
`/experience/role-1` gets the same blank HTML as `/`, with no content at all.

---

## Issues by priority

### P1 — Critical: no indexable content

| Issue | Detail |
|---|---|
| SPA with no SSR / SSG | Crawlers that don't execute JS (most) see zero content |
| No `<meta name="description">` | Search snippets will be empty or auto-generated garbage |
| Content only reachable via JS fetch | `/assets/manifest.json` and `/www/*.md` are never linked |
| All routes return the same HTML | `/experience`, `/projects`, etc. serve the same empty shell |

### P2 — High: missing standard crawler signals

| Issue | Detail |
|---|---|
| No `robots.txt` | Crawlers have no guidance on what to index or skip |
| No `sitemap.xml` | No machine-readable list of pages or their last-modified dates |
| No canonical `<link>` | Risk of duplicate indexing if the domain is ever accessed via multiple URLs |
| No Open Graph / Twitter Card tags | Link previews (Slack, LinkedIn, Twitter) show nothing useful |

### P3 — Medium: structured data and signals

| Issue | Detail |
|---|---|
| No JSON-LD structured data | `Person`, `WebSite`, `ItemList` schemas would enable rich results |
| No `<meta name="author">` | |
| No `<link rel="alternate">` for Markdown sources | Raw content is accessible but not declared |
| `index.html` served with `no-cache` but no `Last-Modified` or `ETag` signals | |

---

## Recommendations

### 1. Add a `<noscript>` fallback with full content (low effort, high impact)

The fastest win without changing the architecture. Add a `<noscript>` block
directly in `index.html` that renders the key content as plain HTML:

```html
<noscript>
  <main>
    <h1>Daniel Peregolise</h1>
    <p>Senior Software Engineer — distributed systems, developer tooling, platform infrastructure.</p>
    <nav>
      <ul>
        <li><a href="/www/about.md">About</a></li>
        <li><a href="/www/experience/index.md">Experience</a></li>
        <li><a href="/www/projects/index.md">Projects</a></li>
        <li><a href="/www/contact.md">Contact</a></li>
      </ul>
    </nav>
    <!-- paste key content from each www/*.md here -->
  </main>
</noscript>
```

This is also a good accessibility fallback for screen readers and terminal
browsers (curl, Lynx).

### 2. Add a `<meta name="description">` tag

```html
<meta name="description"
  content="Daniel Peregolise — Senior Software Engineer. Distributed systems, developer tooling, and AI/LLM infrastructure. A decade across platform engineering and inference systems." />
```

### 3. Add Open Graph and Twitter Card tags

Paste this block into `<head>` in `index.html`:

```html
<meta property="og:type"        content="website" />
<meta property="og:title"       content="Daniel Peregolise — Developer Portfolio" />
<meta property="og:description" content="Senior Software Engineer. Distributed systems, developer tooling, AI/LLM infrastructure." />
<meta property="og:url"         content="https://YOUR_DOMAIN/" />
<meta property="og:image"       content="https://YOUR_DOMAIN/og-image.png" />

<meta name="twitter:card"        content="summary" />
<meta name="twitter:title"       content="Daniel Peregolise — Developer Portfolio" />
<meta name="twitter:description" content="Senior Software Engineer. Distributed systems, developer tooling, AI/LLM infrastructure." />
```

A simple 1200×630 OG image (dark terminal screenshot) is sufficient.

### 4. Add `robots.txt`

Create `public/robots.txt` (Vite copies `public/` to dist root automatically):

```
User-agent: *
Allow: /

Sitemap: https://YOUR_DOMAIN/sitemap.xml
```

Optionally disallow the raw asset paths you don't want indexed:

```
Disallow: /assets/
```

### 5. Add `sitemap.xml`

The Vite build already knows every content page (from `vite.config.ts`'s
`scanDir`). Add a second emitter alongside `generate-manifest` in
`vite.config.ts` that writes `sitemap.xml` at build time:

```ts
// In generateManifestPlugin(), after emitting manifest.json:
const sitemapEntries = entries.map(e => {
  const urlPath = e.path.replace(/index\.md$/, '').replace(/\.md$/, '');
  return `  <url><loc>https://YOUR_DOMAIN/${urlPath}</loc></url>`;
});

this.emitFile({
  type: 'asset',
  fileName: 'sitemap.xml',
  source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://YOUR_DOMAIN/</loc></url>
${sitemapEntries.join('\n')}
</urlset>`,
});
```

### 6. Add JSON-LD structured data

Paste into `<head>` in `index.html`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Daniel Peregolise",
  "jobTitle": "Senior Software Engineer",
  "description": "Distributed systems, developer tooling, and AI/LLM infrastructure.",
  "url": "https://YOUR_DOMAIN/",
  "email": "danielperegolise@gmail.com",
  "sameAs": [
    "https://github.com/danielperegolise",
    "https://linkedin.com/in/danielperegolise"
  ]
}
</script>
```

### 7. Serve the Markdown files with navigable URLs (medium effort)

The `.md` files are already deployed at `/www/about.md` etc. The nginx config
could expose them at clean paths with proper content-type headers. This lets a
crawler visit `/about`, `/experience`, `/projects/cli-portfolio` etc. and get
actual text content without JS.

Option A — nginx rewrites to the `.md` files (text/plain, quick):
```nginx
location = /about     { rewrite ^ /www/about.md last; }
location = /contact   { rewrite ^ /www/contact.md last; }
location /experience/ { rewrite ^/experience/(.*)$ /www/experience/$1.md last; }
location /projects/   { rewrite ^/projects/(.*)$   /www/projects/$1.md last; }
```

Option B — generate standalone HTML pages per `.md` at build time (SSG).
This is the most crawler-friendly solution and would let Google index distinct
URLs with distinct titles and content. It requires a small build step (e.g.,
a `marked` / `unified` pass over each `.md` producing a minimal HTML file with
the full `<head>` metadata). Each page would share the same shell CSS but have
readable `<body>` content.

### 8. Add `<link rel="canonical">` to prevent duplicate indexing

```html
<link rel="canonical" href="https://YOUR_DOMAIN/" />
```

---

## Summary table

| Recommendation | Effort | Impact |
|---|---|---|
| `<noscript>` content block | Low | High |
| `<meta description>` | Trivial | High |
| Open Graph / Twitter Card tags | Trivial | High |
| `robots.txt` | Trivial | Medium |
| `sitemap.xml` (build-time emit) | Low | High |
| JSON-LD `Person` schema | Low | Medium |
| nginx rewrites to `.md` files | Low | Medium |
| Static HTML per page (SSG) | Medium | Highest |

The top four rows are all `index.html` edits that take under an hour combined
and recover the most search visibility. The sitemap emitter is a small addition
to the existing Vite plugin. The SSG option is the gold standard but also the
most work.
