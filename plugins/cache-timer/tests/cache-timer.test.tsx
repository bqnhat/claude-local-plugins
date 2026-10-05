import { describe, expect, mock, test } from 'claude-code/testing'
import type { ModelUsage, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PLUGIN = 'cache-timer'
const WARM: ModelUsage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 100 }
const COLD: ModelUsage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 50_000 }

type World = { clock: MockClock; usage: ModelUsage }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { clock: mock.clock(on), usage: WARM }
  mock.store(on, store)
  on('ui.render', async () => <></>)
  on('session.start', async (_$, e) => e as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: w.usage } as never
  })
  return w
}

async function step($: Engine, w: World, usage: ModelUsage, agentId?: string) {
  w.usage = usage
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'test-model', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)
  for await (const _chunk of stream) {
  }
}

async function footer($: Engine, surface: 'desktop' | 'terminal' = 'desktop'): Promise<{ text: string; color: unknown; dim: unknown } | undefined> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: [] } })
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  const one = all.find(t => String(t.text).startsWith('Cache'))
  return one === undefined ? undefined : { text: String(one.text), color: one.props.color, dim: one.props.dimColor }
}

describe('the cache countdown in the Desktop footer', () => {
  test('a lifetime learned in an earlier session is used from the start', async ($, on) => {
    const w = world(on, { ttl: '1h' })
    await $.session.start({ cwd: '/work' } as never)
    await step($, w, COLD)
    expect((await footer($))?.text).toBe('Cache 60:00')
  })

  test('nothing shows before the first model response', async ($, on) => {
    world(on)
    expect(await footer($)).toBeUndefined()
  })

  test('before the lifetime is known it assumes five minutes and says so with ~, then a question mark', async ($, on) => {
    const w = world(on)
    await step($, w, COLD)
    expect(await footer($)).toEqual({ text: 'Cache ~5:00', color: undefined, dim: true })

    await w.clock.advance(11_000)
    expect((await footer($))?.text).toBe('Cache ~4:49')

    await w.clock.advance(5 * 60_000)
    expect(await footer($)).toEqual({ text: 'Cache ?', color: undefined, dim: true })
  })

  test('a cache read after more than five idle minutes teaches it the one-hour lifetime', async ($, on) => {
    const w = world(on)
    await step($, w, COLD)
    await w.clock.advance(10 * 60_000)
    await step($, w, WARM)

    expect((await footer($))?.text).toBe('Cache 60:00')
  })

  test('a full rewrite after more than five idle minutes teaches it the five-minute lifetime', async ($, on) => {
    const w = world(on, { ttl: '1h' })
    await $.session.start({ cwd: '/work' } as never)
    await step($, w, WARM)
    await w.clock.advance(10 * 60_000)
    await step($, w, COLD)

    expect((await footer($))?.text).toBe('Cache 5:00')
  })

  test('a short gap teaches nothing, whatever the cache did', async ($, on) => {
    const w = world(on)
    await step($, w, COLD)
    await w.clock.advance(2 * 60_000)
    await step($, w, COLD)
    expect((await footer($))?.text).toBe('Cache ~5:00')
  })

  test('the last minute turns orange and a lapsed known lifetime says expired in red', async ($, on) => {
    const w = world(on, { ttl: '1h' })
    await $.session.start({ cwd: '/work' } as never)
    await step($, w, WARM)
    await w.clock.advance(59 * 60_000)
    expect(await footer($)).toEqual({ text: 'Cache 1:00', color: '#D97706', dim: undefined })

    await w.clock.advance(60_000)
    expect(await footer($)).toEqual({ text: 'Cache expired', color: '#DC2626', dim: undefined })
  })

  test('a subagent request never restarts the countdown', async ($, on) => {
    const w = world(on, { ttl: '1h' })
    await $.session.start({ cwd: '/work' } as never)
    await step($, w, WARM)
    await w.clock.advance(10 * 60_000)
    await step($, w, WARM, 'agent-1')
    expect((await footer($))?.text).toBe('Cache 50:00')
  })

  test('the terminal footer is left as it was', async ($, on) => {
    const w = world(on)
    await step($, w, WARM)
    expect(await footer($, 'terminal')).toBeUndefined()
  })
})
