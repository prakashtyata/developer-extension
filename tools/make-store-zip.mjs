/**
 * Builds the Chrome Web Store package.
 *
 * The store accepts a zip whose root holds manifest.json plus everything the
 * manifest points at. Source, tests, node_modules and the Apps Script backend
 * are not part of the extension and must not ship, so they are never included
 * rather than merely ignored.
 *
 * Usage: node tools/make-store-zip.mjs
 */
import { mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'release');

const INCLUDE_FILES = ['manifest.json'];
const INCLUDE_DIRS = ['dist', 'icons'];

// Files inside dist/ that are not part of the running extension. The backend
// source lives in dist/ for local convenience; shipping it would publish the
// server code to anyone who unzips the package.
const EXCLUDE = [/^apps-script\.gs$/i, /\.map$/i];

async function main() {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const version = manifest.version;

  // Fail loudly rather than shipping a package the store will reject.
  const problems = [];
  for (const key of ['name', 'version', 'description', 'icons', 'manifest_version']) {
    if (!manifest[key]) problems.push(`manifest is missing "${key}"`);
  }
  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(manifest.version)) {
    problems.push(`version "${manifest.version}" is not 1-4 dot separated integers`);
  }
  if (manifest.name.length > 45) problems.push(`name is ${manifest.name.length} chars, max 45`);
  if (manifest.description.length > 132) {
    problems.push(`description is ${manifest.description.length} chars, max 132`);
  }
  for (const size of [16, 48, 128]) {
    const p = manifest.icons && manifest.icons[String(size)];
    if (!p) problems.push(`icons.${size} is missing`);
    else if (!existsSync(resolve(root, p))) problems.push(`icons.${size} -> ${p} does not exist`);
  }
  // Every path the manifest references must be inside the package.
  const referenced = [
    manifest.side_panel && manifest.side_panel.default_path,
    manifest.background && manifest.background.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action && manifest.action.default_icon) || {})
  ].filter(Boolean);
  for (const rel of referenced) {
    if (!existsSync(resolve(root, rel))) problems.push(`manifest points at ${rel}, which is missing`);
  }
  if (!existsSync(resolve(root, 'dist/sidepanel.js'))) {
    problems.push('dist/sidepanel.js is missing - run `npm run build` first');
  }
  if (problems.length) {
    console.error('Not packaging. Fix these first:');
    for (const p of problems) console.error('  - ' + p);
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  const zip = resolve(outDir, `wp-dev-pad-${version}.zip`);
  await rm(zip, { force: true });

  // Compress-Archive keeps a root folder when given a directory, so stage the
  // exact file list first and zip the files.
  const stage = resolve(outDir, 'stage');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const staged = [];
  for (const f of INCLUDE_FILES) {
    await writeFile(resolve(stage, f), await readFile(resolve(root, f)));
    staged.push(f);
  }
  for (const d of INCLUDE_DIRS) {
    await cpDir(resolve(root, d), resolve(stage, d));
    staged.push(d);
  }

  await rm(zip, { force: true });
  // Compress-Archive on Windows writes backslashes into the entry names, which
  // Chrome rejects. bsdtar writes the forward slashes the zip format requires.
  execFileSync('tar.exe', ['-a', '-c', '-f', zip, ...staged], { cwd: stage, stdio: 'inherit' });
  await rm(stage, { recursive: true, force: true });

  const size = (await stat(zip)).size;
  console.log(`packaged -> ${basename(zip)}  (${(size / 1024).toFixed(0)} kb)`);
  console.log(`contains: ${referenced.length} referenced assets, root has manifest.json`);
  console.log('upload this file at chrome.google.com/webstore');
}

async function cpDir(from, to) {
  const { readdir, mkdir: mk, copyFile } = await import('node:fs/promises');
  await mk(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (EXCLUDE.some((re) => re.test(entry.name))) continue;
    const src = resolve(from, entry.name);
    const dst = resolve(to, entry.name);
    if (entry.isDirectory()) await cpDir(src, dst);
    else await copyFile(src, dst);
  }
}

main();
