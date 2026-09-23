/// <reference path="../../../__typings__/index.d.ts"/>
import fs from 'fs'
import path from 'path'
import { PnpmError } from '@pnpm/error'
import AdmZip from 'adm-zip'
import ssri from 'ssri'
import tempy from 'tempy'
import { downloadAndUnpackZip } from '@pnpm/fetching.binary-fetcher'

// Mock fetch function that returns a ZIP buffer and simulates FetchFromRegistry
function createMockFetch (zipBuffer: Buffer) {
  return () => Promise.resolve({
    body: (async function * () {
      yield zipBuffer
    })(),
  })
}

/**
 * Creates the directory layout the tests extract into.
 *
 * `targetDir` is nested inside a freshly created temporary directory, so that
 * the parent directory an attacker would try to escape into is owned by the
 * test and can be asserted on reliably.
 */
function prepareDirs (): { parentDir: string, targetDir: string } {
  const parentDir = tempy.directory()
  const targetDir = path.join(parentDir, 'target')
  fs.mkdirSync(targetDir, { recursive: true })
  return { parentDir, targetDir }
}

/**
 * Creates a minimal ZIP file with a given entry path (not sanitized).
 * This creates a valid ZIP structure with a single uncompressed file entry.
 *
 * AdmZip's addFile() sanitizes paths automatically, so raw ZIP files have to be
 * assembled by hand in order to test path traversal protection.
 */
function createZipWithEntry (entryPath: string, content: string): Buffer {
  const contentBuf = Buffer.from(content)

  // Local file header (30 bytes + filename)
  const localHeader = Buffer.alloc(30 + entryPath.length)
  localHeader.writeUInt32LE(0x04034B50, 0) // Local file header signature
  localHeader.writeUInt16LE(20, 4) // Version needed to extract
  localHeader.writeUInt16LE(0, 6) // General purpose flags
  localHeader.writeUInt16LE(0, 8) // Compression method (0 = store)
  localHeader.writeUInt16LE(0, 10) // Last mod file time
  localHeader.writeUInt16LE(0, 12) // Last mod file date
  localHeader.writeUInt32LE(0, 14) // CRC-32 (fake but okay for tests)
  localHeader.writeUInt32LE(contentBuf.length, 18) // Compressed size
  localHeader.writeUInt32LE(contentBuf.length, 22) // Uncompressed size
  localHeader.writeUInt16LE(entryPath.length, 26) // Filename length
  localHeader.writeUInt16LE(0, 28) // Extra field length
  localHeader.write(entryPath, 30, 'utf-8') // Filename

  const cdOffset = localHeader.length + contentBuf.length

  // Central directory header (46 bytes + filename)
  const centralDir = Buffer.alloc(46 + entryPath.length)
  centralDir.writeUInt32LE(0x02014B50, 0) // Central file header signature
  centralDir.writeUInt16LE(20, 4) // Version made by
  centralDir.writeUInt16LE(20, 6) // Version needed to extract
  centralDir.writeUInt16LE(0, 8) // General purpose flags
  centralDir.writeUInt16LE(0, 10) // Compression method
  centralDir.writeUInt16LE(0, 12) // Last mod file time
  centralDir.writeUInt16LE(0, 14) // Last mod file date
  centralDir.writeUInt32LE(0, 16) // CRC-32
  centralDir.writeUInt32LE(contentBuf.length, 20) // Compressed size
  centralDir.writeUInt32LE(contentBuf.length, 24) // Uncompressed size
  centralDir.writeUInt16LE(entryPath.length, 28) // Filename length
  centralDir.writeUInt16LE(0, 30) // Extra field length
  centralDir.writeUInt16LE(0, 32) // File comment length
  centralDir.writeUInt16LE(0, 34) // Disk number start
  centralDir.writeUInt16LE(0, 36) // Internal file attributes
  centralDir.writeUInt32LE(0, 38) // External file attributes
  centralDir.writeUInt32LE(0, 42) // Relative offset of local header
  centralDir.write(entryPath, 46, 'utf-8')

  // End of central directory record (22 bytes)
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054B50, 0) // End of central directory signature
  endRecord.writeUInt16LE(0, 4) // Number of this disk
  endRecord.writeUInt16LE(0, 6) // Disk with central directory
  endRecord.writeUInt16LE(1, 8) // Entries on this disk
  endRecord.writeUInt16LE(1, 10) // Total entries
  endRecord.writeUInt32LE(centralDir.length, 12) // Size of central directory
  endRecord.writeUInt32LE(cdOffset, 16) // Offset of central directory
  endRecord.writeUInt16LE(0, 20) // ZIP file comment length

  return Buffer.concat([localHeader, contentBuf, centralDir, endRecord])
}

describe('extractZipToTarget security', () => {
  describe('prefix path traversal (Attack Vector 2)', () => {
    it('should reject prefix with ../ path traversal', async () => {
      const { targetDir } = prepareDirs()
      const zip = new AdmZip()
      zip.addFile('node-v20.0.0/bin/node', Buffer.from('#!/bin/sh\necho "node"'))
      const zipBuffer = zip.toBuffer()
      // Use real integrity so the check passes and we reach path traversal validation
      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await expect(
        downloadAndUnpackZip(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockFetch as any,
          {
            url: 'https://example.com/node.zip',
            integrity,
            basename: `..${path.sep}..${path.sep}evil`,
          },
          targetDir
        )
      ).rejects.toThrow(PnpmError)

      await expect(
        downloadAndUnpackZip(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockFetch as any,
          {
            url: 'https://example.com/node.zip',
            integrity,
            basename: `..${path.sep}..${path.sep}evil`,
          },
          targetDir
        )
      ).rejects.toMatchObject({
        code: 'ERR_PNPM_PATH_TRAVERSAL',
      })
    })

    it('should reject absolute path prefix', async () => {
      const { targetDir } = prepareDirs()
      const zip = new AdmZip()
      zip.addFile('node-v20.0.0/bin/node', Buffer.from('#!/bin/sh\necho "node"'))
      const zipBuffer = zip.toBuffer()
      // Use real integrity so the check passes and we reach path traversal validation
      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await expect(
        downloadAndUnpackZip(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockFetch as any,
          {
            url: 'https://example.com/node.zip',
            integrity,
            basename: '/tmp/evil',
          },
          targetDir
        )
      ).rejects.toMatchObject({
        code: 'ERR_PNPM_PATH_TRAVERSAL',
      })
    })
  })

  describe('ZIP entry path traversal (Attack Vector 1)', () => {
    it('should reject ZIP entries with ../ path traversal', async () => {
      const { parentDir, targetDir } = prepareDirs()
      // A raw malicious entry path. AdmZip sanitizes paths passed to addFile(),
      // so the ZIP is assembled byte by byte instead.
      const zipBuffer = createZipWithEntry('../../../.npmrc', 'registry=https://evil.com/\n')
      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await expect(
        downloadAndUnpackZip(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockFetch as any,
          {
            url: 'https://example.com/node.zip',
            integrity,
            basename: '',
          },
          targetDir
        )
      ).rejects.toMatchObject({
        code: 'ERR_PNPM_PATH_TRAVERSAL',
      })

      // Verify no files were written, neither outside nor inside the target
      expect(fs.existsSync(path.join(parentDir, '.npmrc'))).toBe(false)
      expect(fs.existsSync(path.join(targetDir, '.npmrc'))).toBe(false)
    })

    it('should reject ZIP entries with absolute paths', async () => {
      const { parentDir, targetDir } = prepareDirs()
      // A raw malicious absolute path entry
      const zipBuffer = createZipWithEntry('/etc/passwd', 'root:x:0:0:root:/root:/bin/bash')
      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await expect(
        downloadAndUnpackZip(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockFetch as any,
          {
            url: 'https://example.com/node.zip',
            integrity,
            basename: '',
          },
          targetDir
        )
      ).rejects.toMatchObject({
        code: 'ERR_PNPM_PATH_TRAVERSAL',
      })

      expect(fs.existsSync(path.join(parentDir, 'etc'))).toBe(false)
      expect(fs.existsSync(path.join(targetDir, 'etc'))).toBe(false)
    })

    // Windows-specific: backslash is a path separator only on Windows
    // On Unix, backslash is a valid filename character, so this test only runs on Windows
    const isWindows = process.platform === 'win32'
    const windowsTest = isWindows ? it : it.skip

    windowsTest('should reject ZIP entries with backslash path traversal on Windows', async () => {
      const { targetDir } = prepareDirs()
      // Windows-style backslash path traversal
      const zipBuffer = createZipWithEntry('..\\..\\..\\evil.txt', 'malicious content via backslash')
      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await expect(
        downloadAndUnpackZip(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mockFetch as any,
          {
            url: 'https://example.com/node.zip',
            integrity,
            basename: '',
          },
          targetDir
        )
      ).rejects.toMatchObject({
        code: 'ERR_PNPM_PATH_TRAVERSAL',
      })
    })
  })

  describe('legitimate ZIP extraction', () => {
    it('should successfully extract a normal ZIP file', async () => {
      const { targetDir } = prepareDirs()
      const zip = new AdmZip()
      zip.addFile('node-v20.0.0/bin/node', Buffer.from('#!/bin/sh\necho "node"'))
      zip.addFile('node-v20.0.0/README.md', Buffer.from('# Node.js'))
      const zipBuffer = zip.toBuffer()

      // Create a mock fetch that also passes integrity check by using the actual buffer
      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await downloadAndUnpackZip(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFetch as any,
        {
          url: 'https://example.com/node.zip',
          integrity,
          basename: 'node-v20.0.0',
        },
        targetDir
      )

      // Verify files were extracted correctly
      expect(fs.existsSync(path.join(targetDir, 'bin/node'))).toBe(true)
      expect(fs.existsSync(path.join(targetDir, 'README.md'))).toBe(true)
    })

    it('should handle empty basename correctly', async () => {
      const { targetDir } = prepareDirs()
      const zip = new AdmZip()
      zip.addFile('bin/node', Buffer.from('#!/bin/sh\necho "node"'))
      const zipBuffer = zip.toBuffer()

      const integrity = ssri.fromData(zipBuffer).toString()

      const mockFetch = createMockFetch(zipBuffer)

      await downloadAndUnpackZip(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockFetch as any,
        {
          url: 'https://example.com/node.zip',
          integrity,
          basename: '',
        },
        targetDir
      )

      expect(fs.existsSync(path.join(targetDir, 'bin/node'))).toBe(true)
    })
  })
})
