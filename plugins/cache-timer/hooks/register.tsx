import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderElement } from 'claude-code'
import type { CacheTtl } from '../types'

const lastResponseAt = atom({ plugin: 'cache-timer', key: 'lastResponseAt' } as const, null)
const ttl = atom({ plugin: 'cache-timer', key: 'ttl' } as const, null)
const now = atom({ plugin: 'cache-timer', key: 'now' } as const, 0)

const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const WARN_COLOR = '#D97706'
const EXPIRED_COLOR = '#DC2626'
const STORE_KEY = 'ttl'
const MARGIN_MS = 30_000

let isTicking = false

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function learn(gapMs: number, usage: ModelUsage): CacheTtl | undefined {
  if (gapMs <= TTL_MS['5m'] + MARGIN_MS) return undefined
  if (usage.cache_read_input_tokens > 0) return gapMs < TTL_MS['1h'] ? '1h' : undefined
  if (usage.cache_creation_input_tokens > 0 && gapMs < TTL_MS['1h'] - MARGIN_MS) return '5m'
  return undefined
}

function startTicking($: EngineInterface): void {
  if (isTicking) return
  isTicking = true
  $.clock.every(1000, async () => {
    if ((await read($, lastResponseAt)) === null) return
    const at = await $.clock.now()
    await update($, now, () => at)
  })
}

async function stamp($: EngineInterface, usage: ModelUsage | null | undefined): Promise<void> {
  startTicking($)
  const at = await $.clock.now()
  const last = await read($, lastResponseAt)
  const seen = last === null || !usage ? undefined : learn(at - last, usage)
  if (seen !== undefined && seen !== (await read($, ttl))) {
    await update($, ttl, () => seen)
    await $.store.set(STORE_KEY, seen)
  }
  await update($, lastResponseAt, () => at)
  await update($, now, () => at)
}

async function restoreTtl($: EngineInterface): Promise<void> {
  if ((await read($, ttl)) !== null) return
  const kept = await $.store.get(STORE_KEY)
  if (kept === '5m' || kept === '1h') await update($, ttl, () => kept)
}

export const register: Register = (on, options) => {
  isTicking = false
  const fixedMinutes = typeof options?.ttlMinutes === 'number' && options.ttlMinutes > 0 ? options.ttlMinutes : 0
  const warnMs = (typeof options?.warnMinutes === 'number' && options.warnMinutes >= 0 ? options.warnMinutes : 1) * 60_000

  on('session.start', async ($, e, next) => {
    startTicking($)
    await restoreTtl($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined) await stamp($, result.usage)
    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next): Promise<RenderElement> => {
    const below = await next(e)
    if (e.surface !== 'desktop') return below
    const last = await read($, lastResponseAt)
    if (last === null) return below
    const learned = await read($, ttl)
    const ttlMs = fixedMinutes > 0 ? fixedMinutes * 60_000 : TTL_MS[learned ?? '5m']
    const left = ttlMs - ((await read($, now)) - last)
    const guess = fixedMinutes === 0 && learned === null ? '~' : ''
    const { Box, Text } = $.ui.resolve(e)
    const label =
      left <= 0 && guess !== '' ? (
        <Text key="cache-timer" dimColor>
          Cache ?
        </Text>
      ) : left <= 0 ? (
        <Text key="cache-timer" color={EXPIRED_COLOR}>
          Cache expired
        </Text>
      ) : left <= warnMs ? (
        <Text key="cache-timer" color={WARN_COLOR}>
          {`Cache ${guess}${clock(left)}`}
        </Text>
      ) : (
        <Text key="cache-timer" dimColor>
          {`Cache ${guess}${clock(left)}`}
        </Text>
      )
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {label}
        {below}
      </Box>
    )
  })
}
