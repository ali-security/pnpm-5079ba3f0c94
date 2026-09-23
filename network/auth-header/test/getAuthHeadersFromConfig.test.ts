import path from 'path'
import os from 'os'
import { getAuthHeadersFromConfig } from '../src/getAuthHeadersFromConfig.js'
import { Buffer } from 'safe-buffer'

const osTokenHelper = {
  linux: path.join(__dirname, 'utils/test-exec.js'),
  win32: path.join(__dirname, 'utils/test-exec.bat'),
}

const osErrorTokenHelper = {
  linux: path.join(__dirname, 'utils/test-exec-error.js'),
  win32: path.join(__dirname, 'utils/test-exec-error.bat'),
}

// Only exception is win32, all others behave like linux
const osFamily = os.platform() === 'win32' ? 'win32' : 'linux'

describe('getAuthHeadersFromConfig()', () => {
  it('should get settings', () => {
    const allSettings = {
      '//registry.npmjs.org/:_authToken': 'abc123',
      '//registry.foobar.eu/:_password': encodeBase64('foobar'),
      '//registry.foobar.eu/:username': 'foobar',
      '//registry.hu/:_auth': 'foobar',
      '//localhost:3000/:_auth': 'foobar',
    }
    const userSettings = {}
    expect(getAuthHeadersFromConfig({ allSettings, userSettings })).toStrictEqual({
      '//registry.npmjs.org/': 'Bearer abc123',
      '//registry.foobar.eu/': 'Basic Zm9vYmFyOmZvb2Jhcg==',
      '//registry.hu/': 'Basic foobar',
      '//localhost:3000/': 'Basic foobar',
    })
  })
  describe('unscoped settings are never bound to the merged default registry', () => {
    // CVE-2026-50017: the merged `registry` may be declared by a lower-trust
    // config source (workspace .npmrc, pnpm-workspace.yaml, `--registry`) than
    // the one that declared the credential. Binding an unscoped credential to
    // it leaks the credential to an attacker-chosen host. `@pnpm/config` pins
    // unscoped per-registry settings to their own source's registry at load
    // time, so nothing unscoped may be re-keyed here.
    it('_authToken', () => {
      const allSettings = {
        registry: 'https://attacker.example.test/',
        _authToken: 'ambient-token',
      }
      expect(getAuthHeadersFromConfig({ allSettings, userSettings: {} })).toStrictEqual({})
    })
    it('_auth', () => {
      const allSettings = {
        registry: 'https://attacker.example.test/',
        _auth: 'foobar',
      }
      expect(getAuthHeadersFromConfig({ allSettings, userSettings: {} })).toStrictEqual({})
    })
    it('username/_password', () => {
      const allSettings = {
        registry: 'https://attacker.example.test/',
        username: 'foo',
        _password: encodeBase64('bar'),
      }
      expect(getAuthHeadersFromConfig({ allSettings, userSettings: {} })).toStrictEqual({})
    })
    it('tokenHelper', () => {
      const allSettings = {
        registry: 'https://attacker.example.test/',
      }
      const userSettings = {
        tokenHelper: osTokenHelper[osFamily],
      }
      expect(getAuthHeadersFromConfig({ allSettings, userSettings })).toStrictEqual({})
    })
    it('falls back to no header at all when no registry is declared', () => {
      const allSettings = {
        _authToken: 'ambient-token',
      }
      expect(getAuthHeadersFromConfig({ allSettings, userSettings: {} })).toStrictEqual({})
    })
    it('only read token helper from user config', () => {
      const allSettings = {
        registry: 'https://reg.com/',
        tokenHelper: osTokenHelper[osFamily],
      }
      expect(getAuthHeadersFromConfig({ allSettings, userSettings: {} })).toStrictEqual({})
    })
  })
  it('should get tokenHelper', () => {
    const userSettings = {
      '//registry.foobar.eu/:tokenHelper': osTokenHelper[osFamily],
    }
    expect(getAuthHeadersFromConfig({ allSettings: {}, userSettings })).toStrictEqual({
      '//registry.foobar.eu/': 'Bearer token-from-spawn',
    })
  })
  it('should throw an error if the token helper is not an absolute path', () => {
    expect(() => getAuthHeadersFromConfig({
      allSettings: {},
      userSettings: {
        '//reg.com:tokenHelper': './utils/text-exec.js',
      },
    })).toThrowError('must be an absolute path, without arguments')
  })
  it('should throw an error if the token helper is not an absolute path with args', () => {
    expect(() => getAuthHeadersFromConfig({
      allSettings: {},
      userSettings: {
        '//reg.com:tokenHelper': `${osTokenHelper[osFamily]} arg1`,
      },
    })).toThrowError('must be an absolute path, without arguments')
  })
  it('should throw an error if the token helper fails', () => {
    expect(() => getAuthHeadersFromConfig({
      allSettings: {},
      userSettings: {
        '//reg.com:tokenHelper': osErrorTokenHelper[osFamily],
      },
    })).toThrowError('Exit code')
  })
  it('only read token helper from user config', () => {
    const allSettings = {
      '//reg.com:tokenHelper': osTokenHelper[osFamily],
    }
    expect(getAuthHeadersFromConfig({ allSettings, userSettings: {} })).toStrictEqual({})
  })
})

function encodeBase64 (s: string) {
  return Buffer.from(s, 'utf8').toString('base64')
}
