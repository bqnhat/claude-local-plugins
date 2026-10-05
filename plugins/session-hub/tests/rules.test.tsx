import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const RULES_HEAD = '# Progress bars'
const TOOL = 'mcp__session-hub__plan_progress'
const KEPT = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

type World = { contexts: (readonly string[])[] }

function world(on: On, skipsCompaction = false): World {
  const w: World = { contexts: [] }
  on('prompt.submit', async (_$, e) => {
    w.contexts.push(e.context ?? [])
    return { text: e.text, context: e.context }
  })
  on('session.compact', async () => (skipsCompaction ? { skip: 'not now' } : { messages: KEPT }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  return w
}

const submit = ($: Engine, text: string, origin: PromptOrigin = { kind: 'composer' }) =>
  $.prompt.submit({ text, wait: false, origin })

const rulesIn = (context: readonly string[] | undefined) =>
  (context ?? []).filter(entry => entry.startsWith(RULES_HEAD)).length

describe('rules delivery', () => {
  test('the first prompt carries the rules once, later prompts do not', async ($, on) => {
    const w = world(on)
    await submit($, 'first')
    await submit($, 'second')

    expect(w.contexts.map(rulesIn)).toEqual([1, 0])
    expect(w.contexts[0]?.[0]).toContain(TOOL)
  })

  test('a prompt from outside the composer carries them too', async ($, on) => {
    const w = world(on)
    await submit($, 'from the sdk', { kind: 'sdk' })
    await submit($, 'typed')

    expect(w.contexts.map(rulesIn)).toEqual([1, 0])
  })

  test('a dropped prompt leaves the rules for the next one', async ($, on) => {
    let dropping = true
    const w: World = { contexts: [] }
    on('prompt.submit', async (_$, e) => {
      w.contexts.push(e.context ?? [])
      return dropping ? { drop: 'blocked' } : { text: e.text, context: e.context }
    })
    await submit($, 'blocked one')
    dropping = false
    await submit($, 'entered one')
    await submit($, 'another')

    expect(w.contexts.map(rulesIn)).toEqual([1, 1, 0])
  })

  test('a compaction of the main conversation sends them again', async ($, on) => {
    const w = world(on)
    await submit($, 'first')
    await $.session.compact({ trigger: 'auto', messages: KEPT })
    await submit($, 'after compaction')

    expect(w.contexts.map(rulesIn)).toEqual([1, 1])
  })

  test('precompute and a subagent compaction keep them sent', async ($, on) => {
    const w = world(on)
    await submit($, 'first')
    await $.session.compact({ trigger: 'precompute', messages: KEPT })
    await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: KEPT })
    await submit($, 'second')

    expect(w.contexts.map(rulesIn)).toEqual([1, 0])
  })

  test('a skipped compaction keeps them sent', async ($, on) => {
    const w = world(on, true)
    await submit($, 'first')
    await $.session.compact({ trigger: 'manual', messages: KEPT })
    await submit($, 'second')

    expect(w.contexts.map(rulesIn)).toEqual([1, 0])
  })

  test('/clear sends them again', async ($, on) => {
    const w = world(on)
    await submit($, 'first')
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    await submit($, 'after clear')

    expect(w.contexts.map(rulesIn)).toEqual([1, 1])
  })

  test('open bars still add their line beside the rules', async ($, on) => {
    const w = world(on)
    mock.clock(on)
    await $.tool.call({
      tool: TOOL,
      id: 'ship',
      title: 'Ship',
      stages: [{ name: 'Build', steps: [{ title: 'Compile', status: 'active' }] }],
    })
    await submit($, 'first')
    await submit($, 'second')

    expect(w.contexts.map(rulesIn)).toEqual([1, 0])
    expect(w.contexts[0]?.some(entry => entry.startsWith('plan-progress open bars: ship'))).toBe(true)
    expect(w.contexts[1]?.some(entry => entry.startsWith('plan-progress open bars: ship'))).toBe(true)
  })
})
