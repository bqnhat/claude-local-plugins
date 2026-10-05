import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__plan-progress__plan_progress'
const PLUGIN = 'plan-progress'
const AGENTS = 'agents:auto'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

function world(on: On): MockClock {
  const clock = mock.clock(on)
  on('tool.call', async () => ({ result: undefined as never }))
  on('command.run', async () => ({ text: '' }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('agent.spawn', async (_$, e) => ({ model: 'test-model', agentId: `agent-${e.tool_use_id}` }))
  on('ui.render', async () => <></>)
  return clock
}

const create = ($: Engine, id: string, title = id) =>
  $.tool.call({
    tool: TOOL,
    id,
    title,
    stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }],
  })

const band = ($: Engine, surface: 'desktop' | 'terminal' = 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })

async function drawnBars($: Engine): Promise<string[]> {
  const ui = await band($)
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('close-'))
  await ui.unmount()
  return keys.map(k => k.slice('close-'.length))
}

async function expandLabel($: Engine): Promise<unknown> {
  const ui = await band($)
  const label = (await ui.find({ type: 'Button', key: 'progress-expand' }))?.props.label
  await ui.unmount()
  return label
}

async function pressExpand($: Engine) {
  const ui = await band($)
  await ui.press({ key: 'progress-expand' })
  await ui.unmount()
}

async function turnFrom($: Engine, origin: PromptOrigin, turnId: string) {
  await $.prompt.submit({ text: 'next', wait: false, origin })
  await $.turn.start({ text: 'next', turnId })
}

const personTurn = ($: Engine, turnId: string) => turnFrom($, { kind: 'composer' }, turnId)

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

describe('collapsed band', () => {
  test('several bars draw as one row, the last one Claude touched, with +N to open the rest', async ($, on) => {
    const clock = world(on)
    await create($, 'first')
    await clock.advance(1000)
    await create($, 'second')
    await clock.advance(1000)
    await create($, 'third')
    expect(await drawnBars($)).toEqual(['third'])

    await clock.advance(1000)
    await $.tool.call({ tool: TOOL, id: 'first', next: true })
    expect(await drawnBars($)).toEqual(['first'])
    expect(await expandLabel($)).toBe('+2')

    await pressExpand($)
    expect(await drawnBars($)).toEqual(['first', 'second', 'third'])
    expect(await expandLabel($)).toBe('▴')

    await pressExpand($)
    expect(await drawnBars($)).toEqual(['first'])
  })

  test('bars touched at the same moment: the later one in the list takes the row', async ($, on) => {
    world(on)
    await create($, 'first')
    await create($, 'second')

    expect(await drawnBars($)).toEqual(['second'])
  })

  test('with every bar finished, the one finished last takes the row', async ($, on) => {
    const clock = world(on)
    await create($, 'first')
    await create($, 'second')
    await create($, 'third')
    for (const id of ['third', 'second', 'first', 'second']) {
      await clock.advance(1000)
      await $.tool.call({ tool: TOOL, id, state: 'done' })
    }

    expect(await drawnBars($)).toEqual(['second'])
  })

  test('an open bar takes the row before a finished one, and one bar alone has no expand control', async ($, on) => {
    const clock = world(on)
    await create($, 'open')
    await clock.advance(1000)
    await create($, 'finished')
    await $.tool.call({ tool: TOOL, id: 'finished', state: 'done' })
    expect(await drawnBars($)).toEqual(['open'])

    await $.tool.call({ tool: TOOL, id: 'open', state: 'done' })
    await personTurn($, 'turn-1')
    await create($, 'alone')
    expect(await expandLabel($)).toBeUndefined()
  })

  test('/progress-demo takes the row even when another bar was touched a moment ago', async ($, on) => {
    const clock = world(on)
    await clock.advance(600_000)
    await create($, 'task')
    await clock.advance(1000)
    await $.command.run({ command: 'progress-demo', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })

    expect(await drawnBars($)).toEqual(['demo'])
  })

  test('+N counts only the bars that are drawn', async ($, on) => {
    const clock = world(on)
    await create($, 'first')
    await clock.advance(1000)
    await create($, 'second')
    await clock.advance(1000)
    await create($, 'third')
    await pressExpand($)
    const ui = await band($)
    await ui.press({ key: 'close-second' })
    await ui.press({ key: 'progress-expand' })
    await ui.unmount()

    expect(await expandLabel($)).toBe('+1')
  })

  test('the expand control sits right after the title, plain and dim', async ($, on) => {
    world(on)
    await create($, 'first')
    await create($, 'second', 'Second task')
    const ui = await band($)
    const row = (await ui.findAll({ type: 'Box' })).find(box => box.key === 'bar-second')
    const kids = (row?.children ?? []) as { type?: string; props?: Record<string, unknown> }[]
    const at = kids.findIndex(kid => kid.type === 'Button' && kid.props?.label === '+1')

    expect(at).toBeGreaterThan(0)
    expect(kids[at - 1]?.type).toBe('Text')
    expect(kids[at]?.props).toMatchObject({ plain: true, dimColor: true })
  })
})

describe('agent strips', () => {
  test('the terminal, which draws no strips, offers no expand control for a lone bar with agents', async ($, on) => {
    world(on)
    await create($, 'task')
    await spawn($, 'use-1', 'Scout')
    const ui = await band($, 'terminal')

    expect(await ui.find({ type: 'Button', key: 'progress-expand' })).toBeUndefined()
  })

  test('a new agent batch shows its folded Agents bar again and takes the row from a bar touched before it', async ($, on) => {
    const clock = world(on)
    await spawn($, 'use-1', 'Scout')
    await finishAgent($, 'use-1')
    await personTurn($, 'turn-1')
    expect(await drawnBars($)).toEqual([])

    await clock.advance(1000)
    await create($, 'waiting')
    await $.tool.call({ tool: TOOL, id: 'waiting', state: 'needs_input' })
    await clock.advance(1000)
    await spawn($, 'use-2', 'Builder')

    expect(await drawnBars($)).toEqual([AGENTS])
  })

  test('a new agent batch shows the Agents bar again after the last batch was closed with ✕', async ($, on) => {
    world(on)
    await spawn($, 'use-1', 'Scout')
    await finishAgent($, 'use-1')
    const ui = await band($)
    await ui.press({ key: `close-${AGENTS}` })
    await ui.unmount()
    expect(await drawnBars($)).toEqual([])

    await spawn($, 'use-2', 'Builder')
    expect(await drawnBars($)).toEqual([AGENTS])
  })

  test('an agent started under a bar closed with ✕ leaves it hidden', async ($, on) => {
    world(on)
    await create($, 'task')
    const ui = await band($)
    await ui.press({ key: 'close-task' })
    await ui.unmount()

    await spawn($, 'use-1', 'Scout')
    expect(await drawnBars($)).toEqual([])
  })
})

describe('finished bars', () => {
  test('a finished bar stays until the person’s next prompt, then folds, and Progress shows it again', async ($, on) => {
    world(on)
    await create($, 'task')
    await $.tool.call({ tool: TOOL, id: 'task', done: ['One', 'Two'] })
    expect(await drawnBars($)).toEqual(['task'])

    await personTurn($, 'turn-1')
    expect(await drawnBars($)).toEqual([])

    const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
    await mode.press({ key: 'progress-toggle' })
    await mode.unmount()
    expect(await drawnBars($)).toEqual(['task'])
  })

  for (const origin of [{ kind: 'plugin', name: 'plan-progress' }, { kind: 'task-notification' }, { kind: 'scheduled-trigger' }] as PromptOrigin[]) {
    test(`a turn started by ${origin.kind} leaves a finished bar drawn`, async ($, on) => {
      world(on)
      await create($, 'task')
      await $.tool.call({ tool: TOOL, id: 'task', state: 'done' })

      await turnFrom($, origin, 'turn-1')
      expect(await drawnBars($)).toEqual(['task'])
    })
  }

  test('the person’s next prompt folds only finished bars; open and failed ones stay', async ($, on) => {
    const clock = world(on)
    await create($, 'open')
    await clock.advance(1000)
    await create($, 'failed')
    await $.tool.call({ tool: TOOL, id: 'failed', failed: 'One' })
    await clock.advance(1000)
    await create($, 'finished')
    await $.tool.call({ tool: TOOL, id: 'finished', state: 'done' })
    await pressExpand($)

    await personTurn($, 'turn-1')
    expect(await drawnBars($)).toEqual(['open', 'failed'])
  })

  test('a bar created again under the id of a folded finished one is drawn', async ($, on) => {
    world(on)
    await create($, 'task')
    await $.tool.call({ tool: TOOL, id: 'task', state: 'done' })
    await personTurn($, 'turn-1')
    expect(await drawnBars($)).toEqual([])

    await create($, 'task')
    expect(await drawnBars($)).toEqual(['task'])
  })

  test('a bar closed with ✕ while open stays hidden through its updates, after it finishes too', async ($, on) => {
    world(on)
    await create($, 'task')
    const ui = await band($)
    await ui.press({ key: 'close-task' })
    await ui.unmount()

    await $.tool.call({ tool: TOOL, id: 'task', next: true })
    expect(await drawnBars($)).toEqual([])
    await $.tool.call({ tool: TOOL, id: 'task', done: ['Two'] })
    await $.tool.call({ tool: TOOL, id: 'task', state: 'done', note: 'all good' })
    expect(await drawnBars($)).toEqual([])
  })

  test('Progress with folded bars behind the row shows them all instead of hiding the band', async ($, on) => {
    const clock = world(on)
    await create($, 'finished')
    await $.tool.call({ tool: TOOL, id: 'finished', state: 'done' })
    await personTurn($, 'turn-1')
    await clock.advance(1000)
    await create($, 'open')
    expect(await drawnBars($)).toEqual(['open'])

    const mode = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
    await mode.press({ key: 'progress-toggle' })
    expect(await drawnBars($)).toEqual(['finished', 'open'])

    await mode.press({ key: 'progress-toggle' })
    await mode.unmount()
    expect(await drawnBars($)).toEqual([])
  })
})

describe('the bar a question waits on', () => {
  test('an answer ending in a question marks the bar Claude touched last, the one the row shows', async ($, on) => {
    const clock = world(on)
    await personTurn($, 'turn-1')
    await create($, 'first')
    await clock.advance(1000)
    await create($, 'second')
    await clock.advance(1000)
    await $.tool.call({ tool: TOOL, id: 'first', next: true })
    await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
    await $.turn.complete({ reason: 'answer', answer: 'Which one should I keep?', durationMs: 1, isAborted: false, turnId: 'turn-1' })

    const ui = await band($)
    expect(await ui.find({ type: 'Button', key: 'close-first' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '?' })).toBeDefined()
  })
})
