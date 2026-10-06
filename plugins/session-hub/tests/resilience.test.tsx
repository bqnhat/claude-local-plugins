import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

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

function world(on: On): { logged: string[] } {
  const w = { logged: [] as string[] }
  mock.clock(on)
  on('session.surfaces', async () => ({ value: ['desktop' as const] }))
  on('session.messages', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.log', async (_$, e) => {
    w.logged.push(e.text)
    return { value: undefined }
  })
  on('ui.render', async () => <></>)
  return w
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

const pane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })

const bigPlan = (stages: number, steps: number, substeps: number) => ({
  id: 'big',
  title: 'Big',
  stages: Array.from({ length: stages }, (_, i) => ({
    name: `Stage ${i}`,
    steps: Array.from({ length: steps }, (_, j) => ({
      title: `Step ${i}.${j} ${'x'.repeat(100)}`,
      status: 'pending',
      substeps: Array.from({ length: substeps }, (_, k) => ({ title: `Part ${k}`, status: 'pending' })),
    })),
  })),
})

describe('when something fails', () => {
  test('a section that throws while drawing keeps the rail and the other sections, says why in its body and logs it once', async ($, on) => {
    const w = world(on)
    on('state.set', async (_$, e, next) => next(e.plugin === PLUGIN && e.key === 'plans' ? { ...e, value: [{ id: 'old', title: 'Old', state: 'running', startedAt: 0 }] } : e))
    await $.tool.call({ tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }] }] })

    const ui = await pane($)
    const texts = (await ui.findAll({ type: 'Text' })).map(flat)
    expect(texts.some(text => text.startsWith("Couldn't draw Progress: "))).toBe(true)
    for (const id of ['progress', 'next', 'calls', 'cache']) expect(await ui.find({ type: 'Button', key: `rail-${id}` })).toBeDefined()
    await ui.redraw()
    expect(w.logged.filter(line => line.startsWith('Progress failed to draw: '))).toHaveLength(1)

    await ui.press({ key: 'rail-calls' })
    expect((await ui.findAll({ type: 'Text' })).map(flat)).toContain('No skills or agents called yet.')
    await ui.unmount()
  })

  test('a plan far larger than a bar can show is cut to the limits, the reply says so, and the opened bar still draws', async ($, on) => {
    world(on)
    const reply = await $.tool.call({ tool: TOOL, ...bigPlan(50, 50, 30) })

    expect(JSON.stringify(reply)).toContain('big: 0/120, running; kept 120 steps in 3 stages, the bar holds at most 12 stages, 120 steps and 12 substeps per step')
    const ui = await pane($)
    await ui.press({ key: 'toggle-big' })
    expect(await ui.find({ type: 'Box', key: 'detail-big' })).toBeDefined()
    expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
    expect((await ui.findAll({ type: 'Text' })).map(flat).filter(text => text.startsWith('Part ')).length).toBeLessThanOrEqual(120 * 12)
    await ui.unmount()
  })

  test('a plan within the limits is kept whole and its reply has no note about cutting', async ($, on) => {
    world(on)
    const reply = await $.tool.call({ tool: TOOL, ...bigPlan(12, 10, 12) })

    expect(JSON.stringify(reply)).toContain('big: 0/120, running')
    expect(JSON.stringify(reply)).not.toContain('kept')
  })
})

describe('the sound fallback', () => {
  test('hands PowerShell the sound path through the environment, never inside the command text', async ($, on) => {
    mock.clock(on)
    const runs: { argv: readonly string[]; env?: Record<string, string> }[] = []
    on('session.surfaces', async () => ({ value: ['desktop' as const] }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async () => ({ value: undefined }))
    on('audio.play', async () => {
      throw new Error('no player')
    })
    on('process.run', async (_$, e) => {
      runs.push({ argv: e.argv, env: e.init?.env })
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never }
    })
    await $.command.run({ command: 'progress-sounds' } as never)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(runs.length).toBeGreaterThan(0)
    for (const run of runs) {
      expect(run.argv.at(-1)).toBe('(New-Object Media.SoundPlayer $env:SESSION_HUB_SOUND).PlaySync()')
      expect(run.argv.join(' ')).not.toContain('sounds')
      const sound = run.env?.SESSION_HUB_SOUND ?? ''
      expect(['decision', 'error', 'done'].some(name => sound.endsWith(`\\sounds\\${name}.wav`))).toBe(true)
    }
  })

  async function ring(on: On, $: Engine, surfaces: ('terminal' | 'desktop')[], env: Record<string, string>) {
    mock.clock(on)
    mock.env(on, env)
    const heard = { engine: 0, powershell: 0 }
    on('session.surfaces', async () => ({ value: surfaces }))
    on('command.register', async () => ({ value: undefined }))
    on('tool.register', async () => ({ value: undefined }))
    on('audio.play', async () => {
      heard.engine += 1
      return { value: undefined }
    })
    on('process.run', async () => {
      heard.powershell += 1
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never }
    })
    await $.command.run({ command: 'progress-sounds' } as never)
    await new Promise(resolve => setTimeout(resolve, 50))
    return heard
  }

  test('a Windows terminal, whose engine player resolves without a sound, rings through PowerShell', async ($, on) => {
    expect(await ring(on, $, ['terminal'], { OS: 'Windows_NT' })).toEqual({ engine: 0, powershell: 1 })
  })

  test('the desktop app on Windows keeps the engine player', async ($, on) => {
    expect(await ring(on, $, ['terminal', 'desktop'], { OS: 'Windows_NT' })).toEqual({ engine: 1, powershell: 0 })
  })

  test('a terminal off Windows keeps the engine player', async ($, on) => {
    expect(await ring(on, $, ['terminal'], {})).toEqual({ engine: 1, powershell: 0 })
  })
})
