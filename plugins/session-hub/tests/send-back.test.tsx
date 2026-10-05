import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'
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

type World = { prompts: { text: string; origin: PromptOrigin; context: readonly string[] }[]; results: Record<string, unknown> }

function world(on: On): World {
  const w: World = { prompts: [], results: {} }
  mock.clock(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => {
    w.prompts.push({ text: e.text, origin: e.origin, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('tool.call', async (_$, e) => ({ result: w.results[e.tool] as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.render', async () => <></>)
  return w
}

const sentBack = (w: World) => w.prompts.filter(p => p.origin.kind === 'plugin' && p.text.includes('still open'))

async function workTurn($: Engine, turnId: string, answer: string, opts: { agentId?: string; reason?: 'answer' | 'aborted' } = {}) {
  await $.turn.start({ text: 'do it', turnId })
  await $.tool.call({
    tool: TOOL,
    id: 'task',
    title: 'Task',
    stages: [{ name: 'Build', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }],
  })
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({
    reason: opts.reason ?? 'answer',
    answer,
    durationMs: 1,
    isAborted: opts.reason === 'aborted',
    turnId,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  })
}

const TASK_BAR = {
  tool: TOOL,
  id: 'task',
  title: 'Task',
  stages: [{ name: 'Build', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }],
}

const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })

const typed = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const ended = ($: Engine, turnId: string, answer: string, agentId?: string) =>
  $.turn.complete({ reason: 'answer', answer, durationMs: 1, isAborted: false, turnId, ...(agentId ? { agentId } : {}) })

const notified = ($: Engine, taskId: string, status = 'completed') =>
  $.prompt.submit({
    text: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>${status}</status>\n<summary>Background work ${status}</summary>\n</task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  })

describe('sending an unexplained open bar back', () => {
  test('a turn that did work and left the bar open is sent back once by a plugin prompt', async ($, on) => {
    const w = world(on)
    await workTurn($, 'turn-1', 'Edited the file.')

    expect(sentBack(w)).toHaveLength(1)
    expect(sentBack(w)[0]?.origin).toEqual({ kind: 'plugin', name: 'session-hub' })
    expect(sentBack(w)[0]?.text).toContain('task still open')
  })

  test('the plugin prompt does not re-arm it; the person’s next prompt does', async ($, on) => {
    const w = world(on)
    await workTurn($, 'turn-1', 'Edited the file.')
    await workTurn($, 'turn-2', 'Edited again.')
    expect(sentBack(w)).toHaveLength(1)

    await $.prompt.submit({ text: 'continue', wait: false, origin: { kind: 'composer' } })
    await workTurn($, 'turn-3', 'Edited once more.')
    expect(sentBack(w)).toHaveLength(2)
  })

  test('an answer ending in a question marks the bar as waiting instead', async ($, on) => {
    const w = world(on)
    await workTurn($, 'turn-1', 'Which file should I change next?')

    expect(sentBack(w)).toHaveLength(0)
    const ui = await $.ui.mount({ plugin: 'session-hub', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: '?' })).toBeDefined()
  })

  test('a subagent turn or an interrupted turn is never sent back', async ($, on) => {
    const w = world(on)
    await workTurn($, 'turn-1', 'Edited the file.', { agentId: 'agent-1' })
    await workTurn($, 'turn-2', 'Edited the file.', { reason: 'aborted' })

    expect(sentBack(w)).toHaveLength(0)
  })

  test('no classic.Stop hook is left to block the stop', async ($, on) => {
    world(on)
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' } as never)

    expect(result.block).toBeUndefined()
  })
})

describe('a turn that waits instead of leaving the bar unexplained', () => {
  test('a turn that ends while the workflow it started still runs is not sent back', async ($, on) => {
    const w = world(on)
    w.results.Workflow = { status: 'async_launched', taskId: 'wb3r52d71', runId: 'wf_f7b4a3a8-bfb' }
    await $.turn.start({ text: 'review it', turnId: 'turn-1' })
    await $.tool.call(TASK_BAR)
    await $.tool.call({ tool: 'Workflow', script: 'export const meta = { name: "review" }' })
    await edit($)
    await ended($, 'turn-1', 'The review is still running.')

    expect(sentBack(w)).toHaveLength(0)
  })

  test('a background shell holds the bar until its notification says it ended, not while it reports running', async ($, on) => {
    const w = world(on)
    w.results.Bash = { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b0sa8g8ad' }
    await $.turn.start({ text: 'build it', turnId: 'turn-1' })
    await $.tool.call(TASK_BAR)
    await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true })
    await edit($)
    await ended($, 'turn-1', 'Building in the background.')
    await notified($, 'b0sa8g8ad', 'running')
    await $.turn.start({ text: 'progress', turnId: 'turn-2' })
    await edit($)
    await ended($, 'turn-2', 'Still building.')
    expect(sentBack(w)).toHaveLength(0)

    await notified($, 'b0sa8g8ad')
    await $.turn.start({ text: 'built', turnId: 'turn-3' })
    await edit($)
    await ended($, 'turn-3', 'Built.')
    expect(sentBack(w)).toHaveLength(1)
  })

  test('a background agent holds the bar until its run ends', async ($, on) => {
    const w = world(on)
    w.results.Agent = { status: 'async_launched', agentId: 'agent-7', description: 'Review', prompt: 'Review it', outputFile: 'out.txt' }
    await $.turn.start({ text: 'review it', turnId: 'turn-1' })
    await $.tool.call(TASK_BAR)
    await $.tool.call({ tool: 'Agent', description: 'Review', prompt: 'Review it', run_in_background: true })
    await edit($)
    await ended($, 'turn-1', 'The agent is reviewing.')
    expect(sentBack(w)).toHaveLength(0)

    await ended($, 'agent-turn', 'Reviewed.', 'agent-7')
    await typed($, 'go on')
    await $.turn.start({ text: 'go on', turnId: 'turn-2' })
    await edit($)
    await ended($, 'turn-2', 'Applied the review.')
    expect(sentBack(w)).toHaveLength(1)
  })

  test('a bar waiting on the person stays waiting through an unrelated prompt and is not sent back', async ($, on) => {
    const w = world(on)
    await $.turn.start({ text: 'try it', turnId: 'turn-1' })
    await $.tool.call(TASK_BAR)
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'Run /debug first' })
    await ended($, 'turn-1', 'Run /debug in a new session, then tell me.')
    await typed($, 'something else')
    await $.turn.start({ text: 'something else', turnId: 'turn-2' })
    await edit($)
    await ended($, 'turn-2', 'Done with the other thing.')

    expect(sentBack(w)).toHaveLength(0)
    expect(w.prompts.at(-1)?.context).toContain('plan-progress open bars: task (Build 1/2, needs_input)')
    const ui = await $.ui.mount({ plugin: 'session-hub', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: '?' })).toBeDefined()
  })

  test('a waiting bar still counts as a bar for the refuse-once gate', async ($, on) => {
    world(on)
    await $.turn.start({ text: 'try it', turnId: 'turn-1' })
    await $.tool.call(TASK_BAR)
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'Pick one' })
    await ended($, 'turn-1', 'Pick A or B, then tell me.')
    await typed($, 'A')
    await $.turn.start({ text: 'A', turnId: 'turn-2' })
    const calls = [await edit($), await edit($), await edit($), await edit($)]

    expect(calls.map(c => c.deny)).toEqual([undefined, undefined, undefined, undefined])
  })
})
