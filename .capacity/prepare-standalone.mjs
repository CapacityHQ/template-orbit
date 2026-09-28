// Capacity: Node replacement for apps/web/scripts/prepare-standalone.ts (which
// bundles with Bun.build). Run from the repository root after `next build`.
import { cp, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const web = join(root, 'apps', 'web');
const standalone = join(web, '.next', 'standalone', 'apps', 'web');

try {
  if (!(await stat(standalone)).isDirectory()) throw new Error('Missing standalone output');
} catch {
  throw new Error('Missing standalone output: run `next build` in apps/web first');
}
await mkdir(join(standalone, '.next'), { recursive: true });
await cp(join(web, 'public'), join(standalone, 'public'), { recursive: true });
await cp(join(web, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
await cp(join(root, 'packages', 'db', 'drizzle'), join(standalone, 'migrations'), {
  recursive: true,
});

const banner = [
  "import { createRequire as __capacityCreateRequire } from 'node:module';",
  "import { dirname as __capacityDirname } from 'node:path';",
  "import { fileURLToPath as __capacityFileURLToPath } from 'node:url';",
  'const require = __capacityCreateRequire(import.meta.url);',
  'const __filename = __capacityFileURLToPath(import.meta.url);',
  'const __dirname = __capacityDirname(__filename);',
].join('\n');

const result = await build({
  entryPoints: {
    start: join(web, 'src', 'start.ts'),
    realtime: join(web, 'src', 'realtime.ts'),
    scheduler: join(web, 'src', 'scheduler.ts'),
    gateway: join(web, 'src', 'gateway.ts'),
    migrate: join(root, 'scripts', 'container-migrate.ts'),
  },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: standalone,
  outExtension: { '.js': '.mjs' },
  tsconfig: join(web, 'tsconfig.json'),
  banner: { js: banner },
  // esbuild leaves `import.meta.main` alone, so every module in a bundle would
  // share the ENTRY's value: upstream's check-drift.ts and migration-release.ts
  // gate a CLI block on it, and bundled into migrate.mjs that block ran the
  // drift guard against the empty database and exited 1 before the release
  // (probe run 3, 2026-09-26). Bun's bundler rewrites it per module; here it
  // is pinned to false, which is right for every entry point built above.
  define: { 'import.meta.main': 'false' },
  logLevel: 'warning',
});
if (result.errors.length > 0)
  throw new AggregateError(result.errors, 'Failed to bundle the entrypoints');
console.info(
  'Standalone prepared: start, realtime, scheduler, gateway and migrate bundles written.',
);
