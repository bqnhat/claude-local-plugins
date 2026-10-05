export type CacheTtl = '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      lastResponseAt: number | null
      ttl: CacheTtl | null
      now: number
    }
  }
}
