import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'

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
  on('ui.render', async () => <></>)
  on('ui.toast', async () => ({ value: undefined }))
  on('audio.play', async () => ({ value: undefined }))
  return clock
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

const MARK_STATE: Record<string, string> = { '#1D9E75': 'done', '#8B7CF6': 'active', '#E09A1E': 'waiting', '#E5484D': 'failed', '#8A8984': 'pending' }

const markOf = (node: unknown): string => {
  if (node === null || typeof node !== 'object') return ''
  const one = node as { type?: unknown; props?: { source?: unknown }; children?: unknown }
  if (one.type === 'Svg') return MARK_STATE[/fill="(#[0-9A-F]{6})"/.exec(String(one.props?.source))?.[1] ?? ''] ?? '?'
  return one.type === 'Text' ? flat(one) : ''
}

async function stepLine($: Engine, key: string): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'session-hub', surface: 'desktop', component: 'Pane', requestId: 'session-hub', props: PANE_PROPS })
  if (!(await ui.find({ type: 'Box', key: 'detail-bar' }))) await ui.press({ key: 'toggle-bar' })
  const row = await ui.find({ type: 'Box', key })
  const texts: unknown[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const one = node as { type?: unknown; children?: unknown }
    if (one.type === 'Text' || (one.type === 'Svg' && !key.startsWith('stage-'))) texts.push(one)
    else if (Array.isArray(one.children)) one.children.forEach(walk)
  }
  walk(row)
  const line = texts.map((one, i) => (i === 0 ? markOf(one) : flat(one))).join('|')
  await ui.unmount()
  return line
}

const BAR = {
  id: 'bar',
  title: 'Bar',
  stages: [
    { name: 'Read', steps: [{ title: 'First', status: 'active', substeps: [{ title: 'Part', status: 'active' }] }, { title: 'Second', status: 'pending' }] },
    { name: 'Ship', steps: [{ title: 'Third', status: 'pending' }] },
  ],
}

describe('time on each step', () => {
  test('a finished step shows how long it ran, the active one counts on with an ellipsis', async ($, on) => {
    const clock = world(on)
    await $.tool.call({ tool: TOOL, ...BAR })
    await clock.advance(65_000)
    await $.tool.call({ tool: TOOL, id: 'bar', next: true })
    await clock.advance(12_000)

    expect(await stepLine($, 'step-bar-0-0')).toBe('done|First|1m 5s')
    expect(await stepLine($, 'step-bar-0-1')).toBe('active|Second|12s…')
    expect(await stepLine($, 'step-bar-1-0')).toBe('pending|Third')
  })

  test('a stage adds up its steps, and a step marked done without being started runs from the one before', async ($, on) => {
    const clock = world(on)
    await $.tool.call({ tool: TOOL, ...BAR })
    await clock.advance(30_000)
    await $.tool.call({ tool: TOOL, id: 'bar', done: ['First', 'Second'], active: 'Third' })
    await clock.advance(5_000)

    expect(await stepLine($, 'step-bar-0-0')).toBe('done|First|30s')
    expect(await stepLine($, 'step-bar-0-1')).toBe('done|Second')
    expect(await stepLine($, 'stage-bar-0')).toBe('Read|30s')
    expect(await stepLine($, 'stage-bar-1')).toBe('Ship|5s')
  })

  test('a restructured bar keeps the times of the steps it kept', async ($, on) => {
    const clock = world(on)
    await $.tool.call({ tool: TOOL, ...BAR })
    await clock.advance(40_000)
    await $.tool.call({ tool: TOOL, id: 'bar', next: true })
    await clock.advance(10_000)
    await $.tool.call({
      tool: TOOL,
      id: 'bar',
      stages: [{ name: 'Read', steps: [{ title: 'First', status: 'done' }, { title: 'Second', status: 'done' }, { title: 'Extra', status: 'active' }] }],
    })

    expect(await stepLine($, 'step-bar-0-0')).toBe('done|First|40s')
    expect(await stepLine($, 'step-bar-0-1')).toBe('done|Second|10s')
  })

  test('an update that leaves the active step in place keeps its start', async ($, on) => {
    const clock = world(on)
    await $.tool.call({ tool: TOOL, ...BAR })
    await clock.advance(10_000)
    await $.tool.call({ tool: TOOL, id: 'bar', state: 'needs_input', note: 'Which one?' })
    await clock.advance(5_000)

    expect(await stepLine($, 'step-bar-0-0')).toBe('waiting|First|15s…')
  })

  test('a substep keeps its own time under its step', async ($, on) => {
    const clock = world(on)
    await $.tool.call({ tool: TOOL, ...BAR })
    await clock.advance(20_000)

    expect(await stepLine($, 'sub-bar-0-0-0')).toBe('active|Part|20s…')
  })

  test('a substep started later than its step counts from its own start', async ($, on) => {
    const clock = world(on)
    const pending = { ...BAR, stages: [{ name: 'Read', steps: [{ title: 'First', status: 'active', substeps: [{ title: 'Part', status: 'pending' }] }] }] }
    await $.tool.call({ tool: TOOL, ...pending })
    await clock.advance(10_000)
    await $.tool.call({ tool: TOOL, ...pending, stages: [{ name: 'Read', steps: [{ title: 'First', status: 'active', substeps: [{ title: 'Part', status: 'active' }] }] }] })
    await clock.advance(5_000)

    expect(await stepLine($, 'sub-bar-0-0-0')).toBe('active|Part|5s…')
    expect(await stepLine($, 'step-bar-0-0')).toBe('active|First|15s…')
  })

  test('next:true finishes the substeps of the step it closes, at the time the step ends', async ($, on) => {
    const clock = world(on)
    const parts = { ...BAR, stages: [{ name: 'Read', steps: [{ title: 'First', status: 'active', substeps: [{ title: 'Part', status: 'active' }, { title: 'Tail', status: 'pending' }] }, { title: 'Second', status: 'pending' }] }] }
    await $.tool.call({ tool: TOOL, ...parts })
    await clock.advance(30_000)
    await $.tool.call({ tool: TOOL, id: 'bar', next: true })
    await clock.advance(60_000)

    expect(await stepLine($, 'step-bar-0-0')).toBe('done|First|30s')
    expect(await stepLine($, 'sub-bar-0-0-0')).toBe('done|Part|30s')
    expect(await stepLine($, 'sub-bar-0-0-1')).toBe('done|Tail')
  })

  test('done and a later active finish the substeps of the steps they close', async ($, on) => {
    const clock = world(on)
    const parts = {
      ...BAR,
      stages: [
        {
          name: 'Read',
          steps: [
            { title: 'First', status: 'active', substeps: [{ title: 'Part', status: 'pending' }] },
            { title: 'Second', status: 'pending', substeps: [{ title: 'Bit', status: 'pending' }] },
            { title: 'Third', status: 'pending' },
          ],
        },
      ],
    }
    await $.tool.call({ tool: TOOL, ...parts })
    await clock.advance(10_000)
    await $.tool.call({ tool: TOOL, id: 'bar', active: 'Second' })
    await clock.advance(10_000)
    await $.tool.call({ tool: TOOL, id: 'bar', done: ['Second'], active: 'Third' })

    expect(await stepLine($, 'sub-bar-0-0-0')).toBe('done|Part|10s')
    expect(await stepLine($, 'sub-bar-0-1-0')).toBe('done|Bit|10s')
  })

  test('a substep closed after its step never shows more time than the step', async ($, on) => {
    const clock = world(on)
    const open = { ...BAR, stages: [{ name: 'Read', steps: [{ title: 'First', status: 'active', substeps: [{ title: 'Part', status: 'pending' }] }, { title: 'Second', status: 'pending' }] }] }
    await $.tool.call({ tool: TOOL, ...open })
    await clock.advance(24_000)
    await $.tool.call({ tool: TOOL, id: 'bar', stages: [{ name: 'Read', steps: [{ title: 'First', status: 'done', substeps: [{ title: 'Part', status: 'pending' }] }, { title: 'Second', status: 'active' }] }] })
    await clock.advance(240_000)
    await $.tool.call({ tool: TOOL, id: 'bar', state: 'done' })

    expect(await stepLine($, 'step-bar-0-0')).toBe('done|First|24s')
    expect(await stepLine($, 'sub-bar-0-0-0')).toBe('done|Part|24s')
  })

  test('a step sent back to pending loses its times', async ($, on) => {
    const clock = world(on)
    await $.tool.call({ tool: TOOL, ...BAR })
    await clock.advance(20_000)
    await $.tool.call({ tool: TOOL, id: 'bar', next: true })
    await $.tool.call({ tool: TOOL, id: 'bar', stages: [{ name: 'Read', steps: [{ title: 'First', status: 'pending' }, { title: 'Second', status: 'active' }] }] })

    expect(await stepLine($, 'step-bar-0-0')).toBe('pending|First')
  })
})
