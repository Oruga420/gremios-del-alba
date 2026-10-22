import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checked = [];
const isWithin = (base, file) => file === base || file.startsWith(`${base}${sep}`);
const forbiddenPublic = /(?:^|[\\/])(?:\.[^\\/]+|node_modules|scripts|server|sources|reference|provider-raw|provider-responses)(?:[\\/]|$)/i;
const secretValue = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|r8_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) { failures.push(`Symbolic source path: ${relative(root, path)}`); continue; }
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (['.js', '.mjs'].includes(extname(path))) files.push(path);
  }
  return files;
}

const sourceFiles = await walk(resolve(root, 'src'));
const supportFiles = await Promise.all(['scripts', 'tests', 'server', 'api'].map(dir => walk(resolve(root, dir))));
let serverExists = false;
try { await readFile(resolve(root, 'server.mjs')); serverExists = true; } catch {}
for (const file of [...sourceFiles, ...supportFiles.flat(), ...(serverExists ? [resolve(root, 'server.mjs')] : [])].sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', cwd: root });
  if (result.status !== 0) failures.push(`${relative(root, file)}: ${result.stderr.trim() || 'syntax check failed'}`);
  else checked.push(relative(root, file).replaceAll('\\', '/'));
}
if (!sourceFiles.length) failures.push('Browser source is absent.');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (packageJson.type !== 'module' || packageJson.dependencies || packageJson.devDependencies) failures.push('Package must use native ESM without dependencies.');

for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  if (secretValue.test(text)) failures.push(`Secret-like value in browser source: ${relative(root, file)}`);
  if (/\b(?:eval\s*\(|new\s+Function\s*\(|require\s*\(|process\.env\b)/.test(text)) failures.push(`Unsafe or server-only browser API: ${relative(root, file)}`);
  const imports = [...text.matchAll(/(?:\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const specifier of imports) {
    const rootedPublic = /^\/(?:src\/|assets\/vendor\/)[A-Za-z0-9_./-]+\.js$/.test(specifier) && !specifier.includes('..');
    if (!specifier.startsWith('./') && !specifier.startsWith('../') && !rootedPublic) { failures.push(`Nonlocal browser import: ${relative(root, file)} -> ${specifier}`); continue; }
    const target = rootedPublic ? resolve(root, specifier.slice(1)) : resolve(dirname(file), specifier.split(/[?#]/)[0]);
    const allowedRoot = rootedPublic && specifier.startsWith('/assets/vendor/') ? resolve(root, 'assets', 'vendor') : resolve(root, 'src');
    if (!isWithin(allowedRoot, target) || forbiddenPublic.test(relative(allowedRoot, target))) { failures.push(`Browser import escapes public source: ${relative(root, file)} -> ${specifier}`); continue; }
    try { if (!isWithin(allowedRoot, await realpath(target))) failures.push(`Canonical browser import escapes source: ${specifier}`); }
    catch { failures.push(`Missing browser import: ${relative(root, file)} -> ${specifier}`); }
  }
}

try {
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  if (secretValue.test(index)) failures.push('Secret-like value in index.html');
  const modules = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  if (!modules.length) failures.push('Playable index has no module entry.');
  for (const url of modules) {
    if (!/^(?:\.\/|\/)?src\/[A-Za-z0-9_./-]+\.js(?:\?[^#]*)?$/.test(url) || url.includes('..')) failures.push(`Nonlocal index script: ${url}`);
    else { try { await readFile(resolve(root, url.split('?')[0].replace(/^\//, ''))); } catch { failures.push(`Missing index entry: ${url}`); } }
  }
} catch { failures.push('Playable index.html is absent.'); }

if (failures.length) {
  console.error(JSON.stringify({ status: 'SOURCE_CHECK_FAILED', checked, failures }, null, 2));
  process.exitCode = 1;
} else console.log(JSON.stringify({ status: 'SOURCE_CHECK_OK', nativeEsm: true, checkedModules: checked.length, sourceBoundaries: true, checked }, null, 2));
