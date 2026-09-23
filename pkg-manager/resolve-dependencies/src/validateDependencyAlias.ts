import { PnpmError } from '@pnpm/error'

// `validate-npm-package-name`'s scoped-name pattern and reserved-name list,
// inlined below.
const SCOPED_PACKAGE_PATTERN = /^(?:@([^/]+?)[/])?([^/]+?)$/
const RESERVED_NAMES = new Set(['node_modules', 'favicon.ico'])

// An alias is the directory name pnpm creates inside `node_modules`, so
// it must be a valid npm package name. Anything else (path-traversal
// shapes such as `@x/../../../../../.git/hooks`, control characters,
// names that collide with pnpm's own `node_modules` layout such as
// `.bin` / `.pnpm` / `node_modules`) is rejected. Matches the
// `validForOldPackages` check `parseWantedDependency` applies to
// CLI-given names. The `validate-npm-package-name` logic is inlined
// here rather than imported, so only the conditions that package treats
// as errors reject a name; the ones it merely warns about (a name longer
// than 214 characters, capital letters, the `~'!()*` characters, core
// module names) stay valid, exactly as `validForOldPackages` does.
export function isValidDependencyAlias (alias: string): boolean {
  if (typeof alias !== 'string') return false
  // "name length must be greater than zero"
  if (alias.length === 0) return false
  // "name cannot start with a period"
  if (/^\./.test(alias)) return false
  // "name cannot start with an underscore"
  if (/^_/.test(alias)) return false
  // "name cannot contain leading or trailing spaces"
  if (alias.trim() !== alias) return false
  // "<name> is a blacklisted name"
  if (RESERVED_NAMES.has(alias.toLowerCase())) return false
  // "name can only contain URL-friendly characters"
  if (encodeURIComponent(alias) !== alias) {
    // Maybe it's a scoped package name, like @user/package.
    const nameMatch = SCOPED_PACKAGE_PATTERN.exec(alias)
    const scope = nameMatch?.[1]
    const name = nameMatch?.[2]
    if (
      scope == null ||
      name == null ||
      encodeURIComponent(scope) !== scope ||
      encodeURIComponent(name) !== name
    ) {
      return false
    }
  }
  return true
}

export function assertValidDependencyAliases (
  deps: Record<string, unknown> | undefined,
  parentPkgDescription: string
): void {
  if (deps == null) return
  for (const alias of Object.keys(deps)) {
    if (!isValidDependencyAlias(alias)) {
      throw new PnpmError(
        'INVALID_DEPENDENCY_NAME',
        `${parentPkgDescription} contains a dependency with an invalid name: ${JSON.stringify(alias)}`,
        {
          hint: 'A dependency name must be a valid npm package name — a single `name` or `@scope/name` consisting of URL-friendly characters, with no leading `.` or `_`, and not equal to reserved names such as `node_modules`.',
        }
      )
    }
  }
}
