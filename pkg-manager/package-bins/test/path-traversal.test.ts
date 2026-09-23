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
