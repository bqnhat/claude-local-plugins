import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptOrigin, RenderSurface, SessionMessage } from 'claude-code'
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

async function detailShown($: Engine, id: string): Promise<boolean> {
  const ui = await pane($)
  const detail = await ui.find({ type: 'Box', key: `detail-${id}` })
  await ui.unmount()
  return detail !== undefined
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
  await mode.press({ key: 'hub-toggle' })
  await mode.unmount()
}

describe('the Progress pane on Desktop', () => {
  test('the footer entry is a plain label on Desktop, like the labels beside it', async ($, on) => {
    world(on)
    await create($, 'first')
    const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
    expect((await mode.find({ type: 'Button', key: 'hub-toggle' }))?.props.plain).toBe(true)
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
    expect((await buttons($))['toggle-first']).toBe('\u00a0'.repeat(185))
    const ui = await pane($)
    const hit = await ui.find({ type: 'Box', key: 'hit-first' })
    await ui.unmount()
    expect(hit?.props).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'stretch', overflow: 'hidden' })
    expect(await svgSource($, 'First task 50%')).toContain('stroke-dasharray')
    expect(await texts($)).toEqual(expect.arrayContaining(['Active · 2', 'Step 2/2 · Two', 'Step 1/2 · One']))
    expect(await texts($)).not.toEqual(expect.arrayContaining(['1/2']))
    expect(await svgSource($, 'First task: ')).toBeUndefined()
  })

  test('the rail dot of a failed bar is the same red as its ring', async ($, on) => {
    world(on)
    await create($, 'task', 'Task')
    await $.tool.call({ tool: TOOL, id: 'task', state: 'error', note: 'Broke' })

    expect(await svgSource($, 'Task 0%')).toContain('stroke="#E5484D"')
    expect(await svgSource($, 'Progress ·')).toContain('fill="#E5484D"')
  })

  test('the ring and the rail icon say in words what their colour shows', async ($, on) => {
    world(on)
    await create($, 'task', 'Task')
    const alts = async () => {
      const ui = await pane($)
      const all = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
      await ui.unmount()
      return all
    }
    expect(await alts()).toEqual(expect.arrayContaining(['Task 0% · running', 'Progress · selected']))

    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'Pick a name' })
    expect(await alts()).toEqual(expect.arrayContaining(['Task 0% · waiting on you', 'Progress · selected · waiting on you']))

    await $.tool.call({ tool: TOOL, id: 'task', state: 'error', note: 'Broke' })
    expect(await alts()).toEqual(expect.arrayContaining(['Task 0% · failed', 'Progress · selected · failed']))

    await finish($, 'task')
    expect(await alts()).toEqual(expect.arrayContaining(['Task 100% · done', 'Progress · selected']))
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
    expect(await svgSource($, 'Fold')).toContain('M3 4.5 6 7.5 9 4.5')
    expect((await texts($)).filter(one => one.startsWith('Started '))).toHaveLength(1)
    expect((await texts($)).some(one => one.includes('→'))).toBe(false)

    await press($, 'toggle-plan')
    expect(await svgSource($, 'Open')).toContain('M4.5 3 7.5 6 4.5 9')
    expect(await svgSource($, 'Plan: ')).toBeUndefined()
    expect(await texts($)).not.toContain('Release')
  })

  test('a press on the chevron opens and folds the bar as a press on its title does', async ($, on) => {
    world(on)
    await create($, 'plan')
    expect((await buttons($))['chevron-plan']).toBe(' '.repeat(4))
    expect(await svgSource($, 'Open')).toContain('M4.5 3 7.5 6 4.5 9')

    await press($, 'chevron-plan')
    expect(await svgSource($, 'Fold')).toContain('M3 4.5 6 7.5 9 4.5')
    expect(await texts($)).toContain('Two')

    await press($, 'chevron-plan')
    expect(await svgSource($, 'Open')).toContain('M4.5 3 7.5 6 4.5 9')
    expect(await texts($)).not.toContain('Two')
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
    expect(source).toContain('viewBox="0 0 1400 4" preserveAspectRatio="none"')
    expect(source).toContain('<rect x="470.7"')
    expect(source).toContain('<rect x="936.3"')
    expect(await svgSource($, 'Plan: ', { bodyColumns: 20 })).toBe(source)
  })

  test('the stepped bar takes the whole width of the details, whatever the pane width', async ($, on) => {
    world(on)
    await create($, 'plan')
    await press($, 'toggle-plan')
    const ui = await pane($)
    const bar = (await ui.findAll({ type: 'Svg' })).find(one => String(one.props.alt).startsWith('plan: '))
    await ui.unmount()

    expect(bar?.props.width).toBeUndefined()
    expect(bar?.props.height).toBe(4)
  })

  test('a bar waiting on the person says what it waits on, in its row and with a question mark in its ring', async ($, on) => {
    world(on)
    await create($, 'task')
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'Pick a name' })

    expect(await texts($)).toContain('Waiting on you · Pick a name')
    expect(await svgSource($, 'task 0%')).toContain('M9.09 9a3')
  })

  test('state done finishes every step still open, substeps too, and stops their clocks', async ($, on) => {
    const { clock } = world(on)
    await $.tool.call({
      tool: TOOL,
      id: 'job',
      title: 'Job',
      stages: [
        { name: 'Build', steps: [{ title: 'One', status: 'done' }, { title: 'Two', status: 'active', substeps: [{ title: 'Half', status: 'pending' }] }] },
        { name: 'Check', steps: [{ title: 'Three', status: 'pending' }] },
      ],
    })
    await clock.advance(4000)
    await finish($, 'job')
    await press($, 'toggle-job')
    await clock.advance(5000)
    const all = await texts($)
    expect(all.filter(text => /^\d+\/\d+/.test(text)).map(text => text.split(' ')[0])).toEqual(['2/2', '1/1'])
    expect(all.filter(text => text === '●' || text === '○')).toEqual([])
    expect(all.some(text => text.endsWith('…'))).toBe(false)
  })

  test('state done after a failed step or a wait leaves no step failed, waiting or pending', async ($, on) => {
    world(on)
    const stages = [
      { name: 'Build', steps: [{ title: 'Install', status: 'done' }, { title: 'Compile', status: 'active' }] },
      { name: 'Test', steps: [{ title: 'Run', status: 'pending' }] },
    ]
    await $.tool.call({ tool: TOOL, id: 'broke', title: 'Broke', stages })
    await $.tool.call({ tool: TOOL, id: 'broke', failed: 'Compile', note: 'build failed' })
    await $.tool.call({ tool: TOOL, id: 'ask', title: 'Ask', stages })
    await $.tool.call({ tool: TOOL, id: 'ask', state: 'needs_input', note: 'pick a name' })
    for (const id of ['broke', 'ask']) {
      await finish($, id)
      await press($, `toggle-${id}`)
      const all = await texts($)
      expect(all.filter(text => /^\d+\/\d+/.test(text)).map(text => text.split(' ')[0])).toEqual(['2/2', '1/1'])
      expect(all.filter(text => ['●', '○', '!'].includes(text))).toEqual([])
      await press($, `toggle-${id}`)
    }
  })

  test('every step mark sits in one fixed column, so a failed step lines up with the done ones', async ($, on) => {
    world(on)
    await $.tool.call({ tool: TOOL, id: 'job', title: 'Job', stages: [{ name: 'Build', steps: [{ title: 'One', status: 'done' }, { title: 'Two', status: 'active' }, { title: 'Three', status: 'pending' }] }] })
    await $.tool.call({ tool: TOOL, id: 'job', failed: 'Two', note: 'broke' })
    await press($, 'toggle-job')
    const ui = await pane($)
    const marks = (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').endsWith('-mark'))
    await ui.unmount()
    expect(marks.map(flat)).toEqual(['✓', '!', '○'])
    expect(marks.map(box => box.props.width)).toEqual([1, 1, 1])
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

  test('Hide in the details hides one bar, and the pane stays up after the last one', async ($, on) => {
    const w = world(on)
    await create($, 'first')
    await create($, 'second')
    await press($, 'toggle-first')
    await press($, 'close-first')
    expect(await rows($)).toEqual(['second'])
    expect([...w.panes]).toEqual([PANE])

    await press($, 'toggle-second')
    await press($, 'close-second')
    expect([...w.panes]).toEqual([PANE])
    expect((await buttons($)).older).toBe('Show 2 older')
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

  test('the person’s next prompt folds a finished bar, which stays listed under Done in the open pane', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    await finish($, 'task')
    expect([...w.panes]).toEqual([PANE])

    await personTurn($, 'turn-1')
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
    expect([...w.panes]).toEqual([PANE])
  })

  test('the footer counts only the bars still at work', async ($, on) => {
    world(on)
    await create($, 'first')
    await create($, 'second')
    const label = async () => {
      const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
      const text = (await mode.find({ type: 'Button', key: 'hub-toggle' }))?.props.label
      await mode.unmount()
      return text
    }
    expect(await label()).toBe('Progress 2')

    await finish($, 'first')
    expect(await label()).toBe('Progress 1')
    await finish($, 'second')
    expect(await label()).toBe('Mods')
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

  test('the pane stays up between agent batches and is opened once', async ($, on) => {
    const w = world(on)
    await spawn($, 'use-1', 'Scout')
    await finishAgent($, 'use-1')
    await personTurn($, 'turn-1')
    expect([...w.panes]).toEqual([PANE])

    await spawn($, 'use-2', 'Builder')
    expect(w.opens).toEqual([PANE])
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

  test('/progress-demo opens the pane on its sample bar, also when the demo bar is already there', async ($, on) => {
    const w = world(on)
    const demo = () => $.command.run({ command: 'progress-demo', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })
    expect((await demo()).text).toBe('Sample plan shown.')
    expect([...w.panes]).toEqual([PANE])
    expect(await rows($)).toEqual(['demo'])
    expect(await texts($)).toContain('Orders module')

    await pressFooter($)
    await demo()
    expect([...w.panes]).toEqual([PANE])
  })

  test('/progress-clear empties the Progress section and leaves the pane up', async ($, on) => {
    const w = world(on)
    await create($, 'task')
    const cleared = await $.command.run({ command: 'progress-clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })

    expect(cleared.text).toBe('Progress bars removed.')
    expect([...w.panes]).toEqual([PANE])
    expect(await texts($)).toContain('No progress bars yet. One appears when Claude starts a task with several steps.')
  })

  test('a bar made again under an id that was open before /progress-clear starts closed', async ($, on) => {
    world(on)
    await create($, 'task')
    await press($, 'toggle-task')
    expect(await detailShown($, 'task')).toBe(true)
    await $.command.run({ command: 'progress-clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })

    await create($, 'task')
    expect(await detailShown($, 'task')).toBe(false)
  })

  test('/progress with no bar says how to see a sample instead of opening anything', async ($, on) => {
    const w = world(on)
    const shown = await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })

    expect(shown.text).toBe('No plan yet. /progress-demo shows a sample.')
    expect(w.opens).toEqual([])
  })

  test('/session shows the Mod status pane, then hides it, and says which', async ($, on) => {
    const w = world(on)
    const session = () => $.command.run({ command: 'session', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })

    expect((await session()).text).toBe('Mod status pane shown.')
    expect([...w.panes]).toEqual([PANE])
    expect((await session()).text).toBe('Mod status pane hidden.')
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

  test('an opened finished bar says its start, end and length once, in its detail line', async ($, on) => {
    world(on)
    await create($, 'finished')
    await finish($, 'finished')
    expect(await detailShown($, 'finished')).toBe(false)
    await press($, 'toggle-finished')
    const all = await texts($)

    expect(all.some(one => /^Started \d\d:\d\d · done \d\d:\d\d/.test(one))).toBe(true)
    expect(all.some(one => one.startsWith('Done at '))).toBe(false)
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
