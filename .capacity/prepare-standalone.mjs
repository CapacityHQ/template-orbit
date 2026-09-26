// Capacity: Node replacement for apps/web/scripts/prepare-standalone.ts (which
// bundles with Bun.build). Run from the repository root after `next build`.
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
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
    'admin-account': join(root, '.capacity', 'admin-account.ts'),
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
  // Native module: esbuild cannot bundle it. The admin bundle imports it at
  // runtime, and Next's standalone trace does not leave it where Node resolves
  // it from apps/web, so it is copied there below.
  external: ['@node-rs/argon2'],
  logLevel: 'warning',
});
if (result.errors.length > 0)
  throw new AggregateError(result.errors, 'Failed to bundle the entrypoints');

function packageDir(file) {
  let dir = dirname(file);
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No package.json above ${file}`);
    dir = parent;
  }
  return dir;
}

// pnpm keeps the platform binding it installed for this build (for example
// argon2-linux-x64-gnu) as a sibling of @node-rs/argon2, which is where the
// package's loader requires it from. The build and runtime images share the
// platform, so both are copied, symlinks resolved, next to the bundles.
const argon2Scope = dirname(
  packageDir(createRequire(join(web, 'package.json')).resolve('@node-rs/argon2')),
);
const argon2Entries = (await readdir(argon2Scope)).filter((name) => name.startsWith('argon2'));
if (!argon2Entries.some((name) => name.startsWith('argon2-'))) {
  throw new Error(`No @node-rs/argon2 platform binding found in ${argon2Scope}`);
}
const argon2Target = join(standalone, 'node_modules', '@node-rs');
await mkdir(argon2Target, { recursive: true });
for (const name of argon2Entries) {
  await rm(join(argon2Target, name), { recursive: true, force: true });
  await cp(join(argon2Scope, name), join(argon2Target, name), {
    recursive: true,
    dereference: true,
  });
}
console.info(`Copied @node-rs/${argon2Entries.join(', @node-rs/')} next to the bundles.`);
console.info(
  'Standalone prepared: start, realtime, scheduler, gateway, migrate and admin-account bundles written.',
);
