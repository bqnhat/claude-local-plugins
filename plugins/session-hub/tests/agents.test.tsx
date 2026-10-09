import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'
const PLUGIN = 'session-hub'
const PANE_PROPS = { title: 'Mod status', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }

type World = { clock: MockClock; listed: AgentInfo[]; sentBack: string[] }

function world(on: On): World {
  const w: World = { clock: mock.clock(on), listed: [], sentBack: [] }
  on('session.surfaces', async () => ({ value: ['desktop'] }))
  on('session.messages', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => {
    if (e.origin.kind === 'plugin') w.sentBack.push(e.text)
    return { text: e.text, context: e.context }
  })
  on('agent.spawn', async (_$, e) => ({ model: 'test-model', agentId: `agent-${e.tool_use_id}` }))
  on('agent.list', async () => ({ value: w.listed }))
  on('ui.render', async () => <></>)
  return w
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

async function texts($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
  const all = (await ui.findAll({ type: 'Text' })).map(flat)
  await ui.unmount()
  return all
}

const spawn = ($: Engine, useId: string, description: string, parentAgentId?: string) =>
  $.agent.spawn({
    tool_use_id: useId,
    prompt: 'look around',
    description,
    subagentType: 'Explore',
    parentModel: 'test-model',
    provider: { kind: 'engine' } as never,
    ...(parentAgentId ? { parentAgentId } : {}),
  } as never)

const ended = ($: Engine, useId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({ reason, answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId: `turn-${useId}`, agentId: `agent-${useId}` } as never)

const listed = (id: string, status: string): AgentInfo => ({ id, description: id, type: 'Explore', status })

async function details($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
  await ui.press({ key: 'toggle-agents:auto' })
  await ui.unmount()
  return texts($)
}

describe('agents that end without their own turn end', () => {
  test('an agent the engine lists as killed stops on the Agents bar while the others keep running', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await w.clock.advance(1000)
    await spawn($, 'a', 'Scout')
    await spawn($, 'b', 'Builder')
    w.listed = [listed('agent-a', 'killed'), listed('agent-b', 'running')]
    await w.clock.advance(5000)

    expect(await details($)).toEqual(expect.arrayContaining(['Stopped', '1 running · 1 failed', expect.stringMatching(/^Started \d\d:\d\d · 0\/2 agents done$/)]))
  })

  test('the last agent the engine lists as completed finishes the Agents bar', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await w.clock.advance(1000)
    await spawn($, 'a', 'Scout')
    w.listed = [listed('agent-a', 'completed')]
    await w.clock.advance(5000)

    expect(await texts($)).toEqual(expect.arrayContaining(['Done · 1', '1/1 agent done']))
  })

  test('an agent gone from under an open bar no longer holds the bar from being sent back', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await w.clock.advance(1000)
    await $.turn.start({ text: 'do it', turnId: 'turn-1' })
    await $.tool.call({ tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }] })
    await spawn($, 'a', 'Scout')
    await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
    w.listed = [listed('agent-a', 'failed')]
    await w.clock.advance(5000)
    await $.turn.complete({ reason: 'answer', answer: 'Done for now.', durationMs: 1, isAborted: false, turnId: 'turn-1' } as never)

    expect(w.sentBack.filter(text => text.includes('still open'))).toHaveLength(1)
  })

  test('an agent whose own turn ended first is left as it ended', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work' } as never)
    await w.clock.advance(1000)
    await spawn($, 'a', 'Scout')
    await ended($, 'a', 'error')
    w.listed = [listed('agent-a', 'completed')]
    await w.clock.advance(5000)

    expect(await details($)).toEqual(expect.arrayContaining(['Failed', '1 failed']))
  })
})
