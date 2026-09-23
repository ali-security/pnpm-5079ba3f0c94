import fs from 'fs'
import os from 'os'
import path from 'path'
import { getBinsFromPackageManifest } from '@pnpm/package-bins'

test('skip directories.bin with real path traversal', async () => {
  // Create a secret file outside the package directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-bins-'))
  const secretDir = path.join(tempDir, 'secret')
  fs.mkdirSync(secretDir)
  fs.writeFileSync(path.join(secretDir, 'secret.sh'), 'echo secret')

  // Create a package directory
  const pkgDir = path.join(tempDir, 'pkg')
  fs.mkdirSync(pkgDir)

  // Calculate relative path from pkgDir to secretDir
  const relativePath = path.relative(pkgDir, secretDir)

  // Attempt path traversal
  const bins = await getBinsFromPackageManifest({
    name: 'malicious',
    version: '1.0.0',
    directories: {
      bin: relativePath,
    },
  }, pkgDir)

  // Should be empty because it escaped pkgDir
  expect(bins).toStrictEqual([])

  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('read directories.bin that stays inside the package directory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-bins-'))
  const pkgDir = path.join(tempDir, 'pkg')
  const binDir = path.join(pkgDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'legit.sh'), 'echo legit')

  const bins = await getBinsFromPackageManifest({
    name: 'legit',
    version: '1.0.0',
    directories: {
      bin: 'bin',
    },
  }, pkgDir)

  expect(bins).toStrictEqual([
    {
      name: 'legit.sh',
      path: path.join(binDir, 'legit.sh'),
    },
  ])

  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('reserved bin names cannot delete the bin directory or its parent', async () => {
  // Security test: the resolved bin names are joined to the target bin directory
  // and recursively removed on global remove/update/add. `""` and `"."` join to
  // the bin directory itself and `".."` (also reachable via a scoped key such as
  // `@scope/..`) joins to its parent, so a malicious manifest could wipe out
  // unrelated files. Only the safe `good` shim may be produced.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-bins-'))
  const globalDir = path.join(tempDir, 'global')
  const globalBinDir = path.join(globalDir, 'bin')
  const neighbor = path.join(globalDir, 'keep-me.txt')
  fs.mkdirSync(globalBinDir, { recursive: true })
  fs.writeFileSync(neighbor, 'do not delete me')
  fs.writeFileSync(path.join(globalBinDir, 'good'), '#!/bin/sh\n')

  const pkgDir = path.join(tempDir, 'pkg')
  fs.mkdirSync(pkgDir)

  const bins = await getBinsFromPackageManifest({
    name: 'malicious',
    version: '1.0.0',
    bin: {
      '': './empty.js',
      '.': './dot.js',
      '..': './dot-dot.js',
      '@scope/.': './scoped-dot.js',
      '@scope/..': './scoped-dot-dot.js',
      good: './good',
    },
  }, pkgDir)

  expect(bins).toStrictEqual([
    {
      name: 'good',
      path: path.join(pkgDir, 'good'),
    },
  ])

  // Replay the deletion sink: without the guard, one of these joins resolves to
  // `globalBinDir` or `globalDir` and takes everything with it.
  for (const { name } of bins) {
    fs.rmSync(path.join(globalBinDir, name), { recursive: true, force: true })
  }

  expect(fs.existsSync(globalBinDir)).toBe(true)
  expect(fs.existsSync(neighbor)).toBe(true)

  fs.rmSync(tempDir, { recursive: true, force: true })
})
