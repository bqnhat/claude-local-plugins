import { describe, expect, mock, test } from 'claude-code/testing'
import type { ModelUsage, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'
const PLUGIN = 'session-hub'
const LONG_CLOCK = { timeoutMs: 15_000 }
const USAGE: ModelUsage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 100 }
const PANE_PROPS = { title: 'Mod status', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
const TASK = { title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }] }

type World = { clock: MockClock; footerDraws: number; sectionReads: number; cacheReads: number; surfaceQueries: number }

function world(on: On): World {
  const w: World = { clock: mock.clock(on), footerDraws: 0, sectionReads: 0, cacheReads: 0, surfaceQueries: 0 }
  mock.store(on, {})
  on('state.get', async ($, e, next) => {
    if (e.plugin === PLUGIN && e.key === 'section') w.sectionReads += 1
    if (e.plugin === PLUGIN && (e.key === 'lastResponseAt' || e.key === 'cacheLabel')) w.cacheReads += 1
    return next(e)
  })
  on('session.surfaces', async () => {
    w.surfaceQueries += 1
    return { value: ['desktop'] }
  })
  on('session.messages', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('agent.spawn', async (_$, e) => ({ model: 'test-model', agentId: `agent-${e.tool_use_id}` }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  on('ui.render', { component: 'SessionMode' }, async () => {
    w.footerDraws += 1
    return <></>
  })
  on('ui.render', async () => <></>)
  return w
}

async function respond($: Engine) {
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'test-model', messageCount: 1 } as never)
  for await (const _chunk of stream) {
  }
}

async function minute($: Engine, w: World, seconds = 60): Promise<World> {
  const footer = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PLUGIN, props: PANE_PROPS } as never)
  w.footerDraws = 0
  w.sectionReads = 0
  w.cacheReads = 0
  w.surfaceQueries = 0
  for (let i = 0; i < seconds; i++) await w.clock.advance(1000)
  await footer.unmount()
  await pane.unmount()
  return w
}

describe('redraws while nothing happens', () => {
  test('a minute with a live bar and a warm cache redraws the footer once and the pane twice', LONG_CLOCK, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL, id: 'task', ...TASK })
    await respond($)
    await minute($, w)

    expect(w.footerDraws).toBeLessThanOrEqual(1)
    expect(w.sectionReads).toBeLessThanOrEqual(2)
  })

  test('a minute with an agent running redraws the pane every five seconds, not every second', LONG_CLOCK, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL, id: 'task', ...TASK })
    await respond($)
    await $.agent.spawn({ tool_use_id: 'use-1', prompt: 'look around', description: 'Scout', subagentType: 'Explore', parentModel: 'test-model', provider: { kind: 'engine' } } as never)
    await minute($, w)

    expect(w.sectionReads).toBeGreaterThan(0)
    expect(w.sectionReads).toBeLessThanOrEqual(13)
  })

  test('once the cache has lapsed and nothing is live, ten idle minutes leave the cache state alone and draw nothing', LONG_CLOCK, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await respond($)
    await w.clock.advance(6 * 60_000)
    await minute($, w, 600)

    expect(w.cacheReads).toBe(0)
    expect(w.footerDraws).toBe(0)
    expect(w.sectionReads).toBe(0)
  })

  test('a response after the cache lapsed starts the countdown again', LONG_CLOCK, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await respond($)
    await w.clock.advance(6 * 60_000)
    await respond($)
    await minute($, w, 90)

    expect(w.footerDraws).toBe(1)
  })

  test('an idle session asks for its surfaces at most once every ten seconds', LONG_CLOCK, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await $.tool.call({ tool: TOOL, id: 'task', ...TASK })
    await respond($)
    await minute($, w, 600)

    expect(w.surfaceQueries).toBeLessThanOrEqual(60)
  })
})
