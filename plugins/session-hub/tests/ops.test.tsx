import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'
const PLUGIN = 'session-hub'
const PANE = 'session-hub'

const PANE_PROPS = {
  title: 'Progress',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

function world(on: On): MockClock {
  const clock = mock.clock(on)
  on('session.surfaces', async () => ({ value: ['desktop'] }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [{ id: PANE, title: 'Progress', isShown: true, isFocused: false, isPlaced: true }] }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', async () => <></>)
  return clock
}

const call = async ($: Engine, input: Record<string, unknown>) => String((await $.tool.call({ tool: TOOL, ...input })).result)

const TWIN_TITLES = {
  id: 'twin',
  title: 'Twin',
  stages: [
    { name: 'Server', steps: [{ title: 'Tests', status: 'active' }, { title: 'Build', status: 'pending' }] },
    { name: 'Client', steps: [{ title: 'Tests', status: 'pending' }, { title: 'Ship', status: 'pending' }] },
  ],
}

async function atSecondTests($: Engine) {
  await call($, TWIN_TITLES)
  await call($, { id: 'twin', next: true })
  expect(await call($, { id: 'twin', next: true })).toBe('twin: 2/4, running, active "Tests"')
}

const pane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })

async function rowKeys($: Engine): Promise<string[]> {
  const ui = await pane($)
  const keys = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('row-'))
  await ui.unmount()
  return keys
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

async function rowText($: Engine, id: string): Promise<string> {
  const ui = await pane($)
  const row = await ui.find({ type: 'Box', key: `row-${id}` })
  await ui.unmount()
  return row ? flat(row) : ''
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('short updates when two steps share a title', () => {
  test('active names the open step, not the finished one with the same title', async ($, on) => {
    world(on)
    await atSecondTests($)

    expect(await call($, { id: 'twin', active: 'Tests' })).toBe('twin: 2/4, running, active "Tests"')
  })

  test('done finishes the open step with that title', async ($, on) => {
    world(on)
    await atSecondTests($)

    expect(await call($, { id: 'twin', done: ['Tests'] })).toBe('twin: 3/4, running')
  })

  test('failed marks the open step, leaving the finished one green', async ($, on) => {
    world(on)
    await atSecondTests($)

    expect(await call($, { id: 'twin', failed: 'Tests', note: 'red' })).toBe('twin: 2/4, error')
  })

  test('two titles in one done list finish both twins in order', async ($, on) => {
    world(on)
    await call($, { ...TWIN_TITLES, id: 'both' })

    expect(await call($, { id: 'both', done: ['Tests', 'Build', 'Tests'], active: 'Ship' })).toBe('both: 3/4, running, active "Ship"')
  })
})

describe('text cut to length', () => {
  test('a title cut at its limit never splits an emoji into a lone surrogate', async ($, on) => {
    world(on)
    const long = `${'x'.repeat(119)}🚀 tail`
    const result = await call($, { id: 'cut', title: 'Cut', stages: [{ name: 'Work', steps: [{ title: long, status: 'active' }] }] })

    expect(LONE_SURROGATE.test(result)).toBe(false)
    expect(result).toContain(`${'x'.repeat(119)}🚀"`)
  })
})

describe('an id used again after its bar finished', () => {
  test('a new breakdown under a finished, hidden id shows as a fresh bar timed from now', async ($, on) => {
    const clock = world(on)
    await call($, TWIN_TITLES)
    await call($, { id: 'twin', state: 'done' })
    const ui = await pane($)
    await ui.press({ key: 'hide-done' })
    await ui.unmount()
    expect(await rowKeys($)).toEqual([])

    await clock.advance(2 * 3_600_000)
    expect(await call($, TWIN_TITLES)).toBe('twin: 0/4, running, active "Tests"')

    expect(await rowKeys($)).toEqual(['row-twin'])
    expect(await rowText($, 'twin')).not.toContain('2h')
  })

  test('a short update to a hidden bar that is still running keeps it hidden', async ($, on) => {
    world(on)
    await call($, TWIN_TITLES)
    const ui = await pane($)
    await ui.press({ key: 'toggle-twin' })
    await ui.unmount()
    const again = await pane($)
    await again.press({ key: 'close-twin' })
    await again.unmount()

    expect(await call($, { id: 'twin', next: true })).toBe('twin: 1/4, running, active "Build"')
    expect(await rowKeys($)).toEqual([])
  })
})
