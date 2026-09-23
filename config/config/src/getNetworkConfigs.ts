import { type SslConfig } from '@pnpm/types'
import normalizeRegistryUrl from 'normalize-registry-url'
import fs from 'fs'

export interface GetNetworkConfigsResult {
  sslConfigs: Record<string, SslConfig>
  registries: Record<string, string>
}

export function getNetworkConfigs (rawConfig: Record<string, object>): GetNetworkConfigsResult {
  // Get all the auth options that have :certfile or :keyfile in their name
  const sslConfigs: Record<string, SslConfig> = {}
  const registries: Record<string, string> = {}
  for (const [configKey, value] of Object.entries(rawConfig)) {
    if (configKey[0] === '@' && configKey.endsWith(':registry')) {
      registries[configKey.slice(0, configKey.indexOf(':'))] = normalizeRegistryUrl(value as unknown as string)
    } else if (configKey.includes(':certfile') || configKey.includes(':keyfile') || configKey.includes(':cafile')) {
      // Split by '/:' because the registry may contain a port
      const registry = configKey.split('/:')[0] + '/'
      if (!sslConfigs[registry]) {
        sslConfigs[registry] = { cert: '', key: '' }
      }
      if (configKey.includes(':certfile')) {
        sslConfigs[registry].cert = fs.readFileSync(value as unknown as string, 'utf8')
      } else if (configKey.includes(':keyfile')) {
        sslConfigs[registry].key = fs.readFileSync(value as unknown as string, 'utf8')
      } else if (configKey.includes(':cafile')) {
        sslConfigs[registry].ca = fs.readFileSync(value as unknown as string, 'utf8')
      }
    } else if (configKey.startsWith('//') && (configKey.endsWith('/:cert') || configKey.endsWith('/:key'))) {
      // Inline PEM variants of the client certificate settings. Unscoped
      // `cert`/`key` are pinned to their source's registry at load time (see
      // rescopeUnscopedCreds), which turns them into these URL-scoped keys,
      // so they have to be read back here to still reach the TLS layer.
      const registry = configKey.split('/:')[0] + '/'
      if (!sslConfigs[registry]) {
        sslConfigs[registry] = { cert: '', key: '' }
      }
      if (configKey.endsWith('/:cert')) {
        sslConfigs[registry].cert = value as unknown as string
      } else {
        sslConfigs[registry].key = value as unknown as string
      }
    }
  }
  return {
    registries,
    sslConfigs,
  }
}
