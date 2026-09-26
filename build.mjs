import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const check = process.argv.includes('--check');

const options = {
  entryPoints: {
    sidepanel: resolve(root, 'src/main.js'),
    background: resolve(root, 'src/background.js')
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome114'],
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  minify: !watch && !check,
  sourcemap: watch ? 'inline' : false
};

async function copyStatic() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(resolve(root, 'sidepanel'), dist, { recursive: true });
  await cp(resolve(root, 'apps-script.gs'), resolve(dist, 'apps-script.gs'));
}

await copyStatic();

if (check) {
  await esbuild.build({ ...options, minify: false });
  const html = await readFile(resolve(dist, 'sidepanel.html'), 'utf8');
  const missing = [];
  for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
    if (!existsSync(resolve(dist, m[1]))) missing.push(m[1]);
  }
  if (missing.length) {
    console.error('Missing assets referenced by sidepanel.html: ' + missing.join(', '));
    process.exitCode = 1;
  } else {
    console.log('sidepanel.html asset check passed');
  }
} else if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/ -> dist/');
} else {
  await esbuild.build(options);
  console.log('built -> dist/  (reload the extension at chrome://extensions)');
}
