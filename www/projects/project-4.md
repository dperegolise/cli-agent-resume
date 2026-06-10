# scraper-mcp

An MCP server that gives Claude (or any MCP client) real web-scraping capability: stealth
HTTP, headless-browser rendering, CSS/XPath extraction, link discovery, site crawling, and
screenshots, exposed as nine typed tools.

**GitHub**: https://github.com/dperegolise/scraper-mcp

---

## What it is

A thin, deliberate MCP wrapper around [Scrapling](https://github.com/D4Vinci/Scrapling)
with stealth HTTP and headless-browser (Playwright/Patchright) backends:

- **Fetching**: `fetch_page` (stealth text extraction), `fetch_page_html` (full DOM),
  `fetch_api` (stealth HTTP client for JSON APIs: GET/POST/PUT/DELETE).
- **Extraction**: `select_elements` (CSS/XPath on a fetched page), `search_page` (find
  elements by text or regex when you don't know the DOM), `extract_links` (all hyperlinks
  with resolved absolute URLs).
- **Multi-page**: `crawl_site` walks internal links and returns `[{url, content}]` for
  documentation ingestion.
- **Visual**: `screenshot_page` returns a headless-browser screenshot for layout checks.

Every fetching tool takes `use_browser=True` for JavaScript-heavy or bot-protected pages.
It runs as a streamable-HTTP MCP server and registers with Claude Code in one command.

---

## Why I built it

Claude's built-in WebFetch gets blocked by bot detection, summarizes content through a
model (lossy), and can't do POSTs. For agent workflows that need *raw* data (scraping a
catalog, hitting an undocumented JSON API, auditing a site's actual rendered DOM) the
agent needs a real scraping stack. Scrapling's TLS-fingerprint evasion plus Patchright's
stealth browser covers nearly everything a polite scraper legitimately needs, and exposing
it over MCP means every agent on the machine shares one battle-tested implementation.

The tool descriptions are written *for the model*: each one says when to use it instead of
WebFetch, which measurably changes agent tool-selection behavior.

---

## Technical decisions worth noting

**Tool design is prompt design**: nine narrow tools with crisp "use this when" guidance
beat one mega-tool with a mode parameter. The agent picks correctly almost every time.

**Raw output, no summarization**: `fetch_api` returns the unprocessed response body.
Anything model-summarized upstream is unusable for structured extraction downstream.

**Streamable-HTTP transport**: one long-running server, many clients, local-only binding.

---

## Stack

Python, Scrapling, Playwright/Patchright, MCP (streamable-HTTP transport)
