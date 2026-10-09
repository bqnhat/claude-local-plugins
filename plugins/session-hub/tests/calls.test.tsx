import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import type { Engine } from 'claude-code/testing'


const svgAltIn = (node: unknown): string | undefined => {
  if (node === null || typeof node !== 'object') return undefined
  const one = node as { type?: unknown; props?: { alt?: unknown }; children?: unknown }
  if (one.type === 'Svg') return String(one.props?.alt)
  return Array.isArray(one.children) ? one.children.map(svgAltIn).find(alt => alt !== undefined) : undefined
}

type Found = { key?: string }
type Finder = { find: (q: { type: 'Box'; key: string }) => Promise<unknown>; findAll: (q: { type: 'Box' }) => Promise<Found[]> }
const sectionTitle = async (ui: Finder): Promise<string | undefined> => svgAltIn(await ui.find({ type: 'Box', key: 'hub-title' }))
const railAlts = async (ui: Finder): Promise<(string | undefined)[]> => (await ui.findAll({ type: 'Box' })).filter(box => String(box.key ?? '').startsWith('rail-cell-')).map(svgAltIn)

const PLUGIN = 'session-hub'
const PANE = 'session-hub'
const TOOL = 'mcp__session-hub__plan_progress'
const PANE_PROPS = {
  title: 'Mod status',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

const BREAKDOWN = {
  memoryFiles: [
    { path: 'C:\\Users\\tester\\.claude\\CLAUDE.md', type: 'User', tokens: 10 },
    { path: 'C:\\Users\\tester\\.claude\\rules\\intent-clarification.md', type: 'User', tokens: 10 },
    { path: 'C:\\work\\app\\CLAUDE.md', type: 'Project', tokens: 10 },
  ],
  agents: [{ agentType: 'claim-verifier', source: 'userSettings', tokens: 5 }],
  skills: {
    totalSkills: 4,
    includedSkills: 4,
    tokens: 40,
    skillFrontmatter: [
      { name: 'clarify', source: 'userSettings', tokens: 1 },
      { name: 'eli5', source: 'userSettings', tokens: 1 },
      { name: 'fix-issue', source: 'projectSettings', tokens: 1 },
      { name: 'debug', source: 'plugin', pluginName: 'engineering', tokens: 1 },
    ],
  },
}

type World = { agentResult: unknown; opens: string[]; isPaneUp: boolean; clock: ReturnType<typeof mock.clock>; cwd: string; breakdown: unknown }

function world(on: On, surfaces: RenderSurface[] = ['desktop']): World {
  const w: World = { agentResult: undefined, opens: [], isPaneUp: false, clock: mock.clock(on), cwd: 'C:\\work\\app', breakdown: BREAKDOWN }
  on('session.surfaces', async () => ({ value: surfaces }))
  on('session.messages', async () => ({ value: [] }))
  on('session.cwd', async () => ({ value: w.cwd }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, breakdown: w.breakdown }, rateLimits: [] } as never }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('command.list', async () => ({ value: [] }))
  on('command.run', async () => ({ text: '' }))
  on('ui.open', async (_$, e) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: w.isPaneUp ? [{ id: PANE, title: 'Mod status', isShown: true, isFocused: false, isPlaced: true, plugin: PLUGIN }] : [] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('audio.play', async () => ({ value: undefined }))
  on('agent.list', async () => ({ value: [] }))
  on('tool.call', async (_$, e) => (e.tool === 'Agent' ? { result: w.agentResult as never } : { result: undefined as never }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('prompt.attachment', async (_$, e) => ({ text: e.text }))
  on('classic.InstructionsLoaded', async () => ({}))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('skill.prompt', async (_$, e) => ({ text: e.text }))
  on('agent.offer', async () => ({ isOffered: true }))
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5' }))
  on('model.fork', async () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('ui.render', async () => <></>)
  return w
}

const flat = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(flat).join('') : node !== null && typeof node === 'object' ? flat((node as { children?: unknown }).children ?? []) : ''

const mountPane = ($: Engine, surface: RenderSurface = 'desktop') => $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })

const footer = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: [] } })

async function openCalls($: Engine, surface: RenderSurface = 'desktop') {
  const ui = await mountPane($, surface)
  await ui.press({ key: 'rail-calls' })
  await ui.unmount()
}

async function paneText($: Engine, surface: RenderSurface = 'desktop'): Promise<string> {
  const ui = await mountPane($, surface)
  const title = await sectionTitle(ui)
  const lines = [...(title !== undefined ? [title] : []), ...(await ui.findAll({ type: 'Text' })).map(flat)]
  const labels = (await ui.findAll({ type: 'Button' })).map(one => String(one.props.label))
  await ui.unmount()
  return [...labels, ...lines].join('\n')
}

async function svgAlts($: Engine): Promise<string[]> {
  const ui = await mountPane($)
  const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  await ui.unmount()
  return alts
}

async function startTurn($: Engine, text: string, turnId: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text, turnId })
}

const endTurn = ($: Engine, turnId: string, agentId?: string) =>
  $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId, ...(agentId ? { agentId } : {}) })

async function warmTurn($: Engine) {
  await startTurn($, 'hello', 't0')
  await endTurn($, 't0')
}

const slashRows = (text: string, name: string) => text.split('\n').filter(line => line === `/${name}`).length

const nestedMemory = ($: Engine, path: string, agentId?: string) =>
  $.prompt.attachment({ type: 'nested_memory', text: `Contents of ${path}:\n\nrules`, origin: { kind: 'engine' }, ...(agentId ? { agentId } : {}) } as never)

const fileTurn = async ($: Engine, shown: string): Promise<string | undefined> => {
  const ui = await mountPane($)
  await ui.press({ key: 'calls-files-toggle' })
  const lines = (await ui.findAll({ type: 'Text' })).map(flat)
  await ui.press({ key: 'calls-files-toggle' })
  await ui.unmount()
  const next = lines[lines.indexOf(shown) + 1]
  return next?.startsWith('turn ') ? next : undefined
}

describe('the Skills & agents section of Mod status', () => {
  test('sits on the rail after Next steps and starts with a hint', async ($, on) => {
    world(on)
    const ui = await mountPane($)
    expect((await railAlts(ui))).toEqual(['Progress · selected', 'Next steps', 'Skills & agents', 'Cache'])
    await ui.press({ key: 'rail-calls' })
    await ui.unmount()
    const text = await paneText($)
    expect(text).toContain('Skills & agents')
    expect(text).toContain('No skills or agents called yet.')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`lists a Skill tool call on one line under its turn, its origin as a legend colour, on ${surface}`, async ($, on) => {
      world(on, [surface])
      await warmTurn($)
      await startTurn($, 'fix it', 't1')
      await $.tool.call({ tool: 'Skill', skill: 'clarify' })
      await openCalls($, surface)
      const text = await paneText($, surface)
      expect(text).toContain('This turn')
      expect(text).toContain('clarify')
      expect(text).toContain('Personal')
      expect(text).toContain('1 skill')
      expect(text).not.toContain('Called by Claude')
    })
  }

  test('shows the live turn with nothing called yet instead of an older turn alone', async ($, on) => {
    world(on)
    await warmTurn($)
    await startTurn($, 'first', 't1')
    await $.tool.call({ tool: 'Skill', skill: 'clarify' })
    await endTurn($, 't1')
    await startTurn($, 'second', 't2')
    await openCalls($)
    const text = await paneText($)
    expect(text).toContain('This turn')
    expect(text).toContain('No skills or agents called yet.')
    expect(text).toContain('Turn 2')
  })

  test('tells project skills from plugin skills by the dot each row carries', async ($, on) => {
    world(on)
    await warmTurn($)
    await $.tool.call({ tool: 'Skill', skill: 'fix-issue' })
    await $.tool.call({ tool: 'Skill', skill: 'engineering:debug' })
    await openCalls($)
    const alts = await svgAlts($)
    expect(alts).toContain('Project')
    expect(alts).toContain('Plugin · engineering')
    const text = await paneText($)
    expect(text).toContain('Project')
    expect(text).toContain('Plugin')
  })

  test('leaves a preloaded skill out and lists one typed as a slash command once', async ($, on) => {
    world(on)
    await warmTurn($)
    await $.skill.prompt({ skill: 'clarify', text: 'preloaded' })
    await openCalls($)
    expect(await paneText($)).toContain('No skills or agents called yet.')

    await startTurn($, '/fix-issue 42', 't1')
    await $.skill.prompt({ skill: 'fix-issue', text: 'expanded' })
    const text = await paneText($)
    expect(slashRows(text, 'fix-issue')).toBe(1)
    expect(text).toContain('Project')
    expect(text).not.toContain('clarify')
  })

  test('catches a typed skill whose prompt expands before the prompt is submitted', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.command.run({ command: 'eli5', args: 'DNS' })
    await $.skill.prompt({ skill: 'eli5', text: 'expanded' })
    await startTurn($, '/eli5 DNS', 't1')
    let text = await paneText($)
    expect(slashRows(text, 'eli5')).toBe(1)
    expect(text).toContain('This turn')
    await endTurn($, 't1')

    await $.skill.prompt({ skill: 'fix-issue', text: 'expanded' })
    await startTurn($, '<command-name>/fix-issue</command-name>', 't2')
    text = await paneText($)
    expect(slashRows(text, 'fix-issue')).toBe(1)
    expect(slashRows(text, 'eli5')).toBe(1)
  })

  test('shows a background agent running, counts it in the footer, then done when its loop completes', async ($, on) => {
    const w = world(on)
    await warmTurn($)
    await $.agent.offer({ agent: 'Explore', description: 'search', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } })
    await startTurn($, 'look', 't1')
    w.agentResult = { status: 'async_launched', agentId: 'bg-1', description: 'Find the component', prompt: 'p', outputFile: 'out' }
    await $.tool.call({ tool: 'Agent', description: 'Find the component', prompt: 'p', subagent_type: 'Explore' })
    await openCalls($)
    let text = await paneText($)
    expect(text).toContain('1 running')
    expect(text).toContain('Explore')
    expect(text).toContain('Built-in')
    expect(text).toContain('Find the component')
    expect(await svgAlts($)).toContain('agent running')
    expect(await svgAlts($)).toContain('Skills & agents · selected')
    const away = await mountPane($)
    await away.press({ key: 'rail-progress' })
    await away.unmount()
    expect(await svgAlts($)).toContain('Skills & agents · 1 running')
    await openCalls($)

    const chip = await footer($)
    expect(String((await chip.find({ type: 'Button', key: 'hub-toggle' }))?.props.label)).toContain('Agents 1')
    await chip.unmount()

    await endTurn($, 'bg-turn', 'bg-1')
    text = await paneText($)
    expect(text).not.toContain('running')
    expect(text.split('\n')).toContain('1 agent')
    expect(text).not.toContain('0 skills')
    const after = await footer($)
    expect(String((await after.find({ type: 'Button', key: 'hub-toggle' }))?.props.label)).not.toContain('Agents')
    await after.unmount()
  })

  test('tags a personal agent and nests a skill its loop called under it', async ($, on) => {
    const w = world(on)
    await warmTurn($)
    w.agentResult = { status: 'completed', agentId: 'fg-1', resolvedModel: 'claude-opus-5-5', content: [], totalToolUseCount: 0, totalDurationMs: 1, totalTokens: 0, prompt: 'p' }
    await $.tool.call({ tool: 'Agent', description: 'Check the claim', prompt: 'p', subagent_type: 'claim-verifier' })
    await $.tool.call({ tool: 'Skill', skill: 'clarify', agentId: 'fg-1' } as never)
    await openCalls($)
    const text = await paneText($)
    expect(text).toContain('claim-verifier')
    expect(text).toContain('Check the claim')
    expect(await svgAlts($)).toContain('Personal')

    const ui = await mountPane($)
    const rows = (await ui.findAll({ type: 'Box' })).filter(box => /^call-(?!mark-|dot-|end-)/.test(box.key ?? ''))
    await ui.unmount()
    expect(rows.map(box => box.props.marginLeft)).toEqual([0, 3])
  })

  test('counts the calls nested under an agent in the header of the turn they show under', async ($, on) => {
    const w = world(on)
    await warmTurn($)
    await startTurn($, 'verify', 't1')
    w.agentResult = { status: 'completed', agentId: 'fg-1', resolvedModel: 'claude-opus-5-5', content: [], totalToolUseCount: 0, totalDurationMs: 1, totalTokens: 0, prompt: 'p' }
    await $.tool.call({ tool: 'Agent', description: 'Check the claim', prompt: 'p', subagent_type: 'claim-verifier' })
    await $.tool.call({ tool: 'Skill', skill: 'clarify', agentId: 'fg-1' } as never)
    await $.tool.call({ tool: 'Skill', skill: 'eli5', agentId: 'fg-1' } as never)
    await openCalls($)
    const lines = (await paneText($)).split('\n')
    expect(lines.filter(line => line === '2 skills · 1 agent').length).toBeGreaterThan(0)
    expect(lines).not.toContain('1 agent')
  })

  test('keeps a namespaced plugin skill on its plugin when a personal skill shares its short name', async ($, on) => {
    const w = world(on)
    w.breakdown = {
      ...BREAKDOWN,
      skills: {
        ...BREAKDOWN.skills,
        skillFrontmatter: [
          { name: 'debug', source: 'userSettings', tokens: 1 },
          { name: 'debug', source: 'plugin', pluginName: 'engineering', tokens: 1 },
        ],
      },
    }
    await warmTurn($)
    await startTurn($, 'go', 't1')
    await $.tool.call({ tool: 'Skill', skill: 'debug' })
    await openCalls($)
    expect(await svgAlts($)).toContain('Personal')
    expect(await svgAlts($)).not.toContain('Plugin · engineering')

    await $.tool.call({ tool: 'Skill', skill: 'engineering:debug' })
    await $.tool.call({ tool: 'Skill', skill: 'tools:debug' })
    const alts = await svgAlts($)
    expect(alts).toContain('Plugin · engineering')
    expect(alts).toContain('Plugin · tools')
    expect(alts.filter(alt => alt === 'Personal')).toHaveLength(2)
  })

  test('counts the loaded rule and CLAUDE.md files by origin and lists them, rules first', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    let text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 3')
    expect(await svgAlts($)).toContain('Personal 2 · Project 1')
    expect(text).not.toContain('intent-clarification.md')

    const ui = await mountPane($)
    await ui.press({ key: 'calls-files-toggle' })
    await ui.unmount()
    text = await paneText($)
    const rule = text.indexOf('~/.claude/rules/intent-clarification.md')
    const personal = text.indexOf('~/.claude/CLAUDE.md')
    const project = text.indexOf('./CLAUDE.md')
    expect(rule).toBeGreaterThan(-1)
    expect(personal).toBeGreaterThan(rule)
    expect(project).toBeGreaterThan(personal)
  })

  test('the chevron of Rules & CLAUDE.md opens and folds the file list on its own press', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    const chevron = async () => {
      const ui = await mountPane($)
      const alt = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt)).find(one => one === 'Open' || one === 'Fold')
      await ui.unmount()
      return alt
    }
    const pressChevron = async () => {
      const ui = await mountPane($)
      await ui.press({ key: 'calls-files-chevron' })
      await ui.unmount()
    }
    expect(await chevron()).toBe('Open')

    await pressChevron()
    expect(await chevron()).toBe('Fold')
    expect(await paneText($)).toContain('~/.claude/rules/intent-clarification.md')

    await pressChevron()
    expect(await chevron()).toBe('Open')
    expect(await paneText($)).not.toContain('intent-clarification.md')
  })

  test('the press area of Rules & CLAUDE.md spans the whole row, chevron included, and is clipped to it', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    const ui = await mountPane($)
    const hit = await ui.find({ type: 'Box', key: 'calls-files-hit' })
    const label = (await ui.find({ type: 'Button', key: 'calls-files-toggle' }))?.props.label
    await ui.unmount()
    expect(hit?.props).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'stretch', overflow: 'hidden' })
    expect(String(label)).toBe(' '.repeat(122))
  })

  test('adds rule files loaded in the middle of a turn and marks them as this turn', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'edit the form', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\rules\\typescript.md', memory_type: 'User', load_reason: 'path_glob_match', trigger_file_path: 'C:\\work\\app\\src\\form.ts' } as never)
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\src\\CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', trigger_file_path: 'C:\\work\\app\\src\\form.ts' } as never)
    await nestedMemory($, 'C:\\Users\\tester\\.claude\\rules\\typescript.md')
    await nestedMemory($, 'C:\\work\\app\\src\\CLAUDE.md')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\rules\\typescript.md', memory_type: 'User', load_reason: 'path_glob_match', trigger_file_path: 'C:\\work\\app\\src\\other.ts' } as never)
    let text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 5')
    expect(text).toContain('+2 this turn')
    expect(await svgAlts($)).toContain('Personal 3 · Project 2')

    await endTurn($, 't1')
    text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 5')
    expect(text).toContain('+2 last turn')
  })

  test('folds the long project folder of a memory file so its file name stays readable', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\projects\\C--Users-tester-work-app\\memory\\MEMORY.md', memory_type: 'User', load_reason: 'session_start' } as never)
    const opener = await mountPane($)
    await opener.press({ key: 'calls-files-toggle' })
    await opener.unmount()
    const text = await paneText($)
    expect(text).toContain('~/.claude/projects/…/memory/MEMORY.md')
    expect(text).not.toContain('C--Users-tester-work-app')
    expect(await svgAlts($)).toContain('Personal 2 · Project 1 · Memory 1')
  })

  test('keeps the turn label of a rule file on one line beside a long path', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'edit the form', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\rules\\code-structure-and-naming-conventions.md', memory_type: 'User', load_reason: 'path_glob_match', trigger_file_path: 'C:\\work\\app\\src\\form.ts' } as never)
    await nestedMemory($, 'C:\\Users\\tester\\.claude\\rules\\code-structure-and-naming-conventions.md')
    const opener = await mountPane($)
    await opener.press({ key: 'calls-files-toggle' })
    await opener.unmount()
    const ui = await mountPane($)
    const boxes = (await ui.findAll({ type: 'Box' })).filter(box => String(box.key ?? '').startsWith('calls-file-turn-box-'))
    await ui.unmount()
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) expect(box.props.flexShrink).toBe(0)
  })

  test('counts a file a resumed transcript still carries as earlier context, not as this turn', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\CLAUDE.md', memory_type: 'User', load_reason: 'session_start' } as never)
    await startTurn($, 'go on', 't1')
    await $.prompt.attachment({
      type: 'nested_memory',
      text: 'Contents of C:\\work\\app\\api\\CLAUDE.local.md:\n\nOld notes.',
      origin: { kind: 'engine' },
    })
    const text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 4')
    expect(text).not.toContain('+1')
    expect(await svgAlts($)).toContain('Personal 2 · Project 1 · Local 1')
  })

  test('keeps the scope InstructionsLoaded gives over the guess an attachment made first', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'edit', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\CLAUDE.md', memory_type: 'User', load_reason: 'session_start' } as never)
    await $.prompt.attachment({
      type: 'nested_memory',
      text: 'Contents of C:\\work\\app\\lib\\RULES.md:\n\nx',
      origin: { kind: 'engine' },
    })
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\lib\\RULES.md', memory_type: 'Managed', load_reason: 'include', trigger_file_path: 'C:\\work\\app\\lib\\a.ts' } as never)
    expect(await svgAlts($)).toContain('Personal 2 · Project 1 · Managed 1')
  })

  test('forgets the loaded files on /clear and rebuilds them as the new start', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'edit', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\rules\\typescript.md', memory_type: 'User', load_reason: 'path_glob_match', trigger_file_path: 'C:\\work\\app\\a.ts' } as never)
    await nestedMemory($, 'C:\\Users\\tester\\.claude\\rules\\typescript.md')
    await endTurn($, 't1')
    expect(await paneText($)).toContain('Rules & CLAUDE.md · 4')

    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } } as never)
    expect(await paneText($)).not.toContain('Rules & CLAUDE.md')
    await startTurn($, 'fresh start', 't2')
    await endTurn($, 't2')
    const text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 3')
    expect(text).not.toContain('last turn')
  })

  test('does not count a skill named inside an ordinary prompt', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'why does <command-name>/eli5</command-name> show twice?', 't1')
    await startTurn($, '/eli5', 't2')
    const text = await paneText($)
    expect(slashRows(text, 'eli5')).toBe(0)
    expect(text).toContain('No skills or agents called yet.')
  })

  test('forgets the loaded files when /resume switches to another conversation', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'edit', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\billing\\CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', trigger_file_path: 'C:\\work\\app\\billing\\a.ts' } as never)
    await nestedMemory($, 'C:\\work\\app\\billing\\CLAUDE.md')
    await endTurn($, 't1')
    expect(await paneText($)).toContain('Rules & CLAUDE.md · 4')

    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-2' } } as never)
    expect(await paneText($)).not.toContain('Rules & CLAUDE.md')
  })

  test('counts an import the startup loader reads after a turn began as earlier context', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } } as never)
    await startTurn($, 'hello', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\CLAUDE.md', memory_type: 'Project', load_reason: 'session_start' } as never)
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\docs\\conventions.md', memory_type: 'Project', load_reason: 'include', parent_file_path: 'C:\\work\\app\\CLAUDE.md' } as never)
    const text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 2')
    expect(text).not.toContain('this turn')
  })

  test('leaves out a file only a subagent loaded, even when its load names no agent', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'look', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\billing\\CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', trigger_file_path: 'C:\\work\\app\\billing\\a.ts' } as never)
    await nestedMemory($, 'C:\\work\\app\\billing\\CLAUDE.md', 'sub-1')
    await endTurn($, 't1')
    const text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 3')
    expect(text).not.toContain('+1')
  })

  test('leaves out a file loaded for a prompt that never started a turn', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.prompt.submit({ text: 'explain @src/api/handler.ts', wait: false, origin: { kind: 'composer' } })
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\src\\api\\CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', trigger_file_path: 'C:\\work\\app\\src\\api\\handler.ts' } as never)
    await startTurn($, 'hello', 't1')
    const text = await paneText($)
    expect(text).toContain('Rules & CLAUDE.md · 3')
    expect(text).not.toContain('this turn')
  })

  test('moves a file to this turn when its load event comes after its attachment', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'edit', 't1')
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\CLAUDE.md', memory_type: 'User', load_reason: 'session_start' } as never)
    await nestedMemory($, 'C:\\work\\app\\billing\\CLAUDE.md')
    expect(await paneText($)).not.toContain('this turn')
    expect(await fileTurn($, './billing/CLAUDE.md')).toBeUndefined()
    await $.classic.InstructionsLoaded({ file_path: 'C:\\work\\app\\billing\\CLAUDE.md', memory_type: 'Project', load_reason: 'nested_traversal', trigger_file_path: 'C:\\work\\app\\billing\\a.ts' } as never)
    expect(await paneText($)).toContain('+1 this turn')
    expect(await fileTurn($, './billing/CLAUDE.md')).toBe('turn 2')
  })

  test('guesses Project for a replayed file under a working directory inside ~/.claude', async ($, on) => {
    const w = world(on)
    w.cwd = 'C:\\Users\\tester\\.claude'
    await warmTurn($)
    await openCalls($)
    await $.classic.InstructionsLoaded({ file_path: 'C:\\Users\\tester\\.claude\\CLAUDE.md', memory_type: 'User', load_reason: 'session_start' } as never)
    await startTurn($, 'go on', 't1')
    await nestedMemory($, 'C:\\Users\\tester\\.claude\\plugins\\hub\\CLAUDE.md')
    await nestedMemory($, 'C:\\Users\\tester\\.claude\\rules\\typescript.md')
    expect(await svgAlts($)).toContain('Personal 3 · Project 2')
  })

  test('lists a skill typed again after its first prompt was dropped', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.command.run({ command: 'eli5', args: 'DNS' })
    await $.skill.prompt({ skill: 'eli5', text: 'expanded' })
    await $.prompt.submit({ text: '/eli5 DNS', wait: false, origin: { kind: 'composer' } })
    await $.command.run({ command: 'eli5', args: 'DNS' })
    await $.skill.prompt({ skill: 'eli5', text: 'expanded' })
    await startTurn($, '/eli5 DNS', 't1')
    expect(slashRows(await paneText($), 'eli5')).toBe(1)
  })

  test('keeps a skill row of a dropped prompt off the next turn', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.prompt.submit({ text: '/eli5 DNS', wait: false, origin: { kind: 'composer' } })
    await $.skill.prompt({ skill: 'eli5', text: 'expanded' })
    await startTurn($, 'hello', 't1')
    const text = await paneText($)
    expect(slashRows(text, 'eli5')).toBe(0)
    expect(text).toContain('No skills or agents called yet.')
  })

  test('drops a typed skill whose prompt never started a turn', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await $.command.run({ command: 'eli5', args: 'DNS' })
    await $.skill.prompt({ skill: 'eli5', text: 'expanded' })
    await $.prompt.submit({ text: '/eli5 DNS', wait: false, origin: { kind: 'composer' } })
    await startTurn($, 'hello', 't1')
    const text = await paneText($)
    expect(slashRows(text, 'eli5')).toBe(0)
    expect(text).toContain('No skills or agents called yet.')
  })

  test('gives a finished skill its clock time on the right', async ($, on) => {
    const w = world(on)
    await w.clock.advance(9 * 3_600_000)
    await warmTurn($)
    await startTurn($, 'fix it', 't1')
    await $.tool.call({ tool: 'Skill', skill: 'clarify' })
    await openCalls($)
    const ui = await mountPane($)
    const ends = (await ui.findAll({ type: 'Box' })).filter(box => (box.key ?? '').startsWith('call-end-')).map(flat)
    await ui.unmount()
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatch(/^\d{1,2}:\d{2}/)
  })

  test('keeps a turn with a running background agent in view when older turns fold', async ($, on) => {
    const w = world(on)
    await warmTurn($)
    await startTurn($, 'look', 't1')
    w.agentResult = { status: 'async_launched', agentId: 'bg-1', description: 'Long search', prompt: 'p', outputFile: 'out' }
    await $.tool.call({ tool: 'Agent', description: 'Long search', prompt: 'p', subagent_type: 'Explore' })
    await endTurn($, 't1')
    for (const [i, skill] of ['clarify', 'fix-issue', 'engineering:debug'].entries()) {
      await startTurn($, `step ${i}`, `t${i + 2}`)
      await $.tool.call({ tool: 'Skill', skill })
      await endTurn($, `t${i + 2}`)
    }
    await openCalls($)
    const text = await paneText($)
    expect(text).toContain('Long search')
    expect(text).toContain('Turn 2')
    expect(text).not.toContain('older turn')
  })

  test('switches to Progress when a new bar opens while Skills & agents is on screen', async ($, on) => {
    const w = world(on)
    w.isPaneUp = true
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'build it', 't1')
    await $.tool.call({ tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }] }] })
    const ui = await mountPane($)
    const header = [String(await sectionTitle(ui))]
    await ui.unmount()
    expect(header[0]).toBe('Progress')
  })

  test('stays on Skills & agents when a bar that already exists moves on', async ($, on) => {
    const w = world(on)
    w.isPaneUp = true
    await warmTurn($)
    await startTurn($, 'build it', 't1')
    await $.tool.call({ tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }, { title: 'Two', status: 'pending' }] }] })
    await openCalls($)
    await $.tool.call({ tool: TOOL, id: 'task', next: true })
    const ui = await mountPane($)
    const header = [String(await sectionTitle(ui))]
    await ui.unmount()
    expect(header[0]).toBe('Skills & agents')
  })

  test('opens on Progress for a new bar when Skills & agents is not on screen', async ($, on) => {
    world(on)
    await warmTurn($)
    await openCalls($)
    await startTurn($, 'build it', 't1')
    await $.tool.call({ tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }] }] })
    const ui = await mountPane($)
    const header = [String(await sectionTitle(ui))]
    await ui.unmount()
    expect(header[0]).toBe('Progress')
  })

  test('opens Mods on Skills & agents while Progress has no bar to show', async ($, on) => {
    world(on)
    await warmTurn($)
    const chip = await footer($)
    await chip.press({ key: 'hub-toggle' })
    await chip.unmount()
    const text = await paneText($)
    expect(text.split('\n')).toContain('Skills & agents')
    expect(text).not.toContain('No progress bars')
  })

  test('still shows Progress, aligned and explained, when its icon is pressed with no bar', async ($, on) => {
    world(on)
    await warmTurn($)
    const chip = await footer($)
    await chip.press({ key: 'hub-toggle' })
    await chip.unmount()
    const ui = await mountPane($)
    await ui.press({ key: 'rail-progress' })
    const header = [String(await sectionTitle(ui))]
    const empty = (await ui.findAll({ type: 'Box' })).filter(box => flat(box) === 'No progress bars yet. One appears when Claude starts a task with several steps.').pop()
    await ui.unmount()
    expect(header[0]).toBe('Progress')
    expect(empty?.props.paddingX).toBe(1)
  })

  test('opens Mods on Progress once a bar exists', async ($, on) => {
    world(on)
    await warmTurn($)
    await startTurn($, 'build it', 't1')
    await $.tool.call({ tool: TOOL, id: 'task', title: 'Task', stages: [{ name: 'Work', steps: [{ title: 'One', status: 'active' }] }] })
    const chip = await footer($)
    await chip.press({ key: 'hub-toggle' })
    await chip.unmount()
    const ui = await mountPane($)
    const header = [String(await sectionTitle(ui))]
    await ui.unmount()
    expect(header[0]).toBe('Progress')
  })
})
