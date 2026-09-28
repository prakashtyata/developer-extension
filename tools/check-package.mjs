/**
 * Validates a Chrome Web Store package that already exists on disk.
 *
 * `store:zip` refuses to build a bad package, so a zip it produced is always
 * valid. The risk is shipping the wrong file: a hand-made zip of the project
 * folder looks like a package, carries an old version number, and is rejected
 * for reasons that have nothing to do with the listing copy.
 *
 * Run this on any candidate file before uploading it.
 *
 * Usage: npm run store:check -- <path-to-zip>
 */
import { mkdtemp, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A hand-made zip of the project folder drags in these. Shipping any of them
// either breaks the review or publishes code that is not the extension.
const FORBIDDEN = [
  [/^node_modules\//i, 'node_modules/ is not part of the extension'],
  [/^src\//i, 'src/ is source, not shipped code'],
  [/^tools\//i, 'tools/ is build tooling, not shipped code'],
  [/\.map$/i, 'source maps are not shipped'],
  [/^apps-script\.gs$/i, 'the Apps Script backend must not be published']
];

// Only these may sit at the zip root. Anything else means the folder itself was
// zipped instead of its contents, which the store cannot read.
const ALLOWED_ROOT = ['manifest.json', 'dist/', 'icons/'];

const argPath = process.argv[2];
if (!argPath) {
  console.error('usage: npm run store:check -- <path-to-zip>');
  process.exit(2);
}
const zip = resolve(process.cwd(), argPath);
if (!existsSync(zip)) {
  console.error(`no such file: ${zip}`);
  process.exit(2);
}

const problems = [];
const work = await mkdtemp(join(tmpdir(), 'cws-check-'));

try {
  const names = listEntries(zip);
  const rel = names.map((n) => n.replace(/\\/g, '/'));

  // Windows Explorer's "compress to zip" writes backslashes and a wrapping
  // folder. Both are rejected, and both are the usual reason a hand-made zip
  // fails with an error that does not mention either.
  const backslashed = names.filter((n) => n.includes('\\'));
  if (backslashed.length) {
    problems.push(`${backslashed.length} entries use backslashes, the zip format needs forward slashes`);
  }
  const wrapped = rel.every((n) => n.startsWith('wp-dev-pad/'));
  if (wrapped) problems.push('the project folder itself was zipped, so manifest.json is not at the root');

  // When the folder was zipped whole, every path is prefixed with it. Strip that
  // before the checks below, otherwise a leading folder hides node_modules and
  // the other paths that must never ship.
  const inner = wrapped ? rel.map((n) => n.replace(/^wp-dev-pad\//, '')) : rel;

  for (const [re, why] of FORBIDDEN) {
    const hit = inner.find((n) => re.test(n));
    if (hit) problems.push(`contains ${hit} - ${why}`);
  }

  const roots = new Set(inner.map((n) => {
    const seg = n.split('/');
    return seg.length > 1 ? `${seg[0]}/` : seg[0];
  }).filter(Boolean));
  for (const r of roots) {
    if (!ALLOWED_ROOT.some((a) => r === a || r.startsWith(a))) problems.push(`unexpected item at the zip root: ${r}`);
  }

  // Read the manifest out of the archive rather than from the working tree, so
  // this reports the file that would actually be uploaded.
  let mf = null;
  try {
    const found = rel.find((n) => n === 'manifest.json');
    if (found) {
      execFileSync('tar.exe', ['-xf', zip, '-C', work], { stdio: 'ignore' });
      const text = await readFile(resolve(work, 'manifest.json'), 'utf8');
      try {
        mf = JSON.parse(text);
      } catch (e) {
        problems.push(`manifest.json is not valid JSON: ${e.message}`);
      }
    } else {
      problems.push('no manifest.json at the root');
    }
  } catch (e) {
    problems.push(`could not read the archive: ${e.message}`);
  }

  if (mf) {
    if (mf.manifest_version !== 3) problems.push(`manifest_version is ${mf.manifest_version}, must be 3`);
    if (typeof mf.name === 'string' && mf.name.length > 45) {
      problems.push(`name is ${mf.name.length} chars, max 45`);
    }
    const d = typeof mf.description === 'string' ? mf.description : '';
    if (!d) problems.push('description is missing');
    else if (d.length > 132) problems.push(`description is ${d.length} chars, max 132 - the store rejects the upload`);
  }

  // The version in the archive has to match the one the dashboard is expecting,
  // or the upload is refused as a duplicate.
  let local = null;
  try {
    local = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  } catch {}

  const size = (await stat(zip)).size;
  console.log(`file     ${basename(zip)}  (${(size / 1024).toFixed(0)} kb)`);
  console.log(`entries  ${rel.length}`);
  if (mf) {
    console.log(`version  ${mf.version}${local && local.version !== mf.version ? `   (this project is on ${local.version})` : ''}`);
    console.log(`desc     ${String(mf.description).length} / 132 chars`);
    console.log(`         "${mf.description}"`);
  }
  if (local && mf && local.version === mf.version) {
    console.log(`match    same version as this project, so it is a current build`);
  }

  if (problems.length) {
    // stdout, not stderr: the report is the point of the command, and piping it
    // should not hide the reason a package was rejected.
    console.log('\nnot uploadable:');
    for (const p of problems) console.log('  - ' + p);
    process.exitCode = 1;
  } else {
    console.log('\nok - safe to upload');
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

function listEntries(file) {
  const out = execFileSync('tar.exe', ['-tf', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split(/\r?\n/).filter(Boolean);
}
