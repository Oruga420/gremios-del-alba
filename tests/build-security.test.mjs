import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm, copyFile, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
async function fixture() { return mkdtemp(resolve(tmpdir(), 'gremios-public-build-')); }

async function buildFixture() {
  const root = await fixture();
  await Promise.all(['scripts', 'src', 'assets/sprites', 'assets/reference', 'assets/models', 'assets/reports'].map(dir => mkdir(resolve(root, dir), { recursive: true })));
  await copyFile(new URL('../scripts/build.mjs', import.meta.url), resolve(root, 'scripts/build.mjs'));
  await copyFile(new URL('../scripts/check.mjs', import.meta.url), resolve(root, 'scripts/check.mjs'));
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(resolve(root, 'index.html'), '<!doctype html><script type="module" src="/src/app.js"></script>');
  await writeFile(resolve(root, 'src/app.js'), "export const ready = true;\n");
  await writeFile(resolve(root, 'assets/sprites/visible.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(resolve(root, 'assets/manifest.json'), '{}');
  for (const path of ['assets/budget-ledger.json', 'assets/reference/private.svg', 'assets/models/private.glb', 'assets/reports/private.json', 'assets/.env']) await writeFile(resolve(root, path), 'OFFLINE_CANARY_NOT_PUBLIC');
  return root;
}

test('build includes hashed public files and excludes offline/private source material', async () => {
  const root = await buildFixture();
  try {
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /BUILD_OK/);
    const manifest = JSON.parse(await readFile(resolve(root, 'dist/build-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.map(file => file.path), ['assets/manifest.json', 'assets/sprites/visible.svg', 'index.html', 'src/app.js']);
    for (const file of manifest.files) {
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert.equal((await readFile(resolve(root, 'dist', file.path))).includes('OFFLINE_CANARY_NOT_PUBLIC'), false);
    }
    await unlink(resolve(root, 'src/app.js'));
    const missing = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.doesNotMatch(missing.stdout, /BUILD_OK/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('build refuses a public junction or symlink escape', async () => {
  const root = await buildFixture();
  const outside = await mkdtemp(resolve(tmpdir(), 'gremios-outside-'));
  try {
    await writeFile(resolve(outside, 'escape.svg'), 'OUTSIDE_CANARY');
    await symlink(outside, resolve(root, 'assets/sprites/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Symbolic public path/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
