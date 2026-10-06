import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionMessage, ToolUseSummary } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const TASK = {
  id: 'task',
  title: 'Task',
  stages: [{ name: 'Build', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }],
}

let useCount = 0

function barCall(input: Record<string, unknown>, isError = false): ToolUseSummary {
  useCount += 1
  return { tool_use_id: `use-${useCount}`, tool: TOOL, input, text: isError ? 'no bar' : 'ok', ...(isError ? { isError: true as const } : {}) }
}

const said = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const called = (...toolUses: ToolUseSummary[]): SessionMessage => ({ role: 'assistant', text: '', toolUses })

const LOCAL_COMMAND_CAVEAT =
  "<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It's recorded here as context for later messages.</local-command-caveat>"
const ran = (name: string): SessionMessage[] => [
  said(LOCAL_COMMAND_CAVEAT),
  said(`<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args></command-args>`),
]

type World = { transcript: SessionMessage[] }

function world(on: On, transcript: SessionMessage[]): World {
  const w: World = { transcript }
  mock.clock(on)
  on('session.messages', async () => ({ value: w.transcript }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', async () => <></>)
  return w
}

const start = ($: Engine) => $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })

const advance = ($: Engine, id: string) => $.tool.call({ tool: TOOL, id, next: true })

const isRefused = (result: unknown) => (result as { deny?: string }).deny?.includes('no bar') === true

describe('bars after a rewind or resume', () => {
  test('a new process draws the bars its transcript left, as they stood at the rewind point', async ($, on) => {
    world(on, [said('do it'), called(barCall(TASK)), called(barCall({ id: 'task', next: true })), called(barCall({ id: 'ghost', next: true }, true))])
    await start($)

    const task = await advance($, 'task')
    expect(task.result).toContain('task: 2/2, done')
    const ghost = await advance($, 'ghost')
    expect(isRefused(ghost)).toBe(true)
  })

  test('a prompt typed after a waiting bar leaves it waiting, and /progress-clear drops the bars before it', async ($, on) => {
    world(on, [
      called(barCall({ ...TASK, id: 'old', title: 'Old' })),
      ...ran('progress-clear'),
      called(barCall({ ...TASK, state: 'needs_input', note: 'which one?' })),
      said('the first one'),
    ])
    await start($)

    const ui = await $.ui.mount({ plugin: 'session-hub', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: '?' })).toBeDefined()
    await ui.unmount()
    expect((await advance($, 'task')).result).toContain('task: 1/2, running')
    expect(isRefused(await advance($, 'old'))).toBe(true)
  })

  test('/progress and /progress-demo in the transcript leave the bars alone', async ($, on) => {
    world(on, [called(barCall(TASK)), ...ran('progress'), ...ran('progress-demo')])
    await start($)

    expect((await advance($, 'task')).result).toContain('task: 1/2, running')
  })

  test('the transcript is replayed once per process, so a reload never brings back a bar', async ($, on) => {
    const w = world(on, [said('do it'), called(barCall(TASK))])
    await start($)
    w.transcript = [...w.transcript, called(barCall({ ...TASK, id: 'later', title: 'Later' }))]
    await start($)

    expect(isRefused(await advance($, 'later'))).toBe(true)
  })

  test('bars removed with /progress-clear stay removed when the module reloads', async ($, on) => {
    world(on, [said('do it'), called(barCall(TASK))])
    on('command.run', async () => ({ text: '' }))
    await start($)
    await $.command.run({ command: 'progress-clear', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })
    await start($)

    expect(isRefused(await advance($, 'task'))).toBe(true)
  })

  test('a session whose transcript is still empty at start replays at its first turn', async ($, on) => {
    const w = world(on, [])
    on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
    await start($)
    w.transcript = [said('go on'), called(barCall(TASK))]
    await $.turn.start({ text: 'go on', turnId: 'turn-1' })

    expect((await advance($, 'task')).result).toContain('task: 1/2, running')
  })

  test('the rebuilt band shows the bar the transcript touched last, not the last one in the list', async ($, on) => {
    world(on, [
      called(barCall({ ...TASK, id: 'first', title: 'First' })),
      called(barCall({ ...TASK, id: 'second', title: 'Second' })),
      called(barCall({ id: 'first', next: true })),
    ])
    await start($)

    const ui = await $.ui.mount({ plugin: 'session-hub', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Button', key: 'close-first' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'close-second' })).toBeUndefined()
  })
})

type Switch = World & { id: string; contexts: (readonly string[])[]; clock: ReturnType<typeof mock.clock> }

function switching(on: On, transcript: SessionMessage[]): Switch {
  const w: Switch = { transcript, id: 'session-1', contexts: [], clock: mock.clock(on) }
  on('session.messages', async () => ({ value: w.transcript }))
  on('session.id', async () => ({ value: w.id }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', async (_$, e) => {
    w.contexts.push(e.context ?? [])
    return { text: e.text, context: e.context }
  })
  on('ui.render', async () => <></>)
  return w
}

async function footerLabel($: Engine): Promise<unknown> {
  const mode = await $.ui.mount({ plugin: 'session-hub', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const label = (await mode.find({ type: 'Button', key: 'hub-toggle' }))?.props.label
  await mode.unmount()
  return label
}

const openBarsLine = (context: readonly string[] | undefined) => (context ?? []).find(entry => entry.startsWith('plan-progress open bars:'))

describe('bars across /clear and /resume', () => {
  test('/clear drops the bars of the conversation it ended: no footer count, no open-bars line, no update', async ($, on) => {
    const w = switching(on, [said('do it')])
    await start($)
    await $.tool.call({ tool: TOOL, ...TASK })
    expect(await footerLabel($)).toBe('Progress 1')

    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } } as never)
    w.id = 'session-2'
    w.transcript = []
    await $.prompt.submit({ text: 'new topic', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'new topic', turnId: 'turn-1' })

    expect(await footerLabel($)).toBe('Mods')
    expect(openBarsLine(w.contexts.at(-1))).toBeUndefined()
    expect(isRefused(await advance($, 'task'))).toBe(true)
  })

  test('/resume swaps the old bars for the ones the resumed transcript left, without waiting for a prompt', async ($, on) => {
    const w = switching(on, [said('do it')])
    await start($)
    await $.tool.call({ tool: TOOL, ...TASK, id: 'old', title: 'Old' })

    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-2' } } as never)
    w.transcript = [said('earlier'), called(barCall({ ...TASK, id: 'resumed', title: 'Resumed' }))]
    await w.clock.advance(1000)
    expect(await footerLabel($)).toBe('Mods')

    w.id = 'session-2'
    await w.clock.advance(1000)
    expect(await footerLabel($)).toBe('Progress 1')
    await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
    expect(openBarsLine(w.contexts.at(-1))).toContain('resumed')
    expect(openBarsLine(w.contexts.at(-1))).not.toContain('old')
    expect(isRefused(await advance($, 'old'))).toBe(true)
    expect((await advance($, 'resumed')).result).toContain('resumed: 1/2, running')
  })

  test('a resume replays at the next turn when no tick ran in between', async ($, on) => {
    const w = switching(on, [said('do it')])
    await start($)
    await $.tool.call({ tool: TOOL, ...TASK, id: 'old', title: 'Old' })

    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-2' } } as never)
    w.id = 'session-2'
    w.transcript = [said('earlier'), called(barCall({ ...TASK, id: 'resumed', title: 'Resumed' }))]
    await $.turn.start({ text: 'carry on', turnId: 'turn-1' })

    expect(isRefused(await advance($, 'old'))).toBe(true)
    expect((await advance($, 'resumed')).result).toContain('resumed: 1/2, running')
  })

  test('an exit keeps the bars, so a process that resumes the same conversation replays them', async ($, on) => {
    switching(on, [said('do it')])
    await start($)
    await $.tool.call({ tool: TOOL, ...TASK })
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as never)

    expect(await footerLabel($)).toBe('Progress 1')
  })
})
