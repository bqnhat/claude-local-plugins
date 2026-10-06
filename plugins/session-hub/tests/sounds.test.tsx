import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'

type World = { clock: MockClock; listed: AgentInfo[]; played: string[]; release: () => void }

function world(on: On): World {
  const w: World = { clock: mock.clock(on), listed: [], played: [], release: () => undefined }
  on('session.surfaces', async () => ({ value: ['desktop'] }))
  on('session.messages', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('command.run', async () => ({ text: '' }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Bash') await new Promise<void>(resolve => (w.release = resolve))
    return { result: undefined as never }
  })
  on('tool.check', async () => ({ decision: 'ask' as const }))
  on('audio.play', async (_$, e) => {
    w.played.push((e.clip.asset ?? '').replace(/^sounds\/|\.wav$/g, ''))
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('agent.spawn', async (_$, e) => ({ model: 'test-model', agentId: `agent-${e.tool_use_id}` }))
  on('agent.list', async () => ({ value: w.listed }))
  on('ui.render', async () => <></>)
  return w
}

const spawn = ($: Engine, useId: string) =>
  $.agent.spawn({
    tool_use_id: useId,
    prompt: 'look around',
    description: useId,
    subagentType: 'Explore',
    parentModel: 'test-model',
    provider: { kind: 'engine' } as never,
  } as never)

const listed = (id: string, status: string): AgentInfo => ({ id, description: id, type: 'Explore', status })

const BAR = { tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }] }

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

async function started(on: On, $: Engine): Promise<World> {
  const w = world(on)
  await $.session.start({ cwd: '/work' } as never)
  await w.clock.advance(1000)
  return w
}

describe('attention sounds', () => {
  test('a bar marked waiting right before the question rings once for both', async ($, on) => {
    const w = await started(on, $)
    await $.tool.call(BAR)
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'pick one' })
    await w.clock.advance(8000)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    await settle()

    expect(w.played).toEqual(['decision'])
  })

  test('a question long after an old waiting bar still rings', async ($, on) => {
    const w = await started(on, $)
    await $.tool.call(BAR)
    await $.tool.call({ tool: TOOL, id: 'task', state: 'needs_input', note: 'pick one' })
    await w.clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    await settle()

    expect(w.played).toEqual(['decision', 'decision'])
  })

  test('agents failing together under a bar ring the error sound once', async ($, on) => {
    const w = await started(on, $)
    await $.tool.call(BAR)
    await spawn($, 'a')
    await spawn($, 'b')
    await spawn($, 'c')
    w.listed = [listed('agent-a', 'failed'), listed('agent-b', 'failed'), listed('agent-c', 'killed')]
    await w.clock.advance(5000)
    await settle()

    expect(w.played).toEqual(['error'])
  })

  test('each finished batch on the Agents bar stays silent, a failed one still rings', async ($, on) => {
    const w = await started(on, $)
    for (const id of ['a', 'b']) {
      await spawn($, id)
      w.listed = [listed(`agent-${id}`, 'completed')]
      await w.clock.advance(5000)
    }
    await settle()
    expect(w.played).toEqual([])

    await spawn($, 'c')
    w.listed = [listed('agent-c', 'failed')]
    await w.clock.advance(5000)
    await settle()
    expect(w.played).toEqual(['error'])
  })

  test('an agent held on a permission prompt under a task bar rings the decision sound', async ($, on) => {
    const w = await started(on, $)
    await $.tool.call(BAR)
    await spawn($, 'a')
    const call = $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'agent-a', tool_use_id: 'use-1' } as never)
    await settle()
    await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'use-1' } as never)
    await w.clock.advance(1000)
    await settle()
    w.release()
    await call

    expect(w.played).toEqual(['decision'])
  })

  test('/progress-sounds still plays all three', async ($, on) => {
    const w = world(on)
    const reply = await $.command.run({ command: 'progress-sounds' } as never)
    await w.clock.advance(3000)
    await settle()

    expect(w.played).toEqual(['decision', 'error', 'done'])
    expect(reply).toEqual(expect.objectContaining({ text: 'Sounds: decision, error, done.' }))
  })
})
