import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

/**
 * Parses the App Router build output (produced by `next build`, not `next
 * dev`) into per-route first-load JS sizes. Run via `npm run bench:bundle`
 * (which runs `next build` first). Writes JSON to
 * ../../../benchmarks/results/web-bundle.json for the aggregate bench report.
 */

const webDir = join(__dirname, '..');
const nextDir = join(webDir, '.next');
const manifestPath = join(nextDir, 'app-build-manifest.json');

type AppBuildManifest = {
  pages: Record<string, string[]>;
};

type RouteReport = {
  route: string;
  firstLoadBytes: number;
  firstLoadGzipBytes: number;
};

function fileSizes(files: string[]): { raw: number; gzip: number } {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const path = join(nextDir, file);
    if (!existsSync(path)) continue;
    const contents = readFileSync(path);
    raw += statSync(path).size;
    gzip += gzipSync(contents).length;
  }
  return { raw, gzip };
}

function main() {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${manifestPath} not found -- run "next build" (production build) before bench:bundle, not "next dev"`,
    );
  }
  const manifest: AppBuildManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const results: RouteReport[] = Object.entries(manifest.pages)
    .filter(([route]) => !route.includes('/_'))
    .map(([route, files]) => {
      const jsFiles = files.filter((f) => f.endsWith('.js'));
      const { raw, gzip } = fileSizes(jsFiles);
      return { route, firstLoadBytes: raw, firstLoadGzipBytes: gzip };
    })
    .sort((a, b) => b.firstLoadGzipBytes - a.firstLoadGzipBytes);

  const outDir = join(webDir, '..', '..', 'benchmarks', 'results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'web-bundle.json'), JSON.stringify(results, null, 2));

  console.table(
    results.map((r) => ({
      route: r.route,
      firstLoadKB: (r.firstLoadBytes / 1024).toFixed(1),
      firstLoadGzipKB: (r.firstLoadGzipBytes / 1024).toFixed(1),
    })),
  );
}

main();
