import { type Resolution } from '@pnpm/resolver-base'
import { toLockfileResolution } from '../lib/updateLockfile.js'

const REGISTRY = 'https://registry.npmjs.org/'
const PKG = { name: 'foo', version: '1.0.0' }
const GIT_TARBALL = 'https://codeload.github.com/foo/bar/tar.gz/abcdef'

test('pins the integrity of a git-hosted tarball in the lockfile', () => {
  // Without the checksum in the lockfile, a later install accepts whatever the
  // git host serves for the same URL.
  expect(toLockfileResolution(
    PKG,
    { integrity: 'sha512-AAAA', tarball: GIT_TARBALL, gitHosted: true } as Resolution,
    REGISTRY,
    false
  )).toEqual({
    integrity: 'sha512-AAAA',
    tarball: GIT_TARBALL,
    gitHosted: true,
  })
})

test('pins the integrity of a git-hosted tarball when lockfileIncludeTarballUrl is true', () => {
  expect(toLockfileResolution(
    PKG,
    { integrity: 'sha512-AAAA', tarball: GIT_TARBALL, gitHosted: true } as Resolution,
    REGISTRY,
    true
  )).toEqual({
    integrity: 'sha512-AAAA',
    tarball: GIT_TARBALL,
    gitHosted: true,
  })
})

test('recognizes a git-hosted tarball by its URL when the resolution has no gitHosted field', () => {
  // Resolutions that didn't go through the git resolver or the lockfile loader
  // must still be pinned and marked.
  expect(toLockfileResolution(
    PKG,
    { integrity: 'sha512-AAAA', tarball: GIT_TARBALL } as Resolution,
    REGISTRY,
    false
  )).toEqual({
    integrity: 'sha512-AAAA',
    tarball: GIT_TARBALL,
    gitHosted: true,
  })
})

test('keeps the path of a git-hosted tarball pointing to a subdirectory', () => {
  // The path selects the subdirectory to extract from a monorepo tarball
  // (`repo#commit&path:/sub/dir`). Dropping it makes later installs silently
  // unpack the repository root. See https://github.com/pnpm/pnpm/issues/12304.
  for (const lockfileIncludeTarballUrl of [false, true]) {
    expect(toLockfileResolution(
      PKG,
      { integrity: 'sha512-AAAA', tarball: GIT_TARBALL, gitHosted: true, path: '/packages/foo' } as Resolution,
      REGISTRY,
      lockfileIncludeTarballUrl
    )).toEqual({
      integrity: 'sha512-AAAA',
      tarball: GIT_TARBALL,
      gitHosted: true,
      path: '/packages/foo',
    })
  }
})

test('a reconstructible registry tarball URL is still dropped from the lockfile', () => {
  expect(toLockfileResolution(
    PKG,
    { integrity: 'sha512-AAAA', tarball: `${REGISTRY}foo/-/foo-1.0.0.tgz` } as Resolution,
    REGISTRY,
    false
  )).toEqual({
    integrity: 'sha512-AAAA',
  })
})

test('a non-standard registry tarball URL is kept but not marked as git-hosted', () => {
  expect(toLockfileResolution(
    PKG,
    { integrity: 'sha512-AAAA', tarball: 'https://npm.pkg.github.com/download/@foo/foo/1.0.0/deadbeef' } as Resolution,
    REGISTRY,
    false
  )).toEqual({
    integrity: 'sha512-AAAA',
    tarball: 'https://npm.pkg.github.com/download/@foo/foo/1.0.0/deadbeef',
  })
})
