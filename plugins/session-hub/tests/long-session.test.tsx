import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'session-hub'
const PANE = 'session-hub'
const TOOL = 'mcp__session-hub__plan_progress'
const SVG_LIMIT = 131072
const TEXT_LIMIT = 100_000
const PANE_PROPS = {
  title: 'Mod status',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

type Usage = { read: number; write: number; fresh: number }
type World = { usage: Usage; isPaneUp: boolean; clock: ReturnType<typeof mock.clock> }

function world(on: On): World {
  const w: World = { usage: { read: 0, write: 0, fresh: 0 }, isPaneUp: false, clock: mock.clock(on) }
  on('session.surfaces', async () => ({ value: ['desktop'] as RenderSurface[] }))
  on('session.messages', async () => ({ value: [] }))
  on('session.cwd', async () => ({ value: 'C:\\work\\app' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } as never }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('command.list', async () => ({ value: [] }))
  on('command.run', async () => ({ text: '' }))
  on('ui.open', async () => {
    w.isPaneUp = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: w.isPaneUp ? [{ id: PANE, title: 'Mod status', isShown: true, isFocused: false, isPlaced: true, plugin: PLUGIN }] : [] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('audio.play', async () => ({ value: undefined }))
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('prompt.attachment', async (_$, e) => ({ text: e.text }))
  on('classic.InstructionsLoaded', async () => ({}))
  on('skill.prompt', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5' }))
  on('ui.render', async () => <></>)
  on('turn.step', async function* (_$, e) {
    const u = w.usage
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: u.fresh, output_tokens: 10, cache_read_input_tokens: u.read, cache_creation_input_tokens: u.write, model: 'claude-sonnet-5-5' },
    } as never
  })
  return w
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

const mountPane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })

async function press($: Engine, key: string) {
  const ui = await mountPane($)
  await ui.press({ key })
  await ui.unmount()
}

type Snapshot = { texts: string[]; labels: string[]; svgs: string[]; keys: string[]; weight: number }

async function snapshot($: Engine): Promise<Snapshot> {
  const ui = await mountPane($)
  const texts = (await ui.findAll({ type: 'Text' })).map(flat)
  const labels = (await ui.findAll({ type: 'Button' })).map(one => String(one.props.label))
  const svgs = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.source))
  const alts = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.alt))
  const keys = (await ui.findAll({ type: 'Box' })).map(one => String(one.key ?? ''))
  await ui.unmount()
  return { texts, labels, svgs, keys, weight: [...texts, ...labels, ...alts, ...keys].join('').length }
}

async function turn($: Engine, w: World, n: number, work: ($: Engine) => Promise<unknown> = async () => undefined) {
  const turnId = `t${n}`
  await w.clock.advance(1000)
  await $.prompt.submit({ text: `step ${n}`, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: `step ${n}`, turnId })
  await work($)
  w.usage = { read: 40_000 + n, write: 900, fresh: 120 }
  for await (const _chunk of $.turn.step({ turnId, index: 0, model: 'claude-sonnet-5-5', messageCount: 1 } as never)) {
  }
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId })
}

const memory = ($: Engine, n: number) => $.prompt.attachment({ type: 'nested_memory', text: `Contents of C:\\work\\app\\.claude\\rules\\frontend\\component-conventions-${n}.md:\n\nrules`, origin: { kind: 'engine' } } as never)

describe('a long working day', () => {
  test('200 turns of skills, rule files and requests stay capped, newest first, and every drawing fits the engine', { timeoutMs: 180_000 }, async ($, on) => {
    const w = world(on)
    for (let n = 1; n <= 200; n++) {
      await turn($, w, n, async $ => {
        await $.tool.call({ tool: 'Skill', skill: `skill-${n}-a` })
        await $.tool.call({ tool: 'Skill', skill: `skill-${n}-b` })
        await memory($, n * 2)
        await memory($, n * 2 + 1)
      })
    }
    for (let i = 0; i < 1800; i++) {
      w.usage = { read: 30_000, write: 500, fresh: 80 }
      for await (const _chunk of $.turn.step({ turnId: 't200', index: i + 1, model: 'claude-sonnet-5-5', messageCount: 1 } as never)) {
      }
    }

    await press($, 'rail-calls')
    const calls = await snapshot($)
    const turnHeads = calls.texts.filter(line => /^Turn \d+ · /.test(line)).map(line => line.split(' · ')[0])
    expect(turnHeads.slice(0, 3)).toEqual(['Turn 200', 'Turn 199', 'Turn 198'])
    expect(calls.labels).toContain('Show 147 older turns')
    expect(calls.texts).toContain('Rules & CLAUDE.md · 200')
    expect(calls.svgs.every(one => one.length < SVG_LIMIT)).toBe(true)

    await press($, 'calls-older')
    await press($, 'calls-files-toggle')
    const open = await snapshot($)
    const openHeads = open.texts.filter(line => /^Turn \d+ · /.test(line)).map(line => Number(line.split(' · ')[0].slice(5)))
    expect(openHeads).toHaveLength(150)
    expect(openHeads).toEqual([...openHeads].sort((a, b) => b - a))
    expect(open.texts.filter(line => /^skill-\d+-[ab]$/.test(line))).toHaveLength(300)
    expect(open.texts.filter(line => /conventions-\d+\.md$/.test(line))).toHaveLength(200)
    expect(open.svgs.every(one => one.length < SVG_LIMIT)).toBe(true)
    expect(open.weight).toBeLessThan(TEXT_LIMIT * 0.8)

    await press($, 'rail-cache')
    const cache = await snapshot($)
    expect(cache.texts).toContain('Session · 200 turns · 2000 requests')
    expect(cache.keys.filter(key => key.startsWith('cache-row-'))).toEqual(Array.from({ length: 100 }, (_, i) => `cache-row-${200 - i}`))
    expect(cache.svgs.every(one => one.length < SVG_LIMIT)).toBe(true)
  })

  test('40 finished plans keep 30, show three recent, page the rest behind one button, newest first', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on)
    for (let n = 1; n <= 40; n++) {
      await turn($, w, n, async $ => {
        await $.tool.call({ tool: TOOL, id: `plan-${n}`, title: `Plan ${n}`, stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }] }] })
        await $.tool.call({ tool: TOOL, id: `plan-${n}`, state: 'done' })
      })
    }
    const closed = await snapshot($)
    const titles = (s: Snapshot) => [...s.labels, ...s.texts].filter(one => /^Plan \d+$/.test(one))
    expect(titles(closed)).toEqual(['Plan 40', 'Plan 39', 'Plan 38'])
    expect(closed.labels).toContain('Show 27 older')
    await press($, 'older')
    const opened = await snapshot($)
    const all = titles(opened).map(one => Number(one.slice(5)))
    expect(all).toHaveLength(30)
    expect(all).toEqual([...all].sort((a, b) => b - a))
    expect(all[0]).toBe(40)
    expect(opened.svgs.every(one => one.length < SVG_LIMIT)).toBe(true)
  })
})

const LIGHT = '#FAF9F5'
const DARK = '#262624'

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

async function textColors($: Engine, surface: RenderSurface = 'desktop'): Promise<Map<string, string>> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const found = new Map<string, string>()
  for (const one of await ui.findAll({ type: 'Text' })) if (typeof one.props.color === 'string') found.set(flat(one), String(one.props.color))
  await ui.unmount()
  return found
}

describe('light and dark themes', () => {
  test('coloured text is a theme colour or a fixed one readable on both a light and a dark background', async ($, on) => {
    const w = world(on)
    await turn($, w, 1, async $ => {
      await $.tool.call({ tool: TOOL, id: 'ask', title: 'Ask', stages: [{ name: 'Work', steps: [{ title: 'Pick', status: 'active' }] }] })
      await $.tool.call({ tool: TOOL, id: 'ask', state: 'needs_input', note: 'Pick a name' })
      await $.tool.call({ tool: TOOL, id: 'ok', title: 'Ok', stages: [{ name: 'Work', steps: [{ title: 'Ship', status: 'done' }, { title: 'Check', status: 'active' }] }] })
    })
    await press($, 'toggle-ask')
    await press($, 'toggle-ok')
    const progress = await textColors($)
    expect(progress.get('Pick a name')).toBe('warning')

    await turn($, w, 2)
    await press($, 'rail-cache')
    const cache = await textColors($)
    expect(cache.get('wrote 900')).toBe('#BA7517')
    expect(cache.get('read 40k')).toBe('#1D9E75')

    const fixed = [...progress, ...cache].filter(([, color]) => color.startsWith('#'))
    expect(fixed.filter(([, color]) => contrast(color, LIGHT) < 3 || contrast(color, DARK) < 3)).toEqual([])
  })
})
