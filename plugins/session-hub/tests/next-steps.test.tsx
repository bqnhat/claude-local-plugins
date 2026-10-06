import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const PLUGIN = 'session-hub'
const TOOL = 'mcp__session-hub__plan_progress'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const LONG_ANSWER = 'The change is in place and the tests pass. '.repeat(3)

type Entry = { kind?: unknown; label?: unknown; why?: unknown; prompt?: unknown }

const ANALYSIS = '<analysis>\ngoal: Ship the settings fix [v2]\nstate: tests written\ncrux: does it hold on Windows\nrisk: none seen\n</analysis>'

const forkReply = (entries: Entry[], analysis = ANALYSIS) => `${analysis}\n<suggestions>${JSON.stringify(entries)}</suggestions>`

const entry = (label: string, prompt: string, kind = 'verify', why = `Why: ${label}`) => ({ kind, label, why, prompt })

const SUGGESTIONS = forkReply([
  entry('Run the tests', 'run the tests you just wrote', 'verify'),
  entry('Review it', '/code-review high', 'dig'),
  entry('Unknown command', '/no-such-command now', 'advance'),
  entry('Settings page', 'do the same for the settings page', 'advance'),
  entry('Fourth one', 'this one is past the limit', 'decide'),
])

type CriticCall = { model: string; prompt: string; system?: string; effort?: string; maxTokens?: number; timeoutMs?: number }

type World = {
  clock: MockClock
  forkPrompts: string[]
  criticCalls: CriticCall[]
  filled: { text: string; mode: string }[]
  suggested: string[]
  submitted: string[]
  logged: string[]
  shown: string[]
  panes: Set<string>
  opened: { id: string; title?: string }[]
  behind: Set<string>
  unplaced: string
  toasts: string[]
  paneReads: number
  beforeClose: (() => Promise<void>) | null
}

function world(on: On, reply: string | Error = SUGGESTIONS, gate?: Promise<void>, criticReply: string | Error | null = null): World {
  const w: World = {
    clock: mock.clock(on),
    forkPrompts: [],
    criticCalls: [],
    filled: [],
    suggested: [],
    submitted: [],
    logged: [],
    shown: [],
    panes: new Set(),
    opened: [],
    behind: new Set(),
    unplaced: '',
    toasts: [],
    paneReads: 0,
    beforeClose: null,
  }
  on('session.surfaces', async () => ({ value: ['desktop' as const] }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('command.list', async () => ({
    value: [
      { name: 'code-review', description: 'Review the current diff', source: 'plugin' as const },
      { name: 'clear', description: 'Clear the conversation', source: 'builtin' as const },
    ],
  }))
  on('model.fork', async (_$, e) => {
    w.forkPrompts.push(e.prompt)
    await gate
    if (reply instanceof Error) throw reply
    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  on('model.complete', async (_$, e) => {
    w.criticCalls.push({ model: e.model, prompt: e.prompt, system: e.system, effort: e.effort, maxTokens: e.maxTokens, timeoutMs: e.timeoutMs })
    if (criticReply instanceof Error) throw criticReply
    if (criticReply === null) return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } }
    return { value: { isAnswered: true as const, text: criticReply, usage: USAGE } }
  })
  on('prompt.fill', async (_$, e) => {
    w.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.suggest', async (_$, e) => {
    w.suggested.push(e.text)
    return { isShown: true }
  })
  on('prompt.submit', async (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.log', async (_$, e) => {
    w.logged.push(e.text)
    if (e.to !== 'debug') w.shown.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async (_$, e) => {
    w.panes.add(e.id)
    w.opened.push({ id: e.id, title: e.title })
    return { value: w.unplaced === '' ? { isPlaced: true as const } : { isPlaced: false as const, reason: w.unplaced } }
  })
  on('ui.close', async (_$, e) => {
    await w.beforeClose?.()
    w.panes.delete(e.id)
    w.behind.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => {
    w.paneReads += 1
    return { value: [...w.panes].map(id => ({ id, title: id, isShown: !w.behind.has(id), isFocused: false, isPlaced: w.unplaced === '' })) }
  })
  on('ui.render', async () => <></>)
  return w
}

async function completeTurn($: Engine, w: World, answer = LONG_ANSWER, turnId = 'turn-1') {
  await $.turn.complete({
    reason: 'answer',
    answer,
    durationMs: 1,
    isAborted: false,
    turnId,
  })
  await w.clock.settle()
}

describe('terminal renderer', () => {
  test('offers at most three known suggestions as 1/2/3 buttons marked by kind and fills a draft', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.props.label)).toEqual([
      '✓ Run the tests',
      '🔍 Review it',
      '→ Settings page',
      'dismiss',
    ])
    expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '0'])
    expect(await ui.find({ type: 'Text', text: 'next:' })).toBeDefined()
    expect(w.suggested).toEqual(['run the tests you just wrote'])

    await ui.press({ key: '🔍 Review it' })
    expect(w.filled).toEqual([{ text: '/code-review high', mode: 'replace' }])
    expect(w.submitted).toEqual([])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  })

  test('a long label is shortened to the band width but stays whole when it fits, and still fills its draft', async ($, on) => {
    const long = 'Rerun the whole integration suite on Windows'
    const w = world(on, forkReply([entry(long, 'rerun the integration suite on windows')]))
    await completeTurn($, w)
    const labelAt = async (bodyColumns: number) => {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns } })
      const label = String((await ui.findAll({ type: 'Button' }))[0]?.props.label)
      await ui.unmount()
      return label
    }

    for (const bodyColumns of [30, 40]) {
      const label = await labelAt(bodyColumns)
      expect(label.endsWith('…')).toBe(true)
      expect([...label].length + 1 + 2 + 2).toBeLessThanOrEqual(bodyColumns)
    }
    expect(await labelAt(80)).toBe(`✓ ${long}`)
    expect(await labelAt(160)).toBe(`✓ ${long}`)

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 30 } })
    await ui.press({ key: `✓ ${long}` })
    expect(w.filled).toEqual([{ text: 'rerun the integration suite on windows', mode: 'replace' }])
  })
})

const PANE_PROPS = {
  title: 'Mod status',
  isFocused: false,
  bodyColumns: 47,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const pane = ($: Engine, bodyColumns = 47) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'session-hub', props: { ...PANE_PROPS, bodyColumns } })

const footer = ($: Engine, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', props: { modes: [] } })

type Drawn = { findAll: (q: { type: 'Text' | 'Button' }) => Promise<{ key?: string; text?: string; props: Record<string, unknown> }[]> }

async function rowTexts(ui: Drawn) {
  return (await ui.findAll({ type: 'Text' })).slice(2).filter(t => !String(t.text).startsWith('🎯 '))
}

async function labels(ui: Drawn): Promise<string[]> {
  return (await rowTexts(ui)).filter((_, i) => i % 2 === 0).map(t => String(t.text))
}

async function whys(ui: Drawn): Promise<string[]> {
  return (await rowTexts(ui)).filter((_, i) => i % 2 === 1).map(t => String(t.text))
}

async function goalLine(ui: Drawn): Promise<string | undefined> {
  const found = (await ui.findAll({ type: 'Text' })).find(t => String(t.text).startsWith('🎯 '))
  return found === undefined ? undefined : String(found.text)
}

async function paneLabels($: Engine): Promise<string[]> {
  const ui = await pane($)
  const all = await labels(ui)
  await ui.unmount()
  return all
}

async function stepButtons(ui: Drawn) {
  return (await ui.findAll({ type: 'Button' })).filter(b => /^next-step-\d+$/.test(b.key ?? ''))
}

async function header($: Engine): Promise<string[]> {
  const ui = await pane($)
  const all = (await ui.findAll({ type: 'Text' })).slice(0, 2).map(t => String(t.text))
  await ui.unmount()
  return all
}

async function chipLabel($: Engine, surface: 'desktop' | 'terminal' = 'desktop'): Promise<unknown> {
  const ui = await footer($, surface)
  const chip = await ui.find({ type: 'Button', key: 'hub-toggle' })
  await ui.unmount()
  return chip?.props.label
}

async function pressChip($: Engine) {
  const ui = await footer($)
  await ui.press({ key: 'hub-toggle' })
  await ui.unmount()
}

describe('desktop renderer', () => {
  test('draws nothing above the prompt', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('the one footer entry counts the suggestions, and only while there are some', async ($, on) => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const w = world(on, SUGGESTIONS, held)
    expect(await chipLabel($)).toBe('Mods')

    await completeTurn($, w)
    expect(await chipLabel($)).toBe('Mods')

    release()
    await w.clock.settle()
    expect(await chipLabel($)).toBe('💡 3')
    expect(await chipLabel($, 'terminal')).toBeUndefined()
  })

  test('the entry sits before the footer drawn beneath it', async ($, on) => {
    on('ui.render', { component: 'SessionMode' }, async ($$, e) => {
      const { Text } = $$.ui.resolve(e)
      return <Text>focus</Text>
    })
    const w = world(on)
    await completeTurn($, w)
    const ui = await footer($)
    const row = (await ui.drawn()) as { children?: { type?: string; props?: { key?: string } }[] }
    expect((row.children ?? []).map(kid => kid.props?.key ?? kid.type)).toEqual(['hub-toggle', 'Text'])
    await ui.unmount()
    const terminal = await footer($, 'terminal')
    expect(await terminal.find({ type: 'Text', text: 'focus' })).toBeDefined()
  })

  test('a footer already on screen gains the count when the suggestions arrive and loses it on the next turn', async ($, on) => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const w = world(on, forkReply([entry('Only one', 'p')]), held)
    const ui = await footer($)
    await completeTurn($, w)
    expect((await ui.find({ type: 'Button', key: 'hub-toggle' }))?.props.label).toBe('Mods')

    release()
    await w.clock.settle()
    expect((await ui.find({ type: 'Button', key: 'hub-toggle' }))?.props.label).toBe('💡 1')

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })
    expect((await ui.find({ type: 'Button', key: 'hub-toggle' }))?.props.label).toBe('Mods')
  })

  test('the entry is a plain footer label, like the labels beside it', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await footer($)

    expect((await ui.find({ type: 'Button', key: 'hub-toggle' }))?.props.plain).toBe(true)
  })

  test('suggestions open the Mod status pane on its Next steps section', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.opened).toEqual([{ id: 'session-hub', title: 'Mod status' }])
    expect(await header($)).toEqual(['Next steps', '3'])
  })

  test('the footer entry closes the pane and opens it again', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    await pressChip($)
    expect([...w.panes]).toEqual([])
    await pressChip($)
    expect([...w.panes]).toEqual(['session-hub'])
  })

  test('the footer entry brings a covered pane forward by closing and opening it afresh', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    w.behind.add('session-hub')

    await pressChip($)
    expect([...w.panes]).toEqual(['session-hub'])
    expect(w.opened).toHaveLength(2)
    expect(w.behind.has('session-hub')).toBe(false)
  })

  test('the rail switches sections and marks the one with news', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await pane($)
    expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toEqual(['Progress', 'Next steps · selected', 'Skills & agents', 'Cache'])
    await ui.press({ key: 'rail-progress' })
    await ui.unmount()

    expect((await header($))[0]).toBe('Progress')
    const again = await pane($)
    const icons = await again.findAll({ type: 'Svg' })
    const next = icons.find(svg => String(svg.props.alt).startsWith('Next steps'))
    const progress = icons.find(svg => String(svg.props.alt).startsWith('Progress'))
    expect(String(next?.props.alt)).toMatch(/^Next steps · \d+ new suggestions?$/)
    expect(progress?.props.alt).toBe('Progress · selected')
    expect(String(next?.props.source)).toContain('<circle cx="32" cy="10" r="3" fill="#8B7CF6"/>')
    expect(String(next?.props.source)).not.toContain('<rect')
    expect(String(progress?.props.source)).toContain('<rect x="0" y="6" width="2"')
    expect(next?.props).toMatchObject({ width: 44, height: 36 })
  })

  test('while the suggestions are being worked out the pane says so instead of saying there are none', async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const w = world(on, SUGGESTIONS, gate)
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 'turn-1' })

    let ui = await pane($)
    if ((await ui.find({ type: 'Button', key: 'rail-next' })) !== undefined) await ui.press({ key: 'rail-next' })
    await ui.unmount()
    ui = await pane($)
    expect(await ui.find({ type: 'Text', text: 'Working out next steps…' })).toBeDefined()
    await ui.unmount()

    release()
    await w.clock.settle()
    ui = await pane($)
    expect(await ui.find({ type: 'Text', text: 'Working out next steps…' })).toBeUndefined()
  })

  test('a new turn clears the list but leaves the pane where the person put it', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })

    expect([...w.panes]).toEqual(['session-hub'])
    const ui = await pane($)
    expect(await ui.find({ type: 'Text', text: 'No suggestions right now.' })).toBeDefined()
  })

  test('the pane shows each suggestion as a bordered card: its kind and label over its why; a press fills the draft and keeps the list', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await pane($)

    const buttons = await stepButtons(ui)
    expect(buttons.map(b => b.key)).toEqual(['next-step-1', 'next-step-2', 'next-step-3'])
    expect(buttons.every(b => b.props.hotkey === undefined && b.props.label === ' '.repeat(129))).toBe(true)
    expect((await ui.find({ type: 'Box', key: 'next-step-row-1' }))?.props).toMatchObject({ borderStyle: 'round', position: 'relative' })
    expect(await labels(ui)).toEqual(['✓ Run the tests', '🔍 Review it', '→ Settings page'])
    expect((await ui.find({ type: 'Box', key: 'next-step-hit-2' }))?.props).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'stretch', overflow: 'hidden' })
    expect((await rowTexts(ui)).filter((_, i) => i % 2 === 1).map(t => [t.text, t.props.wrap])).toEqual([
      ['Why: Run the tests', 'wrap'],
      ['Why: Review it', 'wrap'],
      ['Why: Settings page', 'wrap'],
    ])

    await ui.press({ key: 'next-step-2' })
    await ui.press({ key: 'next-step-1' })
    await w.clock.settle()
    expect(w.filled).toEqual([
      { text: '/code-review high', mode: 'replace' },
      { text: 'run the tests you just wrote', mode: 'replace' },
    ])
    expect(w.submitted).toEqual([])
    expect(await stepButtons(ui)).toHaveLength(3)
  })

  test('the card never shows the prompt, and a press still fills the whole prompt', async ($, on) => {
    const prompt = `${'abcd '.repeat(117)}abcde`
    expect(prompt).toHaveLength(590)
    const w = world(on, forkReply([entry('Long one', prompt, 'dig', 'Settles whether the cache is the cause')]))
    await completeTurn($, w)
    const ui = await pane($)

    expect(await whys(ui)).toEqual(['Settles whether the cache is the cause'])
    await ui.press({ key: 'next-step-1' })
    expect(w.filled).toEqual([{ text: prompt, mode: 'replace' }])
  })

  test('counts wide letters twice, so a Japanese label is cut to the pane width', async ($, on) => {
    const w = world(on, forkReply([entry('修正したファイルのテストを全部実行して結果を確認する', 'p')]))
    await completeTurn($, w)
    const ui = await pane($, 33)

    expect((await labels(ui))[0]).toBe('✓ 修正したファイ…')
  })

  test('cuts a label by code point, never inside a surrogate pair', async ($, on) => {
    const w = world(on, forkReply([entry('𝐀'.repeat(40), 'p')]))
    await completeTurn($, w)
    const ui = await pane($, 33)

    expect((await labels(ui))[0]).toBe(`✓ ${'𝐀'.repeat(15)}…`)
  })

  test('a very narrow pane still keeps a readable piece of each label', async ($, on) => {
    const w = world(on, forkReply([entry('Trace why the chip test was not rebuilt', 'first')]))
    await completeTurn($, w)
    const ui = await pane($, 4)

    expect((await labels(ui))[0]).toBe('✓ Trace why…')
  })

  test('the suggestions are kept in the session state, so a reload of the plugin keeps them', async ($, on) => {
    const saved: unknown[] = []
    const w = world(on)
    on('state.set', async (_$, e, next) => {
      if ((e as { key?: string }).key === 'view') saved.push((e as { value?: unknown }).value)
      return next(e)
    })
    await completeTurn($, w)
    expect(saved.at(-1)).toMatchObject({
      kind: 'offer',
      goal: 'Ship the settings fix [v2]',
      items: [{ label: 'Run the tests' }, { label: 'Review it' }, { label: 'Settings page' }],
    })

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })
    await w.clock.settle()
    expect(saved.at(-1)).toEqual({ kind: 'hidden' })
  })

  test('asks the fork for short labels and whys', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('label: at most 28 characters')
    expect(w.forkPrompts[0]).toContain('why: at most 70 characters')
  })
})

describe('shared behaviour', () => {
  test('terminal: a new turn hides the suggestions', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Button' })).toBeDefined()

    await $.turn.start({ text: 'next prompt', turnId: 'turn-2' })

    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test('terminal: nothing is drawn while the model works or a survey holds the band', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    for (const props of [
      { ...BAND_PROPS, isWorking: true },
      { ...BAND_PROPS, hasSurvey: true },
    ]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('skips answers shorter than minAnswerChars', { options: { minAnswerChars: 500 } }, async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts).toEqual([])
  })

  test('lists plugin commands for the fork and leaves builtins out', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts).toHaveLength(1)
    expect(w.forkPrompts[0]).toContain('<available-skills>')
    expect(w.forkPrompts[0]).toContain('/code-review: Review the current diff')
    expect(w.forkPrompts[0]).not.toContain('/clear')
  })

  test('asks the fork for the prompts worth sending, not the most likely ones', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('not the ones that are merely the most likely')
    expect(w.forkPrompts[0]).toContain('left unverified')
    expect(w.forkPrompts[0]).toContain('how to tell it is done')
    expect(w.forkPrompts[0]).toContain('under 280 characters')
    expect(w.forkPrompts[0]).not.toContain('Prefer the obvious next action')
  })

  test('suggestSkills false keeps the command list out of the fork', { options: { suggestSkills: false } }, async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts).toHaveLength(1)
    expect(w.forkPrompts[0]).not.toContain('<available-skills>')
  })

  test('a failed fork logs and shows nothing', async ($, on) => {
    const w = world(on, new Error('boom'))
    await completeTurn($, w)

    expect(await chipLabel($)).toBe('Mods')
    expect(w.logged.some(line => line.includes('fork failed'))).toBe(true)
  })

  test('cleans escapes and controls, and refuses tag characters', async ($, on) => {
    const reply = forkReply([
      { kind: 'verify', label: 'Clean\u001b[31m me​', why: 'tidy\u0007 why', prompt: 'run\u0007 the\n\ntests' },
      { kind: 'dig', label: 'Hidden', why: 'w', prompt: 'hello\u{E0041}' },
    ])
    const w = world(on, reply)
    await completeTurn($, w)
    const ui = await pane($)

    expect(await stepButtons(ui)).toHaveLength(1)
    expect(await labels(ui)).toEqual(['✓ Clean me'])
    expect(await whys(ui)).toEqual(['tidy why'])
    await ui.press({ key: 'next-step-1' })
    expect(w.filled).toEqual([{ text: 'run the tests', mode: 'replace' }])
  })
})

describe('suggestion shape', () => {
  test('asks for an analysis first and one to three suggestions inside <suggestions>, at most one of each kind', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('<analysis>')
    expect(w.forkPrompts[0]).toContain('question: the one open question')
    expect(w.forkPrompts[0]).toContain('- decide: in place of verify')
    expect(w.forkPrompts[0]).toContain('Write one to three suggestions, at most one of each kind')
    expect(w.forkPrompts[0]).toContain('<suggestions>[{"kind": "verify|decide|dig|advance"')
    expect(w.forkPrompts[0]).not.toContain('crux:')
    expect(w.forkPrompts[0]).not.toContain('6 in all')
  })

  test('asks for label and why in plain Vietnamese with no internal terms and no arrow shorthand', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('Write label and why in Vietnamese that the user understands at a glance')
    expect(w.forkPrompts[0]).toContain('Never put internal terms in label or why: crux, slot, verify, dig, advance, decide, analysis.')
    expect(w.forkPrompts[0]).toContain('one plain sentence saying what the user learns or gains from it')
    expect(w.forkPrompts[0]).not.toContain('yes →')
    expect(w.forkPrompts[0]).not.toContain('no →')
  })

  test('a long why wraps onto more lines and is shown whole', async ($, on) => {
    const why = 'Cho biết bản cài trên máy có đúng là bản vừa sửa hay không, để khỏi đánh giá nhầm trên bản cũ'
    const w = world(on, forkReply([entry('Kiểm tra bản đang cài', 'p', 'verify', why)]))
    await completeTurn($, w)
    const ui = await pane($)

    const drawn = (await rowTexts(ui))[1]
    expect(drawn?.text).toBe(why)
    expect(drawn?.props.wrap).toBe('wrap')
  })

  test('reads the list inside <suggestions> although the analysis holds brackets, and shows the goal above the cards', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await pane($)

    expect(await goalLine(ui)).toBe('🎯 Ship the settings fix [v2]')
    expect(await labels(ui)).toEqual(['✓ Run the tests', '🔍 Review it', '→ Settings page'])
  })

  test('falls back to a bare JSON array when the reply has no tags, and then shows no goal', async ($, on) => {
    const w = world(on, JSON.stringify([entry('Bare one', 'do it', 'advance')]))
    await completeTurn($, w)
    const ui = await pane($)

    expect(await labels(ui)).toEqual(['→ Bare one'])
    expect(await goalLine(ui)).toBeUndefined()
  })

  test('drops a prompt over 600 characters, a suggestion with no why and one with no known kind', async ($, on) => {
    const w = world(
      on,
      forkReply([
        entry('Too long', 'x'.repeat(601), 'verify'),
        { kind: 'dig', label: 'No why', prompt: 'look into it' },
        entry('Odd kind', 'do something', 'other'),
        entry('Kept', 'ship the settings page', 'advance'),
      ]),
    )
    await completeTurn($, w)

    expect(await paneLabels($)).toEqual(['→ Kept'])
  })

  test('keeps one suggestion per slot, and decide shares the slot of verify', async ($, on) => {
    const w = world(
      on,
      forkReply([
        entry('Pick the option', 'go with option A', 'decide'),
        entry('Check it', 'check it', 'verify'),
        entry('Find the cause', 'find the cause', 'dig'),
        entry('Find another', 'find another', 'dig'),
        entry('Next part', 'do the next part', 'advance'),
      ]),
    )
    await completeTurn($, w)

    expect(await paneLabels($)).toEqual(['⚖ Pick the option', '🔍 Find the cause', '→ Next part'])
  })
})

describe('anchoring', () => {
  test('the open plan steps reach the fork as a preference, never a must', async ($, on) => {
    const w = world(on)
    await $.tool.call({
      tool: TOOL,
      id: 'fix',
      title: 'Fix login',
      stages: [{ name: 'Work', steps: [{ title: 'Reproduce', status: 'done' }, { title: 'Patch', status: 'active' }, { title: 'Verify', status: 'pending' }] }],
    })
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('<open-plan-steps>\n- Fix login: Patch (active); Verify\n</open-plan-steps>')
    expect(w.forkPrompts[0]).toContain('When one of these steps is still the work at hand, prefer a suggestion that moves it forward')
    expect(w.forkPrompts[0]).not.toContain('must move')
  })

  test('without open plans or earlier offers the fork gets no anchors', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).not.toContain('<open-plan-steps>')
    expect(w.forkPrompts[0]).not.toContain('<earlier-suggestions>')
  })

  test('a pick is remembered: the next fork hears what was taken and passed over, and the taken one is not offered again', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await pane($)
    await ui.press({ key: 'next-step-2' })
    await ui.unmount()

    await $.turn.start({ text: '/code-review high', turnId: 'turn-2' })
    await completeTurn($, w, LONG_ANSWER, 'turn-2')

    expect(w.forkPrompts[1]).toContain('- "Review it": taken')
    expect(w.forkPrompts[1]).toContain('- "Run the tests": passed over ×1')
    expect(await paneLabels($)).toEqual(['✓ Run the tests', '→ Settings page'])
  })

  test('a filled draft rewritten before sending does not count as taken', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    const ui = await pane($)
    await ui.press({ key: 'next-step-1' })
    await ui.unmount()

    await $.turn.start({ text: 'something else entirely', turnId: 'turn-2' })
    await completeTurn($, w, LONG_ANSWER, 'turn-2')

    expect(w.forkPrompts[1]).toContain('- "Run the tests": passed over ×1')
  })

  test('a suggestion passed over twice is not offered again', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    await $.turn.start({ text: 'something else', turnId: 'turn-2' })
    await completeTurn($, w, LONG_ANSWER, 'turn-2')
    await $.turn.start({ text: 'another thing', turnId: 'turn-3' })
    await completeTurn($, w, LONG_ANSWER, 'turn-3')

    expect(w.forkPrompts[2]).toContain('- "Settings page": passed over ×2')
    expect(await paneLabels($)).toEqual(['⚖ Fourth one'])
  })

  test('a turn started without text records nothing', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)
    await $.turn.start({ text: '', turnId: 'turn-2' })
    await completeTurn($, w, LONG_ANSWER, 'turn-2')

    expect(w.forkPrompts[1]).not.toContain('<earlier-suggestions>')
  })
})

const RANKING = JSON.stringify([
  { index: 2, score: 5 },
  { index: 0, score: 4, label: 'Tests pass?', why: 'Shorter why' },
  { index: 1, score: 2 },
])

describe('critic', () => {
  test('by default opus scores the candidates and the best of each kind is shown, best first, word for word', async ($, on) => {
    const w = world(on, SUGGESTIONS, undefined, RANKING)
    await completeTurn($, w)

    expect(w.criticCalls).toHaveLength(1)
    expect(w.criticCalls[0]).toMatchObject({ model: 'opus', effort: 'high', maxTokens: 800, timeoutMs: 20000 })
    expect(w.criticCalls[0]?.system).toContain('You grade suggested next prompts')
    expect(w.criticCalls[0]?.system).toContain('Only score: never rewrite a candidate.')
    expect(w.criticCalls[0]?.system).toContain('[{"index": <n>, "score": <1-5>}]')
    expect(w.criticCalls[0]?.system).not.toContain('tighter')
    expect(w.criticCalls[0]?.prompt).toContain('<analysis>\ngoal: Ship the settings fix [v2]')
    expect(w.criticCalls[0]?.prompt).toContain('[0] kind: verify | label: Run the tests | why: Why: Run the tests | prompt: run the tests you just wrote')
    expect(await paneLabels($)).toEqual(['→ Settings page', '✓ Run the tests'])
    const ui = await pane($)
    expect(await whys(ui)).toEqual(['Why: Settings page', 'Why: Run the tests'])
    expect(w.logged).toContain('critic opus kept 2 of 4')
    expect(w.shown.filter(line => line.includes('output tokens') || line.includes(' kept '))).toEqual([])
  })

  test('haiku can grade instead', { options: { critic: 'haiku' } }, async ($, on) => {
    const w = world(on, SUGGESTIONS, undefined, RANKING)
    await completeTurn($, w)

    expect(w.criticCalls[0]?.model).toBe('haiku')
  })

  test('off makes no extra call, and the fork is asked the same either way', { options: { critic: 'off' } }, async ($, on) => {
    const w = world(on, SUGGESTIONS, undefined, RANKING)
    await completeTurn($, w)

    expect(w.criticCalls).toEqual([])
    expect(w.forkPrompts[0]).toContain('Write one to three suggestions, at most one of each kind')
    expect(await paneLabels($)).toEqual(['✓ Run the tests', '🔍 Review it', '→ Settings page'])
  })

  test('a failing critic falls back to the order the fork gave', async ($, on) => {
    const w = world(on, SUGGESTIONS, undefined, new Error('down'))
    await completeTurn($, w)

    expect(await paneLabels($)).toEqual(['✓ Run the tests', '🔍 Review it', '→ Settings page'])
    expect(w.logged.some(line => line.startsWith('critic opus failed'))).toBe(true)
  })

  test('a critic with no reply falls back to the order the fork gave', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(await paneLabels($)).toEqual(['✓ Run the tests', '🔍 Review it', '→ Settings page'])
    expect(w.logged).toContain('critic opus gave no ranking: empty-reply')
  })

  test('a critic that keeps none hides the list', async ($, on) => {
    const w = world(on, SUGGESTIONS, undefined, '[]')
    await completeTurn($, w)

    expect(await chipLabel($)).toBe('Mods')
  })

  test('a single candidate is shown without asking the critic', async ($, on) => {
    const w = world(on, forkReply([entry('Only one', 'p')]), undefined, RANKING)
    await completeTurn($, w)

    expect(w.criticCalls).toEqual([])
    expect(await paneLabels($)).toEqual(['✓ Only one'])
  })
})

const CLAIMED_RESTART =
  'Tôi đã khởi động lại với session-hub local.20. Chạy /progress-demo, mở pane Mod status, chụp mục Progress lúc đóng và lúc mở chi tiết, so với ảnh local.15 tôi gửi, rồi liệt kê chỗ đã ổn và chỗ còn lệch.'
const CLAIMED_PANE =
  'Tôi đã mở phiên Plugin plan-progress thiết kế, pane Mod status ở mục Progress và đã mở chi tiết Demo đã xong. Chụp đi, so với ảnh local.15 tôi gửi, liệt kê chỗ đã ổn và chỗ còn lệch.'
const CLAIMED_INSTALL = "I've installed session-hub local.21 and reloaded the session. Run /progress-demo and compare the Progress section with the local.15 screenshot."
const CHECKED_FIRST =
  'Trước tiên kiểm tra phiên này đang chạy session-hub bản nào; nếu chưa phải local.20 thì dừng và báo tôi. Nếu đúng, chạy /progress-demo và chụp mục Progress lúc đóng và lúc mở chi tiết.'
const CHECKED_EN = 'Check which session-hub version this session has loaded; if it is not local.21, stop and tell me.'

async function reloadOnto($: Engine, on: On, prompt: string) {
  const older = { kind: 'offer', goal: '', items: [{ kind: 'verify', label: 'Chụp lại mục Progress', why: 'Biết Progress đã khớp ảnh chưa', prompt }] }
  const w = world(on, forkReply([]))
  on('state.set', async (_$, e, next) => next(e.plugin === PLUGIN && e.key === 'view' ? { ...e, value: older } : e))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', async () => ({ value: [] }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async () => ({ value: undefined }))
  await completeTurn($, w)
  await $.session.start({ cwd: 'C:/repo', surface: 'desktop', isInteractive: true })
}

describe('steps only the user can take outside the chat', () => {
  test('a prompt that says the user already restarted, opened or installed something is dropped before the critic, the cards and the ghost text', async ($, on) => {
    const w = world(
      on,
      forkReply([
        entry('Chụp lại mục Progress', CLAIMED_RESTART, 'verify'),
        entry('So chi tiết Demo', CLAIMED_PANE, 'dig'),
        entry('Compare after reinstall', CLAIMED_INSTALL, 'advance'),
        entry('Kiểm tra bản đang chạy', CHECKED_FIRST, 'verify', 'Khởi động lại phiên với local.20 trước khi gửi'),
        entry('Check the loaded version', CHECKED_EN, 'dig'),
      ]),
    )
    await completeTurn($, w)

    expect(w.criticCalls).toHaveLength(1)
    expect(w.criticCalls[0]?.prompt).toContain(CHECKED_FIRST)
    expect(w.criticCalls[0]?.prompt).not.toContain('Tôi đã')
    expect(w.criticCalls[0]?.prompt).not.toContain("I've installed")
    const ui = await pane($)
    expect(await labels(ui)).toEqual(['✓ Kiểm tra bản đang chạy', '🔍 Check the loaded version'])
    expect(await whys(ui)).toEqual(['Khởi động lại phiên với local.20 trước khi gửi', 'Why: Check the loaded version'])
    expect(w.suggested).toEqual([CHECKED_FIRST])
    await ui.press({ key: 'next-step-1' })
    await ui.press({ key: 'next-step-2' })
    expect(w.filled.map(fill => fill.text)).toEqual([CHECKED_FIRST, CHECKED_EN])
  })

  test('with the critic off, a lone prompt that claims a restart leaves no list and no ghost text', { options: { critic: 'off' } }, async ($, on) => {
    const w = world(on, forkReply([entry('Chụp lại mục Progress', CLAIMED_RESTART)]))
    await completeTurn($, w)

    expect(await chipLabel($)).toBe('Mods')
    expect(w.suggested).toEqual([])
  })

  test('the fork is told never to claim such a step, and to name it in why and check it first instead', async ($, on) => {
    const w = world(on)
    await completeTurn($, w)

    expect(w.forkPrompts[0]).toContain('it must never claim they already did something only they can do outside this chat')
    expect(w.forkPrompts[0]).toContain('start why with it as the step to take before sending')
    expect(w.forkPrompts[0]).toContain('have the prompt first check it')
  })

  test('the critic is told to score 1 a prompt that claims such a step, and a paraphrase it scores 1 is not shown', async ($, on) => {
    const paraphrase = 'Phiên này đang chạy session-hub local.20 rồi, chạy /progress-demo và chụp mục Progress lúc đóng và lúc mở chi tiết.'
    const ranking = JSON.stringify([
      { index: 0, score: 1 },
      { index: 1, score: 4 },
    ])
    const w = world(on, forkReply([entry('Chụp mục Progress', paraphrase, 'verify'), entry('Check the loaded version', CHECKED_EN, 'dig')]), undefined, ranking)
    await completeTurn($, w)

    expect(w.criticCalls[0]?.system).toContain('scores 1 whatever its other merits')
    expect(w.criticCalls[0]?.prompt).toContain(paraphrase)
    expect(await paneLabels($)).toEqual(['🔍 Check the loaded version'])
    expect(w.logged).toContain('critic opus kept 1 of 2')
  })

  test('after a reload, a list saved by an older build is not brought back when one of its prompts claims such a step', async ($, on) => {
    await reloadOnto($, on, CLAIMED_RESTART)

    expect(await chipLabel($)).toBe('Mods')
  })

  test('after a reload, a saved list whose prompts claim no such step is brought back', async ($, on) => {
    await reloadOnto($, on, CHECKED_FIRST)

    expect(await chipLabel($)).toBe('💡 1')
  })
})
