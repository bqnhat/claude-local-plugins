import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PLUGIN = 'session-hub'
const PANE = 'session-hub'
const PANE_PROPS = {
  title: 'Mod status',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 80 },
  view: {},
}

type Usage = { read: number; write: number; fresh: number }
type World = { clock: MockClock; usage: Usage; model: string; isPaneUp: boolean }

function world(on: On, surfaces: RenderSurface[] = ['desktop'], model = 'claude-sonnet-5-5'): World {
  const w: World = { clock: mock.clock(on), usage: { read: 0, write: 0, fresh: 0 }, model, isPaneUp: false }
  mock.store(on, {})
  on('session.surfaces', async () => ({ value: surfaces }))
  on('session.messages', async () => ({ value: [] }))
  on('session.cwd', async () => ({ value: 'C:\\work\\app' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } as never }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', async () => {
    w.isPaneUp = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: w.isPaneUp ? [{ id: PANE, title: 'Mod status', isShown: true, isFocused: false, isPlaced: true, plugin: PLUGIN }] : [] }))
  on('ui.toast', async () => ({ value: undefined }))
  on('agent.list', async () => ({ value: [] }))
  on('ui.render', async () => <></>)
  on('turn.step', async function* (_$, e) {
    const u = w.usage
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: u.fresh, output_tokens: 10, cache_read_input_tokens: u.read, cache_creation_input_tokens: u.write, model: w.model },
    } as never
  })
  return w
}

async function request($: Engine, w: World, turnId: string, usage: Usage, agentId?: string) {
  w.usage = usage
  const stream = $.turn.step({ turnId, index: 0, model: w.model, messageCount: 1, ...(agentId === undefined ? {} : { agentId }) } as never)
  for await (const _chunk of stream) {
  }
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

const cells = (node: unknown): string[] => {
  if (node === null || typeof node !== 'object') return []
  const one = node as { type?: unknown; children?: unknown }
  if (one.type === 'Text') return [flat(one)]
  return Array.isArray(one.children) ? one.children.flatMap(cells) : []
}

const mountPane = ($: Engine, surface: RenderSurface = 'desktop') => $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })

async function press($: Engine, key: string) {
  const ui = await mountPane($)
  await ui.press({ key })
  await ui.unmount()
}

async function texts($: Engine, surface: RenderSurface = 'desktop'): Promise<string[]> {
  const ui = await mountPane($, surface)
  const lines = (await ui.findAll({ type: 'Text' })).map(flat)
  await ui.unmount()
  return lines
}

async function tableRows($: Engine): Promise<string[]> {
  const ui = await mountPane($)
  const rows = (await ui.findAll({ type: 'Box' })).filter(box => String(box.key ?? '').startsWith('cache-row-'))
  const lines = rows.map(row => cells(row).join(' '))
  await ui.unmount()
  return lines
}

describe('the Cache section of Mod status', () => {
  test('sits last on the rail and says so before the first request', async ($, on) => {
    world(on)
    const ui = await mountPane($)
    expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['Progress · selected', 'Next steps', 'Skills & agents', 'Cache'])
    await ui.press({ key: 'rail-cache' })
    await ui.unmount()

    expect(await texts($)).toContain('No requests yet. The first one writes the cache.')
  })

  test('the terminal keeps its three tabs and has no Cache tab', async ($, on) => {
    world(on, ['terminal'])
    const ui = await mountPane($, 'terminal')
    const labels = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))
    await ui.unmount()
    expect(labels).toEqual(['Progress', 'Next steps', 'Skills & agents'])
  })

  test('counts each main-loop request under its turn and leaves subagent requests out', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 0, write: 50_000, fresh: 200 })
    await request($, w, 't1', { read: 50_000, write: 1000, fresh: 100 })
    await request($, w, 't1', { read: 0, write: 30_000, fresh: 10 }, 'agent-1')
    await w.clock.advance(60_000)
    await request($, w, 't2', { read: 80_000, write: 1000, fresh: 300 })

    expect(await tableRows($)).toEqual(['2 1 80k 1k 300 98%', '1 2 50k 51k 300 49%'])
    const lines = await texts($)
    expect(lines).toContain('Session totals · 2 turns · 3 requests')
    expect(lines).toContain('71% hit')
  })

  test('the last request shows what it read, wrote and sent new, with its hit rate', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 80_000, write: 1000, fresh: 300 })

    const lines = await texts($)
    expect(['read 80k', 'wrote 1k', 'new 300', '98%'].filter(one => !(lines).includes(one))).toEqual([])
    const ui = await mountPane($)
    const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
    await ui.unmount()
    expect(alts).toContain('read 80k, wrote 1k, new 300')
    expect(alts.some(alt => alt.startsWith('Tokens per turn and hit rate'))).toBe(true)
  })

  test('the chart and table show the last twelve turns while the totals keep the whole session', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    for (let i = 1; i <= 14; i++) await request($, w, `t${i}`, { read: 1000, write: 0, fresh: 0 })

    const rows = await tableRows($)
    expect(rows).toHaveLength(12)
    expect(rows[0]?.startsWith('14 ')).toBe(true)
    expect(rows[11]?.startsWith('3 ')).toBe(true)
    expect(await texts($)).toContain('Session totals · 14 turns · 14 requests')
  })

  test('the table columns shrink to a narrow pane while the turn number keeps its room', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 1_770_000, write: 34_700, fresh: 26 })

    const ui = await mountPane($)
    const boxes = await ui.findAll({ type: 'Box' })
    await ui.unmount()
    const numbers = boxes.filter(box => /^cache-(th|steps|read|write|new|hit)-/.test(String(box.key ?? '')))
    expect(numbers.length).toBeGreaterThan(0)
    for (const box of numbers) expect(box.props).toMatchObject({ flexShrink: 1, minWidth: 0 })
    const turnCells = boxes.filter(box => box.props.width === 4)
    expect(turnCells.length).toBeGreaterThanOrEqual(2)
    for (const box of turnCells) expect(box.props.flexShrink).toBe(0)
  })

  test('the head keeps the cache time whole and lets the view tabs drop below it in a narrow pane', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 1000, write: 0, fresh: 0 })

    const ui = await mountPane($)
    const head = await ui.find({ type: 'Box', key: 'cache-head' })
    const ttl = await ui.find({ type: 'Box', key: 'cache-head-ttl' })
    await ui.unmount()
    expect(head?.props.flexWrap).toBe('wrap')
    expect(ttl?.props.flexShrink).toBe(0)
    expect((await texts($)).some(line => / cache( · |$)/.test(line) && line.includes('turn'))).toBe(false)
  })

  test('Savings switches the view, works out what the cache saved, and the choice stays', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 100_000, write: 10_000, fresh: 0 })
    await press($, 'cache-view-savings')

    const lines = await texts($)
    expect(['Saved by reads', '≈ 90k', 'Extra for writes', '≈ 2.5k', 'Net saved', '≈ 87.5k', '≈ 80% of input'].filter(one => !(lines).includes(one))).toEqual([])
    expect(lines).not.toContain('Session totals · 1 turn · 1 request')
    expect(await texts($)).toContain('Saved by reads')

    await press($, 'cache-view-tokens')
    expect(await texts($)).toContain('Session totals · 1 turn · 1 request')
  })

  test('a one-hour cache counts writes at twice the input price', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 0, write: 10_000, fresh: 0 })
    await w.clock.advance(10 * 60_000)
    await request($, w, 't2', { read: 100_000, write: 0, fresh: 0 })
    await press($, 'cache-view-savings')

    const lines = await texts($)
    expect(['≈ 10k', 'wrote × 1'].filter(one => !lines.includes(one))).toEqual([])
  })

  test('reads on a model without its own cache price save 0.9 of the input price', async ($, on) => {
    const w = world(on, ['desktop'], 'claude-sonnet-5-5')
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 100_000, write: 0, fresh: 0 })
    await press($, 'cache-view-savings')

    const lines = await texts($)
    expect(['≈ 90k', 'read × 0.9'].filter(one => !lines.includes(one))).toEqual([])
  })

  test('reads on Claude Opus 5.5 save 0.95 of the input price', async ($, on) => {
    const w = world(on, ['desktop'], 'claude-opus-5-5')
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 100_000, write: 10_000, fresh: 0 })
    await press($, 'cache-view-savings')

    const lines = await texts($)
    expect(['≈ 95k', 'read × 0.95', '≈ 2.5k', '≈ 92.5k', '≈ 84% of input'].filter(one => !lines.includes(one))).toEqual([])
  })

  test('reads on Claude Fable 5.1 and Claude Mythos 5.1 save 0.975 of the input price', async ($, on) => {
    const w = world(on, ['desktop'], 'claude-fable-5-1')
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 100_000, write: 0, fresh: 0 })
    w.model = 'claude-mythos-5-1'
    await request($, w, 't2', { read: 100_000, write: 10_000, fresh: 0 })
    await press($, 'cache-view-savings')

    const lines = await texts($)
    expect(['≈ 195k', 'read × 0.975', '≈ 2.5k', '≈ 193k', '≈ 92% of input'].filter(one => !lines.includes(one))).toEqual([])
  })

  test('a session that switches models counts each request at its own model price', async ($, on) => {
    const w = world(on, ['desktop'], 'claude-opus-5-5')
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 100_000, write: 0, fresh: 0 })
    w.model = 'claude-sonnet-5-5'
    await request($, w, 't2', { read: 100_000, write: 0, fresh: 0 })
    await press($, 'cache-view-savings')

    const lines = await texts($)
    expect(['≈ 185k', 'read × 0.925'].filter(one => !lines.includes(one))).toEqual([])
  })

  test('/clear starts the numbers over', async ($, on) => {
    const w = world(on)
    await press($, 'rail-cache')
    await request($, w, 't1', { read: 80_000, write: 1000, fresh: 300 })
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } } as never)

    expect(await texts($)).toContain('No requests yet. The first one writes the cache.')
  })

  test('the cache countdown in the footer opens the Cache section', async ($, on) => {
    const w = world(on)
    await request($, w, 't1', { read: 80_000, write: 1000, fresh: 300 })
    const footer = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
    await footer.press({ key: 'hub-cache-chip' })
    await footer.unmount()

    expect(await texts($)).toContain('Cache')
    expect(await tableRows($)).toEqual(['1 1 80k 1k 300 98%'])
  })
})
