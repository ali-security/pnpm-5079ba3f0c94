import fs from 'fs'
import path from 'path'
import symlinkDir from 'symlink-dir'
import tempy from 'tempy'
import { createCafs } from '../src/index.js'

// `symlink-dir` creates relative links and cannot point a link at its own parent
// directory, so the self-referencing link is created directly. The 'junction'
// type is ignored on POSIX and avoids needing symlink privileges on Windows.
function symlinkSelf (target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, 'junction')
}

test('addFilesFromDir does not loop infinitely on recursive symlinks', () => {
  const storeDir = tempy.directory()
  const srcDir = tempy.directory()

  fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content')
  // Create a symlink pointing to the current directory
  symlinkSelf(srcDir, path.join(srcDir, 'self'))

  const cafs = createCafs(storeDir)
  const { filesIndex } = cafs.addFilesFromDir(srcDir)

  expect(filesIndex['file.txt']).toBeDefined()
  expect(filesIndex['self/file.txt']).toBeUndefined()
})

test('addFilesFromDir does not loop infinitely on a symlink pointing to an ancestor directory', async () => {
  const storeDir = tempy.directory()
  const srcDir = tempy.directory()

  fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content')
  const nestedDir = path.join(srcDir, 'nested')
  fs.mkdirSync(nestedDir)
  fs.writeFileSync(path.join(nestedDir, 'nested.txt'), 'nested content')
  // A symlink deep in the package that points back at the package root
  await symlinkDir(srcDir, path.join(nestedDir, 'up'))

  const cafs = createCafs(storeDir)
  const { filesIndex } = cafs.addFilesFromDir(srcDir)

  expect(filesIndex['file.txt']).toBeDefined()
  expect(filesIndex['nested/nested.txt']).toBeDefined()
  expect(filesIndex['nested/up/file.txt']).toBeUndefined()
})

test('addFilesFromDir does not loop infinitely on mutually recursive symlinks', async () => {
  const storeDir = tempy.directory()
  const srcDir = tempy.directory()

  fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content')
  const a = path.join(srcDir, 'a')
  const b = path.join(srcDir, 'b')
  fs.mkdirSync(a)
  fs.mkdirSync(b)
  fs.writeFileSync(path.join(a, 'a.txt'), 'a')
  fs.writeFileSync(path.join(b, 'b.txt'), 'b')
  await symlinkDir(b, path.join(a, 'to-b'))
  await symlinkDir(a, path.join(b, 'to-a'))

  const cafs = createCafs(storeDir)
  const { filesIndex } = cafs.addFilesFromDir(srcDir)

  expect(filesIndex['file.txt']).toBeDefined()
  expect(filesIndex['a/a.txt']).toBeDefined()
  expect(filesIndex['b/b.txt']).toBeDefined()
  // The cycle is cut off: a -> b -> a is not traversed again
  expect(filesIndex['a/to-b/to-a/a.txt']).toBeUndefined()
  expect(filesIndex['b/to-a/to-b/b.txt']).toBeUndefined()
})
