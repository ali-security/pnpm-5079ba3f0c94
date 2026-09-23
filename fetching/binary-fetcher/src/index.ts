import path from 'path'
import fsPromises from 'fs/promises'
import { PnpmError } from '@pnpm/error'
import { type FetchFromRegistry } from '@pnpm/fetching-types'
import { type BinaryFetcher, type FetchFunction } from '@pnpm/fetcher-base'
import { addFilesFromDir } from '@pnpm/worker'
import AdmZip from 'adm-zip'
import renameOverwrite from 'rename-overwrite'
import tempy from 'tempy'
import ssri from 'ssri'

export function createBinaryFetcher (ctx: {
  fetch: FetchFromRegistry
  fetchFromRemoteTarball: FetchFunction
  rawConfig: Record<string, string>
  offline?: boolean
}): { binary: BinaryFetcher } {
  const fetchBinary: BinaryFetcher = async (cafs, resolution, opts) => {
    if (ctx.offline) {
      throw new PnpmError('CANNOT_DOWNLOAD_BINARY_OFFLINE', `Cannot download binary "${resolution.url}" because offline mode is enabled.`)
    }
    const version = opts.pkg.version!
    const manifest = {
      name: opts.pkg.name!,
      version,
      bin: resolution.bin,
    }

    if (resolution.archive === 'tarball') {
      return {
        ...await ctx.fetchFromRemoteTarball(cafs, {
          tarball: resolution.url,
          integrity: resolution.integrity,
        }, opts),
        manifest,
      }
    }
    if (resolution.archive === 'zip') {
      const tempLocation = await cafs.tempDir()
      await downloadAndUnpackZip(ctx.fetch, {
        url: resolution.url,
        integrity: resolution.integrity,
        basename: resolution.prefix ?? '',
      }, tempLocation)
      return {
        ...await addFilesFromDir({
          storeDir: cafs.storeDir,
          dir: tempLocation,
          filesIndexFile: opts.filesIndexFile,
          readManifest: false,
        }),
        manifest,
      }
    }
    throw new PnpmError('NOT_SUPPORTED_ARCHIVE', `The binary fetcher doesn't support archive type ${resolution.archive as string}`)
  }
  return {
    binary: fetchBinary,
  }
}

export interface AssetInfo {
  url: string
  integrity: string
  basename: string
}

/**
 * Downloads and unpacks a zip file containing a binary asset.
 *
 * @param fetchFromRegistry - Function to fetch resources from registry
 * @param assetInfo - Information about the binary asset
 * @param targetDir - Directory where the binary asset should be installed
 * @throws {PnpmError} When integrity verification fails or extraction fails
 */
export async function downloadAndUnpackZip (
  fetchFromRegistry: FetchFromRegistry,
  assetInfo: AssetInfo,
  targetDir: string
): Promise<void> {
  const tmp = path.join(tempy.directory(), 'pnpm.zip')

  try {
    await downloadWithIntegrityCheck(fetchFromRegistry, assetInfo, tmp)
    await extractZipToTarget(tmp, assetInfo.basename, targetDir)
  } finally {
    // Clean up temporary file
    try {
      await fsPromises.unlink(tmp)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Downloads a file with integrity verification.
 */
async function downloadWithIntegrityCheck (
  fetchFromRegistry: FetchFromRegistry,
  { url, integrity }: AssetInfo,
  tmpPath: string
): Promise<void> {
  const response = await fetchFromRegistry(url)

  // Collect all chunks from the response
  const chunks: Buffer[] = []
  for await (const chunk of response.body!) {
    chunks.push(chunk as Buffer)
  }
  const data = Buffer.concat(chunks)

  try {
    // Verify integrity if provided
    ssri.checkData(data, integrity, { error: true })
  } catch (err) {
    if (!(err instanceof Error) || !('expected' in err) || !('found' in err)) {
      throw err
    }
    throw new PnpmError('TARBALL_INTEGRITY', `Got unexpected checksum for "${url}". Wanted "${err.expected as string}". Got "${err.found as string}".`)
  }

  // Write the verified data to file
  await fsPromises.writeFile(tmpPath, data)
}

/**
 * Extracts a zip file to the target directory.
 *
 * @param zipPath - Path to the zip file
 * @param basename - Base name of the file (without extension)
 * @param targetDir - Directory where contents should be extracted
 * @throws {PnpmError} When extraction fails or path traversal is detected
 */
async function extractZipToTarget (
  zipPath: string,
  basename: string,
  targetDir: string
): Promise<void> {
  const zip = new AdmZip(zipPath)
  const nodeDir = basename === '' ? targetDir : path.dirname(targetDir)

  // Validate basename/prefix doesn't escape the target directory
  if (basename !== '') {
    validatePathSecurity(nodeDir, basename)
  }

  // Extract each entry with path validation to prevent path traversal attacks
  for (const entry of zip.getEntries()) {
    const entryPath = entry.entryName
    validatePathSecurity(nodeDir, entryPath)
    zip.extractEntryTo(entry, nodeDir, true, true)
  }

  const extractedDir = path.join(nodeDir, basename)
  await renameOverwrite(extractedDir, targetDir)
}

/**
 * Validates that a path does not escape the base directory via path traversal.
 *
 * @param basePath - The base directory that should contain the target
 * @param targetPath - The relative path to validate
 * @throws {PnpmError} When path traversal is detected
 */
function validatePathSecurity (basePath: string, targetPath: string): void {
  // Explicitly reject absolute paths - they should never be allowed as prefixes or entry names
  if (path.isAbsolute(targetPath)) {
    throw new PnpmError('PATH_TRAVERSAL',
      `Refusing to extract path "${targetPath}" - absolute paths are not allowed`)
  }
  const normalizedTarget = path.resolve(basePath, targetPath)
  if (!isSubdir(basePath, normalizedTarget) && normalizedTarget !== basePath) {
    throw new PnpmError('PATH_TRAVERSAL',
      `Refusing to extract path "${targetPath}" outside of target directory`)
  }
}

/**
 * Tells whether `dir` is located inside `parentDir`.
 *
 * This is an inlined equivalent of the `is-subdir` package. It relies on
 * `path` only, so on Windows both `/` and `\` are treated as separators and
 * backslash-based traversal is detected just like slash-based traversal.
 */
function isSubdir (parentDir: string, dir: string): boolean {
  const relative = path.relative(parentDir, dir)
  if (relative === '') return false // `dir` is `parentDir` itself, not a subdirectory of it
  // `relative` may only escape `parentDir` when it is exactly ".." or starts
  // with a ".." path segment. A name such as "..foo" stays inside.
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false
  return !path.isAbsolute(relative)
}
