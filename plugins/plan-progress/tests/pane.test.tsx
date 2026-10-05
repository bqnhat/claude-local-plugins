import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptOrigin, RenderSurface, SessionMessage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__plan-progress__plan_progress'
const PLUGIN = 'plan-progress'
const PANE = 'plan-progress'

const PANE_PROPS = {
  title: 'Progress',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

type World = {
  clock: MockClock
  panes: Set<string>
  behind: Set<string>
  opens: string[]
  closes: string[]
  surfaces: RenderSurface[]
  transcript: SessionMessage[]
  isUnplaced: boolean
  paneReads: number
}

function world(on: On, surfaces: RenderSurface[] = ['desktop']): World {
  const w: World = { clock: mock.clock(on), panes: new Set(), behind: new Set(), opens: [], closes: [], surfaces, transcript: [], isUnplaced: false, paneReads: 0 }
  on('session.surfaces', async () => ({ value: w.surfaces }))
  on('session.messages', async () => ({ value: w.transcript }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', async (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', async (_$, e) => ({ clientId: e.clientId }))
  on('ui.open', async (_$, e) => {
    w.panes.add(e.id)
    w.opens.push(e.id)
    return { value: w.isUnplaced ? { isPlaced: false as const, reason: 'this surface places no panes' } : { isPlaced: true as const } }
  })
  on('ui.close', async (_$, e) => {
    w.panes.delete(e.id)
    w.behind.delete(e.id)
    w.closes.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => {
    w.paneReads += 1
    return { value: [...w.panes].map(id => ({ id, title: 'Progress', isShown: !w.behind.has(id), isFocused: false, isPlaced: !w.isUnplaced })) }
  })
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('command.run', async () => ({ text: '' }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('agent.spawn', async (_$, e) => ({ model: 'test-model', agentId: `agent-${e.tool_use_id}` }))
  on('ui.render', async () => <></>)
  return w
}

const TASK = { title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }] }

const create = ($: Engine, id: string, title = id) => $.tool.call({ tool: TOOL, id, ...TASK, title })

const finish = ($: Engine, id: string) => $.tool.call({ tool: TOOL, id, state: 'done' })

const pane = ($: Engine, props: Partial<typeof PANE_PROPS> = {}) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, ...props } })

async function rows($: Engine): Promise<string[]> {
  const ui = await pane($)
  const keys = (await ui.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('row-'))
  await ui.unmount()
  return keys.map(key => key.slice('row-'.length))
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

async function texts($: Engine): Promise<string[]> {
  const ui = await pane($)
  const all = (await ui.findAll({ type: 'Text' })).map(flat)
  await ui.unmount()
  return all
}

async function buttons($: Engine): Promise<Record<string, unknown>> {
  const ui = await pane($)
  const all = Object.fromEntries((await ui.findAll({ type: 'Button' })).map(one => [one.key ?? '', one.props.label]))
  await ui.unmount()
  return all
}

async function svgSource($: Engine, alt: string, props: Partial<typeof PANE_PROPS> = {}): Promise<string | undefined> {
  const ui = await pane($, props)
  const svg = (await ui.findAll({ type: 'Svg' })).find(one => String(one.props.alt).startsWith(alt))
  await ui.unmount()
  return svg === undefined ? undefined : String(svg.props.source)
}

async function press($: Engine, key: string) {
  const ui = await pane($)
  await ui.press({ key })
  await ui.unmount()
}

async function personTurn($: Engine, turnId: string) {
  const origin: PromptOrigin = { kind: 'composer' }
  await $.prompt.submit({ text: 'next', wait: false, origin })
  await $.turn.start({ text: 'next', turnId })
}

const spawn = ($: Engine, useId: string, description: string) =>
  $.agent.spawn({
    tool_use_id: useId,
    prompt: 'look around',
    description,
    subagentType: 'Explore',
    parentModel: 'test-model',
    provider: { kind: 'engine' } as never,
  } as never)

const finishAgent = ($: Engine, useId: string) =>
  $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: `turn-${useId}`, agentId: `agent-${useId}` })

async function pressFooter($: Engine) {
  const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  await mode.press({ key: 'progress-toggle' })
  await mode.unmount()
}

describe('the Progress pane on Desktop', () => {
  test('the footer entry is a plain label on Desktop, like the labels beside it', async ($, on) => {
    world(on)
    await create($, 'first')
    const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
    expect((await mode.find({ type: 'Button', key: 'progress-toggle' }))?.props.plain).toBe(true)
    await mode.unmount()
  })

  test('a new bar opens the pane, and nothing is drawn above the prompt', async ($, on) => {
    const w = world(on)
    await create($, 'first')
    expect([...w.panes]).toEqual([PANE])

    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Button', key: 'close-first' })).toBeUndefined()
  })

  test('the pane opens on an overview: one row per bar with its ring, title, step and counts, the newest first', async ($, on) => {
    const { clock } = world(on)
    await create($, 'first', 'First task')
    await clock.advance(1000)
    await create($, 'second')
    expect(await rows($)).toEqual(['second', 'first'])

    await clock.advance(1000)
    await $.tool.call({ tool: TOOL, id: 'first', next: true })
    expect(await rows($)).toEqual(['first', 'second'])
    expect(await texts($)).toContain('First task')
    expect((await buttons($))['toggle-first']).toBe(' '.repeat(165))
    const ui = await pane($)
    const hit = await ui.find({ type: 'Box', key: 'hit-first' })
    await ui.unmount()
    expect(hit?.props).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'stretch' })
    expect(await svgSource($, 'First task 50%')).toContain('stroke-dasharray')
    expect(await texts($)).toEqual(expect.arrayContaining(['Active · 2', 'Step 2/2 · Two', 'Step 1/2 · One']))
    expect(await texts($)).not.toEqual(expect.arrayContaining(['1/2']))
    expect(await svgSource($, 'First task: ')).toBeUndefined()
  })

  test('pressing a title opens its details in place, and pressing it again folds them', async ($, on) => {
    world(on)
    await $.tool.call({
      tool: TOOL,
      id: 'plan',
      title: 'Plan',
      stages: [
        { name: 'Read', steps: [{ title: 'Code', status: 'done' }] },
        { name: 'Build', steps: [{ title: 'Edit', status: 'active', substeps: [{ title: 'Types', status: 'done' }] }, { title: 'Test', status: 'pending' }] },
        { name: 'Ship', steps: [{ title: 'Release', status: 'pending' }] },
      ],
      note: 'tests first',
    })
    expect(await svgSource($, 'Plan: ')).toBeUndefined()

    await press($, 'toggle-plan')
    expect(await svgSource($, 'Plan: 1/4 steps')).toContain('<svg')
    expect(await texts($)).toEqual(expect.arrayContaining(['Read', '1/1', 'Build', '0/2', 'Ship', '0/1', 'Code', 'Edit', 'Types', 'Test', 'Release', 'tests first']))
    expect(await texts($)).toContain('⌄')

    await press($, 'toggle-plan')
    expect(await svgSource($, 'Plan: ')).toBeUndefined()
    expect(await texts($)).not.toContain('Release')
  })

  test('the stepped bar colours each step by its state and leaves a wider gap between stages', async ($, on) => {
    world(on)
    await $.tool.call({
      tool: TOOL,
      id: 'plan',
      title: 'Plan',
      stages: [
        { name: 'Read', steps: [{ title: 'Code', status: 'done' }] },
        { name: 'Build', steps: [{ title: 'Edit', status: 'active' }, { title: 'Test', status: 'pending' }] },
      ],
    })
    await press($, 'toggle-plan')
    const source = (await svgSource($, 'Plan: ')) ?? ''

    expect(source.match(/<rect /g)?.length).toBe(3)
    expect(source).toContain('fill="#30A46C" fill-opacity="1"')
    expect(source).toContain('fill="#8B7CF6" fill-opacity="1"')
    expect(source).toContain('fill="#8A8984" fill-opacity="0.3"')
    expect(source).toContain('width="371"')
    expect(source).toContain('<rect x="127.7"')
    expect(source).toContain('<rect x="250.3"')
    expect(await svgSource($, 'Plan: ', { bodyColumns: 400 })).toContain('width="1400"')
  })

  test('a bar waiting on the person says what it waits on, in its row and with a question mark in its ring', async ($, on) => {
    world(on)
    await create($, 'task')
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'Pick a name' })

    expect(await texts($)).toContain('Waiting on you · Pick a name')
    expect(await svgSource($, 'task 0%')).toContain('M9.09 9a3')
  })

  test('a row counts the agents at work, and its details list each agent with its tool and time', async ($, on) => {
    const { clock } = world(on)
    await create($, 'task')
    await spawn($, 'use-1', 'Scout')
    expect(await texts($)).toContain('Step 1/2 · One · 1 agent')

    await press($, 'toggle-task')
    await clock.advance(3000)
    expect(await texts($)).toEqual(expect.arrayContaining(['Agents', '1 running', 'Scout', 'Starting', '3s']))

    await finishAgent($, 'use-1')
    expect(await texts($)).toEqual(expect.arrayContaining(['Step 1/2 · One', '1 done', 'Done']))
  })

  test('Hide in the details hides one bar, and hiding the last drawn bar closes the pane', async ($, on) => {
    const w = world(on)
    await create($, 'first')
    await create($, 'second')
    await press($, 'toggle-first')
    await press($, 'close-first')
    expect(await rows($)).toEqual(['second'])
    expect([...w.panes]).toEqual([PANE])

    await press($, 'toggle-second')
    await press($, 'close-second')
    expect([...w.panes]).toEqual([])
  })

  test('a hidden bar stays in the history behind Show N older, and Show again brings it back', async ($, on) => {
    world(on)
    await create($, 'first')
    await create($, 'second')
    await press($, 'toggle-first')
    await press($, 'close-first')
    expect(await rows($)).toEqual(['second'])
    expect((await buttons($)).older).toBe('Show 1 older')

    await press($, 'older')
    expect(await rows($)).toEqual(['second', 'first'])
    expect((await buttons($))['close-first']).toBe('Show again')

    await press($, 'close-first')
    expect((await rows($)).sort()).toEqual(['first', 'second'])
    expect((await buttons($)).older).toBeUndefined()
  })

  test('a pane closed from the footer stays shut through updates, and a new bar opens it again', async ($, on) => {
    const w = world(on)
    await create($, 'first')
    await pressFooter($)
    await $.tool.call({ tool: TOOL, id: 'first', next: true })
    expect([...w.panes]).toEqual([])

    await create($, 'second')
    expect([...w.panes]).toEqual([PANE])
  })

  test('Progress in the footer closes the pane and opens it again', async ($, on) => {
    const w = world(on)
    await create($, 'task')

    await pressFooter($)
    expect([...w.panes]).toEqual([])
    await pressFooter($)
    expect([...w.panes]).toEqual([PANE])
  })

  test('the person’s next prompt folds a finished bar and closes the pane when nothing is left', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await finish($, 'task')
    expect([...w.panes]).toEqual([PANE])

    await personTurn($, 'turn-1')
    expect([...w.panes]).toEqual([])
  })

  test('Progress opens the pane on folded bars, which stay listed under Done', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await finish($, 'task')
    await personTurn($, 'turn-1')
    expect([...w.panes]).toEqual([])

    await pressFooter($)
    expect([...w.panes]).toEqual([PANE])
    expect(await rows($)).toEqual(['task'])
    expect(await texts($)).toContain('Done · 1')
  })

  test('a terminal session never opens the pane and keeps its band', async ($, on) => {
    const w = world(on, ['terminal'])
    await create($, 'task')
    expect(w.opens).toEqual([])

    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Button', key: 'close-task' })).toBeDefined()
  })

  test('a terminal session stops asking for panes once it knows none is up', async ($, on) => {
    const w = world(on, ['terminal'])
    await create($, 'task')
    const reads = w.paneReads
    await $.tool.call({ tool: TOOL, id: 'task', next: true })
    await $.tool.call({ tool: TOOL, id: 'task', state: 'done' })

    expect(reads).toBeLessThanOrEqual(1)
    expect(w.paneReads).toBe(reads)
  })

  test('a Desktop that attaches after the bars exist gets the pane', async ($, on) => {
    const w = world(on, [])
    await create($, 'task')
    expect(w.opens).toEqual([])

    w.surfaces = ['desktop']
    await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
    expect([...w.panes]).toEqual([PANE])
  })

  test('a session that starts with bars in its transcript opens the pane for them', async ($, on) => {
    const w = world(on)
    w.transcript = [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'use-1', tool: TOOL, input: { id: 'task', ...TASK }, text: 'ok' }] }]
    await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })

    expect([...w.panes]).toEqual([PANE])
    expect(await rows($)).toEqual(['task'])
  })
})

describe('many finished bars', () => {
  async function fiveDone($: Engine, clock: MockClock) {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await create($, id)
      await clock.advance(1000)
      await finish($, id)
      await clock.advance(1000)
    }
  }

  test('Done lists the three newest in full and folds the rest behind Show N older', async ($, on) => {
    const { clock } = world(on)
    await fiveDone($, clock)

    expect(await rows($)).toEqual(['e', 'd', 'c'])
    expect((await buttons($)).older).toBe('Show 2 older')
    expect(await texts($)).toContain('Done · 5')

    await press($, 'older')
    expect(await rows($)).toEqual(['e', 'd', 'c', 'b', 'a'])
    expect((await buttons($)).older).toBe('Show fewer')
    expect(await svgSource($, 'b ')).toBeUndefined()

    await press($, 'toggle-a')
    expect(await svgSource($, 'a: ')).toContain('<svg')
  })

  test('Hide all hides every finished bar and leaves the active ones', async ($, on) => {
    const w = world(on)
    await fiveDone($, w.clock)
    await create($, 'live')
    await press($, 'hide-done')

    expect(await rows($)).toEqual(['live'])
    expect([...w.panes]).toEqual([PANE])
    await press($, 'toggle-live')
    await press($, 'close-live')
    expect([...w.panes]).toEqual([])
  })

  test('Progress brings hidden bars back only when nothing else is left to show', async ($, on) => {
    const w = world(on)
    await fiveDone($, w.clock)
    await press($, 'hide-done')
    expect([...w.panes]).toEqual([])

    await pressFooter($)
    expect([...w.panes]).toEqual([PANE])
    expect((await rows($)).length).toBe(3)
  })

  test('Progress leaves a bar hidden with Hide out when a folded one is there to show', async ($, on) => {
    const w = world(on)
    await create($, 'kept')
    await finish($, 'kept')
    await create($, 'gone')
    await finish($, 'gone')
    await press($, 'toggle-gone')
    await press($, 'close-gone')
    await personTurn($, 'turn-1')
    expect([...w.panes]).toEqual([])

    await pressFooter($)
    expect([...w.panes]).toEqual([PANE])
    expect(await rows($)).toEqual(['kept'])
  })

  test('the footer counts only the bars still drawn, not the folded history', async ($, on) => {
    world(on)
    await create($, 'first')
    await finish($, 'first')
    await create($, 'second')
    await finish($, 'second')
    const label = async () => {
      const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
      const text = (await mode.find({ type: 'Button', key: 'progress-toggle' }))?.props.label
      await mode.unmount()
      return text
    }
    expect(await label()).toBe('Progress 2')

    await personTurn($, 'turn-1')
    expect(await label()).toBe('Progress')
  })

  test('the terminal band still shows at most three bars when opened', async ($, on) => {
    const { clock } = world(on, ['terminal'])
    for (const id of ['a', 'b', 'c', 'd']) {
      await create($, id)
      await clock.advance(1000)
    }
    const band = async () => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const opened = await band()
    await opened.press({ key: 'progress-expand' })
    await opened.unmount()
    const ui = await band()
    const shown = (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('close-'))

    expect(shown).toEqual(['close-b', 'close-c', 'close-d'])
  })

  test('the history keeps thirty bars, dropping the oldest finished ones first', async ($, on) => {
    const { clock } = world(on)
    await create($, 'live')
    for (let i = 0; i < 31; i++) {
      await create($, `done-${i}`)
      await finish($, `done-${i}`)
      await clock.advance(1000)
    }
    await press($, 'older')

    const kept = await rows($)
    expect(kept.length).toBe(30)
    expect(kept).toContain('live')
    expect(kept).not.toContain('done-0')
    expect(kept).not.toContain('done-1')
  })

  test('a folded row of an older bar shows its title and the time it finished', async ($, on) => {
    const { clock } = world(on)
    await fiveDone($, clock)
    await press($, 'older')
    const ui = await pane($)
    const older = await ui.find({ type: 'Box', key: 'row-a' })
    const words = (older ? flat(older) : '').trim()
    await ui.unmount()

    expect(words).toMatch(/^✓\s*.*\d\d:\d\d/)
  })
})

describe('when the Progress pane opens and closes', () => {
  test('updates to a bar never open the pane again while it is up', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await $.tool.call({ tool: TOOL, id: 'task', next: true })
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'Which one?' })

    expect(w.opens).toEqual([PANE])
  })

  test('nothing closes a pane that is not up', async ($, on) => {
    const w = world(on)
    await create($, 'first')
    await create($, 'second')
    await pressFooter($)
    expect(w.closes).toEqual([PANE])

    await finish($, 'first')
    await personTurn($, 'turn-1')
    expect(w.closes).toEqual([PANE])
  })

  test('a pane the plugin closed itself opens again for the next agent batch', async ($, on) => {
    const w = world(on)
    await spawn($, 'use-1', 'Scout')
    await finishAgent($, 'use-1')
    await personTurn($, 'turn-1')
    expect([...w.panes]).toEqual([])

    await spawn($, 'use-2', 'Builder')
    expect([...w.panes]).toEqual([PANE])
  })

  test('an agent started under an open bar leaves a pane closed from the footer shut', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await pressFooter($)

    await spawn($, 'use-1', 'Scout')
    expect([...w.panes]).toEqual([])
  })

  test('Progress opens the pane again when it went away while the bars were showing', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    w.panes.clear()

    await pressFooter($)
    expect([...w.panes]).toEqual([PANE])
    expect(w.opens).toEqual([PANE, PANE])
  })

  test('Progress brings a covered pane to the front by opening it afresh', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    w.behind.add(PANE)

    await pressFooter($)
    expect([...w.panes]).toEqual([PANE])
    expect(w.behind.has(PANE)).toBe(false)
    expect(w.closes).toEqual([PANE])
    expect(w.opens).toEqual([PANE, PANE])
  })

  test('a pane the surface cannot place falls back to the band, and Progress shows and hides it without reopening', async ($, on) => {
    const w = world(on)
    w.isUnplaced = true
    await create($, 'task')
    const band = () => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await (await band()).find({ type: 'Button', key: 'close-task' })).toBeDefined()

    await pressFooter($)
    expect(await (await band()).find({ type: 'Button', key: 'close-task' })).toBeUndefined()
    await pressFooter($)
    expect(await (await band()).find({ type: 'Button', key: 'close-task' })).toBeDefined()
    expect(w.opens.length).toBeLessThanOrEqual(2)
    expect(w.closes.length).toBeLessThanOrEqual(1)
  })

  test('/progress-demo opens the pane, also when the demo bar is already there', async ($, on) => {
    const w = world(on)
    const demo = () => $.command.run({ command: 'progress-demo', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })
    await demo()
    expect([...w.panes]).toEqual([PANE])

    await pressFooter($)
    await demo()
    expect([...w.panes]).toEqual([PANE])
  })

  test('/progress-clear closes the pane', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await $.command.run({ command: 'progress-clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })

    expect([...w.panes]).toEqual([])
  })

  test('a session start opens the pane again when it went away, as after a reload', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
    w.panes.clear()

    await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
    expect([...w.panes]).toEqual([PANE])
  })

  test('bars replayed at the first turn open the pane', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
    expect([...w.panes]).toEqual([])

    w.transcript = [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'use-1', tool: TOOL, input: { id: 'task', ...TASK }, text: 'ok' }] }]
    await $.turn.start({ text: 'go on', turnId: 'turn-1' })
    expect([...w.panes]).toEqual([PANE])
  })

  test('the Desktop leaving the session takes the pane with it', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    w.surfaces = []

    await $.session.detach({ surface: 'desktop', clientId: 'desktop-1', reason: 'detach' })
    expect([...w.panes]).toEqual([])
  })
})

describe('what a row says', () => {
  test('a failed bar shows its note, or Failed without one; a finished one says when it finished', async ($, on) => {
    world(on)
    await create($, 'noted')
    await $.tool.call({ tool: TOOL, id: 'noted', failed: 'One', note: 'tests broke' })
    await create($, 'bare')
    await $.tool.call({ tool: TOOL, id: 'bare', failed: 'One' })
    await create($, 'finished')
    await finish($, 'finished')
    const all = await texts($)

    expect(all).toEqual(expect.arrayContaining(['Failed · tests broke', 'Failed']))
    expect(all.some(one => /^Done at \d\d:\d\d$/.test(one))).toBe(true)
  })

  test('the Agents row counts its agents, and its details list them', async ($, on) => {
    const { clock } = world(on)
    await clock.advance(1000)
    await spawn($, 'use-1', 'Scout')
    expect(await texts($)).toContain('0/1 agent done')

    await finishAgent($, 'use-1')
    await clock.advance(6000)
    await press($, 'toggle-agents:auto')
    expect(await texts($)).toEqual(expect.arrayContaining(['Scout', 'Done', '1 done']))
    expect(await svgSource($, 'Agents: ')).toBeUndefined()
  })

  test('the ring draws the finished share of its circle', async ($, on) => {
    world(on)
    await create($, 'task')
    await $.tool.call({ tool: TOOL, id: 'task', next: true })

    expect(await svgSource($, 'task 50%')).toContain('stroke-dasharray="25.1 50.3"')
  })

  test('the row shows how long the bar has run', async ($, on) => {
    const { clock } = world(on)
    await create($, 'task')
    await clock.advance(125_000)
    await $.tool.call({ tool: TOOL, id: 'task', next: true })

    expect(await texts($)).toContain('2m')
  })
})
