import { getNonDevWantedDependencies } from '../lib/getNonDevWantedDependencies.js'
import { getWantedDependencies } from '../lib/getWantedDependencies.js'

// The payload from the advisory: a transitive dependency key that escapes
// `node_modules` once it is used as a symlink name.
const TRAVERSAL_ALIAS = '@x/../../../../../.git/hooks'

const expectedError = expect.objectContaining({
  code: 'ERR_PNPM_INVALID_DEPENDENCY_NAME',
})

test('getWantedDependencies rejects a path-traversal alias in dependencies', () => {
  expect(() => {
    getWantedDependencies({ dependencies: { [TRAVERSAL_ALIAS]: '1.0.0' } })
  }).toThrow(expect.objectContaining({
    code: 'ERR_PNPM_INVALID_DEPENDENCY_NAME',
    message: expect.stringContaining('The current package contains a dependency with an invalid name'),
  }))
})

test('getWantedDependencies rejects a path-traversal alias in devDependencies', () => {
  expect(() => {
    getWantedDependencies({ devDependencies: { [TRAVERSAL_ALIAS]: '1.0.0' } })
  }).toThrow(expectedError)
})

test('getWantedDependencies rejects a path-traversal alias in optionalDependencies', () => {
  expect(() => {
    getWantedDependencies({ optionalDependencies: { [TRAVERSAL_ALIAS]: '1.0.0' } })
  }).toThrow(expectedError)
})

test('getWantedDependencies rejects a path-traversal alias in peerDependencies', () => {
  expect(() => {
    getWantedDependencies({ peerDependencies: { [TRAVERSAL_ALIAS]: '1.0.0' } })
  }).toThrow(expectedError)
})

test('getWantedDependencies keeps working for valid aliases', () => {
  const wantedDeps = getWantedDependencies({
    dependencies: { foo: '1.0.0' },
    devDependencies: { '@scope/bar': '2.0.0' },
  })
  expect(wantedDeps.map(({ alias }) => alias).sort()).toStrictEqual(['@scope/bar', 'foo'])
})

test('getNonDevWantedDependencies rejects a path-traversal alias in a resolved package manifest', () => {
  expect(() => {
    getNonDevWantedDependencies({
      name: 'evil',
      version: '1.0.0',
      dependencies: { [TRAVERSAL_ALIAS]: '1.0.0' },
    })
  }).toThrow(expect.objectContaining({
    code: 'ERR_PNPM_INVALID_DEPENDENCY_NAME',
    message: expect.stringContaining('Package "evil@1.0.0" contains a dependency with an invalid name'),
  }))
})

test('getNonDevWantedDependencies rejects a path-traversal alias in optionalDependencies', () => {
  expect(() => {
    getNonDevWantedDependencies({
      name: 'evil',
      version: '1.0.0',
      optionalDependencies: { [TRAVERSAL_ALIAS]: '1.0.0' },
    })
  }).toThrow(expectedError)
})

test('getNonDevWantedDependencies keeps working for valid aliases', () => {
  expect(getNonDevWantedDependencies({
    name: 'good',
    version: '1.0.0',
    dependencies: { foo: '1.0.0' },
  })).toStrictEqual([
    {
      alias: 'foo',
      bareSpecifier: '1.0.0',
      dev: false,
      injected: undefined,
      optional: false,
    },
  ])
})
