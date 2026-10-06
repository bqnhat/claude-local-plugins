import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'
const PLUGIN = 'session-hub'
const WIDTHS = [30, 40, 80, 160]
const TITLE = 'Migrate the billing service'
const STAGE = 'Implementation'

function world(on: On) {
  const clock = mock.clock(on)
  on('session.surfaces', async () => ({ value: ['terminal' as const] }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.render', async () => <></>)
  return clock
}

const bandProps = (bodyColumns: number) => ({ hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} })

const paneProps = (bodyColumns: number) => ({ title: 'Mod status', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} })

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}]/u

const cells = (text: string): number => [...text].reduce((sum, point) => sum + (WIDE.test(point) ? 2 : 1), 0)

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown }

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as Node).children ?? []) : ''

const kids = (node: Node): Node[] => (Array.isArray(node.children) ? (node.children as unknown[]).flat(Infinity) : []).filter((c): c is Node => c !== null && typeof c === 'object')

const rowWidth = (row: Node): number => {
  const children = kids(row)
  const own = children.map(child => (child.type === 'Button' ? cells(String(child.props?.label ?? '')) : child.type === 'Text' ? cells(flat(child)) : 0))
  return own.reduce((a, b) => a + b, 0) + Math.max(0, children.length - 1) * Number(row.props?.gap ?? 0)
}

const createBar = ($: Engine, id = 'bill', title = TITLE) =>
  $.tool.call({
    tool: TOOL,
    id,
    title,
    stages: [{ name: STAGE, steps: [{ title: 'One', status: 'done' }, { title: 'Two', status: 'active' }, { title: 'Three', status: 'pending' }] }],
  })

async function barRow($: Engine, columns: number, id = 'bill'): Promise<{ width: number; texts: string[]; expand: unknown }> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps(columns) })
  const row = (await ui.find({ type: 'Box', key: `bar-${id}` })) as unknown as Node
  const expand = (await ui.find({ type: 'Button', key: 'progress-expand' }))?.props.label
  const texts = kids(row).filter(c => c.type === 'Text').map(flat)
  await ui.unmount()
  return { width: rowWidth(row), texts, expand }
}

describe('terminal progress band width', () => {
  test('the bar row never runs past the band, and keeps the title, stage and counts whole when there is room', async ($, on) => {
    world(on)
    await createBar($)
    for (const columns of WIDTHS) {
      const { width, texts } = await barRow($, columns)
      expect(width).toBeLessThanOrEqual(columns)
      expect(texts.some(t => t.endsWith('2/3'))).toBe(true)
      expect(texts.some(t => /^ ?\d+%$/.test(t.trim()) || t.endsWith('%'))).toBe(true)
    }
    const wide = await barRow($, 80)
    expect(wide.texts).toContain(TITLE)
    expect(wide.texts.some(t => t.endsWith(` ${STAGE} 2/3`))).toBe(true)
    expect(wide.texts.some(t => t.startsWith('━'.repeat(8)) && t.includes('─'))).toBe(true)
  })

  test('a narrow band shortens the bar first, then the stage name and title, never the step counts', async ($, on) => {
    world(on)
    await createBar($)
    const narrow = await barRow($, 30)
    expect(narrow.texts.some(t => t.endsWith('…'))).toBe(true)
    expect(narrow.texts.some(t => t.endsWith(' 2/3'))).toBe(true)
    const bar = narrow.texts.find(t => t.includes('─')) ?? ''
    expect([...bar.replace(/ .*/, '')].length).toBeLessThan(25)
  })

  test('the expand control keeps its room beside the first bar at every width', async ($, on) => {
    world(on)
    await createBar($, 'one', 'First task with a long name')
    await createBar($, 'two', 'Second task with a long name')
    await $.tool.call({ tool: TOOL, id: 'two', state: 'needs_input', note: 'pick one' })
    for (const columns of WIDTHS) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: bandProps(columns) })
      const rows = (await ui.findAll({ type: 'Box' })).filter(b => String(b.key ?? '').startsWith('bar-')) as unknown as Node[]
      expect(await ui.find({ type: 'Button', key: 'progress-expand' })).toBeDefined()
      for (const row of rows) expect(rowWidth(row)).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })
})

describe('terminal pane tabs', () => {
  test('the tabs and the header wrap onto another line instead of running past a narrow pane', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, props: paneProps(30) })
    const tabs = await ui.find({ type: 'Box', key: 'hub-tabs' })
    const header = await ui.find({ type: 'Box', key: 'hub-header' })
    expect(tabs?.props.flexWrap).toBe('wrap')
    expect(tabs?.props.rowGap ?? 0).toBe(0)
    expect(header?.props.flexWrap).toBe('wrap')
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(expect.arrayContaining(['Progress', 'Next steps', 'Skills & agents']))
    await ui.unmount()
  })
})
