import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'
const PLUGIN = 'session-hub'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

type World = { toasts: string[] }

function world(on: On): World {
  const w: World = { toasts: [] }
  mock.clock(on)
  on('tool.call', async () => ({ result: undefined as never }))
  on('command.run', async () => ({ text: '' }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', async () => <></>)
  return w
}

const createTask = ($: Engine) =>
  $.tool.call({
    tool: TOOL,
    id: 'task',
    title: 'Task',
    stages: [{ name: 'Build', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }, { title: 'Three', status: 'pending' }] }],
  })

const band = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
const footer = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', props: { modes: [] } })

const isDrawn = async ($: Engine) => {
  const ui = await band($)
  const close = await ui.find({ type: 'Button', key: 'close-task' })
  await ui.unmount()
  return close !== undefined
}

describe('closing a bar', () => {
  test('✕ hides the bar, and Progress brings it back instead of the empty-session toast', async ($, on) => {
    const w = world(on)
    await createTask($)
    const ui = await band($)
    await ui.press({ key: 'close-task' })
    await ui.unmount()
    expect(await isDrawn($)).toBe(false)

    const mode = await footer($)
    await mode.press({ key: 'progress-toggle' })
    await mode.unmount()

    expect(w.toasts).toEqual([])
    expect(await isDrawn($)).toBe(true)
  })

  test('a hidden bar stays hidden while Claude moves it on, and /progress shows it at its new step', async ($, on) => {
    world(on)
    await createTask($)
    const ui = await band($)
    await ui.press({ key: 'close-task' })
    await ui.unmount()

    const moved = await $.tool.call({ tool: TOOL, id: 'task', next: true })
    expect(moved.result).toContain('task: 1/3, running, active "Two"')
    expect(await isDrawn($)).toBe(false)

    const shown = await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as never })
    expect(shown.text).toBe('Progress bars shown.')
    expect(await isDrawn($)).toBe(true)
  })

  test('with no bar at all, Progress still shows the toast', async ($, on) => {
    const w = world(on)
    const mode = await footer($)
    await mode.press({ key: 'progress-toggle' })

    expect(w.toasts).toEqual(['plan-progress is on. A bar appears when Claude starts a task with several steps.'])
  })
})
