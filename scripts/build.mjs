import { mkdir, readdir, readFile, writeFile, copyFile, lstat, realpath, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const staging = resolve(root, '.local', `build-${randomUUID()}`);
const allowedExtensions = new Set(['.html', '.js', '.css', '.json', '.license', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.gif', '.woff', '.woff2', '.mp3', '.wav', '.ogg', '.glb']);
const excludedSegment = /^(?:\..*|node_modules|reference|references|sources|scripts|server|provider-raw|provider-responses|raw|drafts|concepts|models|reports)$/i;
const excludedFile = /(?:^|[-_.])(?:credentials?|secrets?|service-account|budget|budget-ledger|reservations?|provider-jobs|task-ledger)(?:[-_.]|$)|\.(?:key|pem|env|onnx|safetensors|py|mjs|ps1|cmd|bat)$/i;
const secretValue = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|r8_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const within = (base, value) => value === base || value.startsWith(`${base}${sep}`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];

const preflight = spawnSync(process.execPath, [resolve(root, 'scripts', 'check.mjs')], { cwd: root, encoding: 'utf8' });
if (preflight.status !== 0) {
  console.error(preflight.stdout.trim() || preflight.stderr.trim() || 'Source preflight failed.');
  console.error('BUILD_FAILED: public source is not ready.');
  process.exit(1);
}

async function add(file) {
  const canonical = await realpath(file);
  if (!within(root, canonical) || (await lstat(file)).isSymbolicLink()) throw new Error(`Noncanonical public source: ${relative(root, file)}`);
  const rel = relative(root, file).replaceAll('\\', '/');
  const bytes = await readFile(file);
  if (['.html', '.js', '.css', '.json', '.svg'].includes(extname(file)) && secretValue.test(bytes.toString('utf8'))) throw new Error(`Secret-like public source: ${rel}`);
  await mkdir(dirname(resolve(staging, rel)), { recursive: true });
  await copyFile(file, resolve(staging, rel));
  files.push({ path: rel, sha256: digest(bytes), bytes: bytes.length });
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excludedSegment.test(entry.name) || excludedFile.test(entry.name)) continue;
    const file = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic public path: ${relative(root, file)}`);
    if (entry.isDirectory()) await walk(file);
    else if (allowedExtensions.has(extname(entry.name).toLowerCase())) await add(file);
  }
}

await mkdir(staging, { recursive: true });
try {
  const vendorProvenance = resolve(root, 'assets/vendor/elevenlabs-client.provenance.json');
  let provenance = null;
  try { provenance = JSON.parse(await readFile(vendorProvenance, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (provenance) {
    const bundle = resolve(root, 'assets/vendor/elevenlabs-client.js');
    const license = resolve(root, 'assets/vendor/elevenlabs-client.LICENSE');
    if (provenance.package !== '@elevenlabs/client' || provenance.version !== '1.27.0' || provenance.license !== 'MIT' || digest(await readFile(bundle)) !== provenance.vendoredSha256 || digest(await readFile(license)) !== provenance.licenseSha256) throw new Error('Official voice SDK provenance/hash mismatch.');
    if (spawnSync(process.execPath, ['--check', bundle], { encoding: 'utf8' }).status !== 0) throw new Error('Official voice SDK syntax check failed.');
  }
  await add(resolve(root, 'index.html'));
  // Distributable builds retain the exact project/artwork/upstream notices.
  for (const legal of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/LICENSE.md', 'assets/CC-BY-4.0.txt', 'assets/vendor/livekit-client.NOTICE']) {
    try { await lstat(resolve(root, legal)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await add(resolve(root, legal));
  }
  await walk(resolve(root, 'src'));
  await walk(resolve(root, 'assets'));
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some(file => file.path.startsWith('src/') && file.path.endsWith('.js'))) throw new Error('No game modules to build.');
  const buildId = digest(JSON.stringify(files));
  const manifest = { version: 1, buildId, generatedAt: new Date().toISOString(), publicRoots: ['index.html', 'src', 'assets'], algorithm: 'sha256', files };
  await writeFile(resolve(staging, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Only the fixed project dist directory can be replaced. Refuse symlinks before deletion.
  try { if ((await lstat(dist)).isSymbolicLink() || !within(root, await realpath(dist))) throw new Error('Refusing unsafe dist target.'); await rm(dist, { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(staging, dist);
  console.log(JSON.stringify({ status: 'BUILD_OK', buildId, output: 'dist', copiedFiles: files.length, publicRoots: manifest.publicRoots, manifest: 'dist/build-manifest.json', sha256: true }, null, 2));
} catch (error) {
  if (within(resolve(root, '.local'), staging)) await rm(staging, { recursive: true, force: true });
  console.error(`BUILD_FAILED: ${error.message}`);
  process.exitCode = 1;
}
