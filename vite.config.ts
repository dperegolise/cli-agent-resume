import { defineConfig, Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface ManifestEntry {
  path: string;
  title: string;
  sections: string[];
  excerpt: string;
  hash: string;
}

interface Manifest {
  entries: ManifestEntry[];
  buildDate: string;
  version: string;
}

function extractTitle(content: string): string | null {
  // Try to extract from YAML frontmatter
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
    if (titleMatch) return titleMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  // Try first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return null;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function generateManifestPlugin(): Plugin {
  return {
    name: 'generate-manifest',
    apply: 'build',
    generateBundle() {
      const wwwDir = 'www';
      const entries: ManifestEntry[] = [];

      function scanDir(dir: string, sections: string[] = []) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(dir, file.name);
          if (file.isDirectory()) {
            scanDir(fullPath, [...sections, file.name]);
          } else if (file.name.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative(wwwDir, fullPath).replace(/\\/g, '/');

            entries.push({
              path: relPath,
              title: extractTitle(content) || file.name.replace('.md', ''),
              sections,
              excerpt: content
                .replace(/^---[\s\S]*?---\n?/, '')  // strip YAML frontmatter
                .replace(/^#[^\n]*\n?/, '')           // strip first H1
                .trim()
                .slice(0, 150),
              hash: hashContent(content),
            });
          }
        }
      }

      scanDir(wwwDir);

      const manifest: Manifest = {
        entries,
        buildDate: new Date().toISOString(),
        version: '1.0',
      };

      // Emit manifest.json as an asset
      this.emitFile({
        type: 'asset',
        fileName: 'assets/manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });

      // Also emit each .md file as a raw asset under www/
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const ctx = this;
      function copyMdFiles(dir: string) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(dir, file.name);
          if (file.isDirectory()) {
            copyMdFiles(fullPath);
          } else if (file.name.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative('www', fullPath).replace(/\\/g, '/');
            ctx.emitFile({
              type: 'asset',
              fileName: `www/${relPath}`,
              source: content,
            });
          }
        }
      }

      copyMdFiles(wwwDir);
    },
  };
}

/**
 * Dev-server plugin: serves /assets/manifest.json on the fly from www/*.md files.
 * The build-time plugin (generate-manifest) only runs during `vite build`, so
 * the dev server would 404 on /assets/manifest.json without this.
 */
function devManifestPlugin(): Plugin {
  return {
    name: 'dev-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/assets/manifest.json', (_req, res) => {
        const wwwDir = path.resolve(__dirname || process.cwd(), 'www');
        const entries: ManifestEntry[] = [];

        function scanDir(dir: string, sections: string[] = []) {
          if (!fs.existsSync(dir)) return;
          const files = fs.readdirSync(dir, { withFileTypes: true });
          for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
              scanDir(fullPath, [...sections, file.name]);
            } else if (file.name.endsWith('.md')) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const relPath = path.relative(wwwDir, fullPath).replace(/\\/g, '/');
              entries.push({
                path: relPath,
                title: extractTitle(content) || file.name.replace('.md', ''),
                sections,
                excerpt: content
                  .replace(/^---[\s\S]*?---\n?/, '')
                  .replace(/^#[^\n]*\n?/, '')
                  .trim()
                  .slice(0, 150),
                hash: hashContent(content),
              });
            }
          }
        }

        scanDir(wwwDir);

        const manifest: Manifest = {
          entries,
          buildDate: new Date().toISOString(),
          version: '1.0',
        };

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(manifest, null, 2));
      });

      // Serve www/*.md files directly under /www/ path during dev
      server.middlewares.use('/www', (req, res, next) => {
        const wwwDir = path.resolve(process.cwd(), 'www');
        const filePath = path.join(wwwDir, req.url ?? '');
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.end(fs.readFileSync(filePath, 'utf-8'));
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [generateManifestPlugin(), devManifestPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/agent': 'http://localhost:8001',
    },
  },
});
