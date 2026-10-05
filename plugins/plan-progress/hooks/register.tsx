import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { AgentRun, Plan, PlanStage, PlanState, PlanStep, PlanSubstep, StepStatus } from '../types'

const TOOL = 'mcp__plan-progress__plan_progress'
const plans = atom({ plugin: 'plan-progress', key: 'plans' } as const, [])
const MAX_BARS = 3
const MAX_KEPT = 30
const RECENT_DONE = 3
// a space as wide as a digit, so '  0%' and '100%' take the same room
const FIGURE_SPACE = String.fromCharCode(0x2007)
const isOpen = atom({ plugin: 'plan-progress', key: 'isOpen' } as const, true)
const tick = atom({ plugin: 'plan-progress', key: 'tick' } as const, 0)
const isRestoreChecked = atom({ plugin: 'plan-progress', key: 'isRestoreChecked' } as const, false)
const isExpanded = atom({ plugin: 'plan-progress', key: 'isExpanded' } as const, false)
const backgroundTaskIds = atom({ plugin: 'plan-progress', key: 'backgroundTaskIds' } as const, [])
const expandedIds = atom({ plugin: 'plan-progress', key: 'expandedIds' } as const, [])
const isHistoryOpen = atom({ plugin: 'plan-progress', key: 'isHistoryOpen' } as const, false)
const paneState = atom({ plugin: 'plan-progress', key: 'paneState' } as const, 'down')
const PANE = 'plan-progress'
const PANE_TITLE = 'Progress'
const RING = 22
const FOLD_MS = 5000
const LIVE_TICK_MS = 10_000
const SEG_H = 4
const SEG_GAP = 2
const STAGE_GAP = 5
const DETAIL_INDENT = 5
const HOVER_BG = '#8080801f'
const ROW_FILL_CHAR = ' '
const ROW_FILL_PER_COLUMN = 2.75

const STATE_COLOR: Record<PlanState, string> = { running: '#8B7CF6', needs_input: '#E09A1E', error: '#E5484D', done: '#30A46C' }
const STATE_GLYPH: Record<PlanState, string> = { running: '●', needs_input: '?', error: '!', done: '✓' }
const STATUSES: StepStatus[] = ['pending', 'active', 'done', 'error', 'skipped']

const RULES = `# Progress bars
Tasks needing more than ~3 edits or commands get a bar via ${TOOL}: create it once with the full breakdown (2-7 stages with short steps, or kind "todo" for one flat list; titles of at most 4 words, in the user's language), then update it with short calls only: {id, next:true} when the active step is finished, or {id, done:[...], active:"..."}, {id, failed:"...", note}. Send state "needs_input" with a note before asking the user to decide. Never describe the bars to the user.`

type Raw = Record<string, unknown>
const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const status = (v: unknown): StepStatus => (STATUSES.includes(v as StepStatus) ? (v as StepStatus) : 'pending')
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []) as Raw[]
const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// short updates: {next:true}, {done:[titles]}, {active:title}, {failed:title} against the stored plan
function applyOps(stages: PlanStage[], input: Raw): PlanStage[] {
  const next = stages.map(s => ({ ...s, steps: s.steps.map(st => ({ ...st })) }))
  const steps = next.flatMap(s => s.steps)
  const find = (title: string) => steps.find(st => same(st.title, title))
  if (input.next === true) {
    const at = steps.findIndex(st => st.status === 'active') >= 0 ? steps.findIndex(st => st.status === 'active') : steps.findIndex(st => !isFinished(st.status))
    const cur = steps[at]
    if (cur) cur.status = 'done'
    const following = steps.slice(at + 1).find(st => st.status === 'pending')
    if (following) following.status = 'active'
  }
  for (const t of Array.isArray(input.done) ? input.done : []) {
    const st = typeof t === 'string' ? find(t) : undefined
    if (st) st.status = 'done'
  }
  const active = typeof input.active === 'string' ? find(input.active) : undefined
  if (active) {
    const at = steps.indexOf(active)
    steps.forEach((st, i) => {
      if (st.status === 'active' && i !== at) st.status = i < at ? 'done' : 'pending'
    })
    active.status = 'active'
  }
  const failed = typeof input.failed === 'string' ? find(input.failed) : undefined
  if (failed) failed.status = 'error'

  return next
}

type Timed = { title: string; status: StepStatus; startedAt?: number; endedAt?: number }

function timed<T extends Timed>(item: T, startedAt: number | undefined, endedAt: number | undefined): T {
  const bare: T = { ...item }
  delete bare.startedAt
  delete bare.endedAt

  return { ...bare, ...(startedAt === undefined ? {} : { startedAt }), ...(endedAt === undefined ? {} : { endedAt }) }
}

function stamp<T extends Timed>(item: T, was: Timed | undefined, now: number): T {
  if (item.status === 'pending') return timed(item, undefined, undefined)
  const startedAt = was?.startedAt ?? item.startedAt ?? (item.status === 'active' ? now : undefined)
  if (item.status === 'active') return timed(item, startedAt, undefined)
  const keptEnd = was !== undefined && was.status === item.status ? (was.endedAt ?? item.endedAt) : undefined

  return timed(item, startedAt, keptEnd ?? now)
}

function matcher<T extends Timed>(pool: readonly T[]): (title: string) => T | undefined {
  const used = new Set<T>()

  return title => {
    const found = pool.find(one => !used.has(one) && same(one.title, title))
    if (found) used.add(found)
    return found
  }
}

function stampStages(stages: PlanStage[], prev: readonly PlanStage[], now: number): PlanStage[] {
  const matchStep = matcher(prev.flatMap(s => s.steps))

  return stages.map(s => ({
    ...s,
    steps: s.steps.map(step => {
      const was = matchStep(step.title)
      const matchSub = matcher<PlanSubstep>(was?.substeps ?? [])

      return { ...stamp(step, was, now), substeps: step.substeps.map(sub => stamp(sub, matchSub(sub.title), now)) }
    }),
  }))
}

function normalize(input: Raw, prev: Plan | null, now: number, id: string): Plan {
  const isPartial = list(input.stages).length === 0 && prev !== null
  const given: PlanStage[] = isPartial ? applyOps(prev.stages, input) : list(input.stages)
    .map(s => ({
      name: str(s.name, 80) || 'Stage',
      steps: list(s.steps).map(st => ({
        title: str(st.title) || 'Step',
        status: status(st.status),
        substeps: list(st.substeps).map(sub => ({ title: str(sub.title) || '…', status: status(sub.status) })),
      })),
    }))
    .filter(s => s.steps.length > 0) as PlanStage[]
  const stages = stampStages(given, prev?.stages ?? [], now)
  const title = str(input.title, 80) || prev?.title || 'Plan'
  const steps = stages.flatMap(s => s.steps)
  const isAllDone = steps.length > 0 && steps.every(s => isFinished(s.status))
  const asked = input.state as PlanState
  const failedNow = typeof input.failed === 'string'
  const state: PlanState = ['running', 'needs_input', 'error', 'done'].includes(asked) ? asked : isAllDone ? 'done' : failedNow ? 'error' : 'running'

  return {
    id,
    title,
    kind: input.kind === 'todo' || (isPartial && prev?.kind === 'todo') ? 'todo' : 'plan',
    stages,
    state,
    note: str(input.note, 160) || null,
    startedAt: prev && prev.title === title ? prev.startedAt : now,
    updatedAt: now,
    ...(prev?.hidden ? { hidden: true } : {}),
    ...(prev?.agents ? { agents: prev.agents, agentsDoneAt: prev.agentsDoneAt ?? null } : {}),
  }
}

const touchedAt = (p: Plan) => p.updatedAt ?? p.startedAt
const lastTouched = (list: readonly Plan[]) => [...list].sort((a, b) => touchedAt(a) - touchedAt(b)).pop()
const isDrawn = (p: Plan) => !p.hidden && !p.isFolded

function focusBar(list: readonly Plan[]): Plan | undefined {
  const open = list.filter(p => p.state !== 'done')
  return lastTouched(open.length > 0 ? open : list)
}

const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(\d+[.)]|[-*+]|\[[ xX]\])\s+/, '')
    .replace(/^(\d+[.)]|\[[ xX]\])\s+/, '')
    .trim()

function parsePlan(markdown: string, now: number): Plan | null {
  let title = ''
  const headed: PlanStage[] = []
  const items: { depth: number; text: string }[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const text = clean(h[2] ?? '')
      if (h[1] === '#' && !title) title = text
      else headed.push({ name: text, steps: [] })
      continue
    }
    const li = line.match(/^(\s*)(\d+[.)]|[-*+])\s+(.*)$/)
    if (!li) continue
    const depth = Math.floor((li[1] ?? '').replace(/\t/g, '  ').length / 2)
    const text = clean(li[3] ?? '').slice(0, 120)
    if (!text) continue
    items.push({ depth, text })
    const stage = headed[headed.length - 1]
    if (!stage) continue
    const step = stage.steps[stage.steps.length - 1]
    if (depth === 0 || !step) stage.steps.push({ title: text, status: 'pending', substeps: [] })
    else step.substeps.push({ title: text, status: 'pending' })
  }
  let stages = headed.filter(s => s.steps.length > 0)
  if (stages.length === 0) {
    if (items.some(i => i.depth > 0)) {
      for (const item of items) {
        const stage = stages[stages.length - 1]
        if (item.depth === 0 || !stage) stages.push({ name: item.text, steps: [] })
        else stage.steps.push({ title: item.text, status: 'pending', substeps: [] })
      }
      stages = stages.map(s => (s.steps.length ? s : { ...s, steps: [{ title: s.name, status: 'pending', substeps: [] }] }))
    } else if (items.length > 0) {
      stages = [{ name: 'Tasks', steps: items.map(i => ({ title: i.text, status: 'pending' as StepStatus, substeps: [] })) }]
    }
  }
  if (stages.length === 0) return null
  const first = stages[0]?.steps[0]
  if (first) first.status = 'active'

  return { id: 'plan', title: title || 'Plan', kind: stages.length === 1 ? 'todo' : 'plan', stages, state: 'running', note: null, startedAt: now }
}

function st(title: string, s: StepStatus): PlanStep {
  return { title, status: s, substeps: [] }
}

const DEMO = (now: number): Plan => ({
  id: 'demo',
  title: 'Orders module',
  kind: 'plan',
  state: 'running',
  note: null,
  startedAt: now - 260_000,
  updatedAt: now,
  stages: [
    { name: 'Analysis', steps: [st('Read modules', 'done'), st('Find dependencies', 'done'), st('List changes', 'done')] },
    { name: 'DB migration', steps: [st('Table schema', 'done'), st('Create migration', 'done'), st('Move data', 'active'), st('Indexes', 'pending')] },
    { name: 'API', steps: [st('Endpoints', 'pending'), st('Validation', 'pending'), st('Access rules', 'pending')] },
    { name: 'Interface', steps: [st('List page', 'pending'), st('Order card', 'pending'), st('Filters', 'pending'), st('Empty states', 'pending')] },
    { name: 'Verify', steps: [st('Tests', 'pending'), st('Build', 'pending')] },
  ],
})

/// ---------- drawing ----------

type Where = { pos: number; total: number; stage: number; step: number; stageSize: number }

function where(p: Plan): Where {
  const steps = p.stages.flatMap((s, i) => s.steps.map((step, j) => ({ i, j, step })))
  const at = steps.findIndex(x => !isFinished(x.step.status))
  const pos = p.state === 'done' || at < 0 ? steps.length : at
  const cur = steps[Math.min(pos, steps.length - 1)]
  const stage = cur?.i ?? 0

  return { pos, total: steps.length, stage, step: pos >= steps.length ? (p.stages[stage]?.steps.length ?? 0) : (cur?.j ?? 0) + 1, stageSize: p.stages[stage]?.steps.length ?? 0 }
}

const ICON_PATH: Partial<Record<PlanState, string>> = {
  needs_input: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  error: 'M18 6 6 18M6 6l12 12',
  done: 'M20 6 9 17l-5-5',
}

const AGENT_COLOR: Record<AgentRun['state'], string> = {
  running: STATE_COLOR.running,
  waiting: STATE_COLOR.needs_input,
  done: STATE_COLOR.done,
  error: STATE_COLOR.error,
}
const AGENT_GLYPH: Record<AgentRun['state'], string> = { running: '●', waiting: '?', done: '✓', error: '!' }

const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000))
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

const span = (ms: number) => {
  const sec = Math.round(ms / 1000)
  if (sec < 1) return ''
  return sec < 3600 ? elapsed(ms) : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

const shortSpan = (ms: number) => {
  const sec = Math.round(ms / 1000)
  if (sec < 1) return ''
  if (sec < 60) return `${sec}s`
  return sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

const two = (n: number) => String(n).padStart(2, '0')
const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

const percent = (p: Plan, w: Where) => (p.state === 'done' ? 100 : Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100))

const endOf = (p: Plan, now: number) => (p.state === 'done' ? touchedAt(p) : now)

function ringSvg(p: Plan, pct: number): string {
  const r = (RING - 6) / 2
  const c = 2 * Math.PI * r
  const color = STATE_COLOR[p.state]
  const icon = ICON_PATH[p.state]
  const at = RING / 2 - 5
  const mark = icon ? `<path d="${icon}" transform="translate(${at} ${at}) scale(.42)" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RING}" height="${RING}" viewBox="0 0 ${RING} ${RING}"><circle cx="${RING / 2}" cy="${RING / 2}" r="${r}" fill="none" stroke="#8A8984" stroke-opacity=".3" stroke-width="3"/><circle cx="${RING / 2}" cy="${RING / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${((pct / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${RING / 2} ${RING / 2})"/>${mark}</svg>`
}

const stepColor = (status: StepStatus, live: string) =>
  status === 'done' ? STATE_COLOR.done : status === 'error' ? STATE_COLOR.error : status === 'active' ? live : '#8A8984'

function stepsSvg(p: Plan, W: number): string {
  const steps = p.stages.flatMap((s, i) => s.steps.map((step, j) => ({ step, isStageEnd: j === s.steps.length - 1 && i < p.stages.length - 1 })))
  const stageGaps = steps.filter(one => one.isStageEnd).length
  const seg = Math.max(1, (W - (steps.length - 1) * SEG_GAP - stageGaps * STAGE_GAP) / Math.max(1, steps.length))
  let x = 0
  let rects = ''
  for (const { step, isStageEnd } of steps) {
    const opacity = step.status === 'pending' ? 0.3 : step.status === 'skipped' ? 0.55 : 1
    rects += `<rect x="${x.toFixed(1)}" y="0" width="${seg.toFixed(1)}" height="${SEG_H}" rx="1.5" fill="${stepColor(step.status, STATE_COLOR[p.state])}" fill-opacity="${opacity}"/>`
    x += seg + SEG_GAP + (isStageEnd ? STAGE_GAP : 0)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SEG_H}" viewBox="0 0 ${W} ${SEG_H}">${rects}</svg>`
}

type Times = { items: Map<Timed, string>; stages: string[] }

function timesOf(p: Plan, now: number): Times {
  const items = new Map<Timed, string>()
  const live = (start: number) => {
    const took = span(now - start)
    return took && `${took}…`
  }
  let prevEnd = p.startedAt
  const stages = p.stages.map(s => {
    const stageStart = s.steps[0]?.startedAt ?? prevEnd
    for (const step of s.steps) {
      const start = step.startedAt ?? prevEnd
      if (step.endedAt !== undefined) {
        items.set(step, span(step.endedAt - start))
        prevEnd = step.endedAt
      } else if (step.status === 'active') items.set(step, live(start))
      let subEnd = start
      for (const sub of step.substeps) {
        const subStart = sub.startedAt ?? subEnd
        if (sub.endedAt !== undefined) {
          items.set(sub, span(sub.endedAt - subStart))
          subEnd = sub.endedAt
        } else if (sub.status === 'active') items.set(sub, live(subStart))
      }
    }
    const isOver = s.steps.every(step => step.endedAt !== undefined)
    const isStarted = s.steps.some(step => step.status === 'active' || step.endedAt !== undefined)
    return isOver ? span(prevEnd - stageStart) : isStarted && p.state !== 'done' ? span(now - stageStart) : ''
  })
  return { items, stages }
}

function overview(p: Plan, w: Where): string {
  const agents = p.agents ?? []
  const busy = agents.filter(a => a.state === 'running' || a.state === 'waiting').length
  if (p.id === AGENTS) return `${agents.filter(a => a.state === 'done').length}/${plural(agents.length, 'agent')} done`
  const current = p.stages.flatMap(s => s.steps).find(step => step.status === 'active' || step.status === 'error')
  const head =
    p.state === 'done'
      ? `Done at ${clockTime(touchedAt(p))}`
      : p.state === 'needs_input'
        ? `Waiting on you${p.note ? ` · ${p.note}` : ''}`
        : p.state === 'error'
          ? `Failed${p.note ? ` · ${p.note}` : ''}`
          : `Step ${Math.min(w.pos + 1, w.total)}/${w.total}${current ? ` · ${current.title}` : ''}`

  return [head, busy > 0 ? plural(busy, 'agent') : ''].filter(part => part !== '').join(' · ')
}

function agentCounts(agents: readonly AgentRun[]): string {
  const of = (state: AgentRun['state'], word: string) => {
    const n = agents.filter(a => a.state === state).length
    return n > 0 ? `${n} ${word}` : ''
  }
  return [of('running', 'running'), of('waiting', 'waiting'), of('done', 'done'), of('error', 'failed')].filter(part => part !== '').join(' · ')
}

const STEP_GLYPH: Record<StepStatus, string> = { done: '✓', active: '●', pending: '○', error: '!', skipped: '–' }

// ---------- engine glue ----------

// the engine's player first (afplay on macOS); PowerShell where it cannot play
function play($: EngineInterface, name: 'decision' | 'error' | 'done') {
  const file = `${$.plugin.root}/sounds/${name}.wav`.replace(/\//g, '\\')
  void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() =>
    $.process
      .run(['powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `(New-Object Media.SoundPlayer '${file}').PlaySync()`], { timeoutMs: 5000 })
      .catch(() => undefined),
  )
}

// the agents bar is the mod's own; the model never owes it an update
const AGENTS = 'agents:auto' // slug() never yields ':', so no model id can take it
const isOpenPlan = (p: Plan) => p.id !== AGENTS && p.state === 'running' && !p.stages.flatMap(s => s.steps).every(s => isFinished(s.status))

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'plan'

// adds or replaces one bar by id; keeps at most MAX_KEPT, dropping finished ones first
// computed inside update() from the latest list, so concurrent writers (parallel agents) do not drop each other
function placeBar(list: readonly Plan[], next: Plan): Plan[] {
  const prev = list.find(p => p.id === next.id)
  // an update keeps its row; a new bar goes to the bottom
  const rest = prev ? list.map(p => (p.id === next.id ? next : p)) : [...list, next]
  while (rest.length > MAX_KEPT) {
    const doneAt = rest.findIndex(p => p.state === 'done')
    rest.splice(doneAt >= 0 ? doneAt : 0, 1)
  }
  return rest
}

function chime($: EngineInterface, prev: PlanState | undefined, next: PlanState) {
  if (next === prev) return
  if (next === 'needs_input') play($, 'decision')
  if (next === 'error') play($, 'error')
  if (next === 'done') play($, 'done')
}

async function putPlan($: EngineInterface, next: Plan) {
  let prev: Plan | undefined
  await update($, plans, list => {
    prev = list.find(p => p.id === next.id)
    return placeBar(list, next)
  })
  chime($, prev?.state, next.state)
  if (!prev) await update($, isOpen, () => true)
  await syncPane($)
}

const isDesktopSession = async ($: EngineInterface) => (await $.session.surfaces().catch(() => [])).includes('desktop')
const findPane = async ($: EngineInterface) => (await $.ui.panes().catch(() => [])).find(pane => pane.id === PANE)

let paneSync: Promise<void> = Promise.resolve()
let pressesPending = 0
let mayBeUp = true
const SYNC_LIMIT_MS = 5000

function syncPane($: EngineInterface, isAsked = false): Promise<void> {
  const run = paneSync.then(() => reconcilePane($, isAsked))
  const settled = new Promise<void>(resolve => {
    void run.then(resolve, resolve)
    $.clock.after(SYNC_LIMIT_MS, () => resolve())
  })
  paneSync = settled

  return run
}

type PaneState = 'down' | 'up' | 'unplaced'

async function setPaneState($: EngineInterface, next: PaneState) {
  if ((await read($, paneState)) !== next) await update($, paneState, () => next)
}

async function reconcilePane($: EngineInterface, isAsked: boolean) {
  const isDesktop = await isDesktopSession($)
  if (!isDesktop && !mayBeUp) return
  const pane = await findPane($)
  mayBeUp = pane !== undefined
  const isWanted = isDesktop && (await read($, isOpen)) && (await read($, plans)).some(isDrawn)
  if (isWanted && pane === undefined) {
    if (pressesPending > 0 && !isAsked) return
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
    mayBeUp = opened !== undefined
    await setPaneState($, opened === undefined ? 'down' : opened.isPlaced ? 'up' : 'unplaced')
    return
  }
  if (!isWanted && pane !== undefined) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    mayBeUp = false
    await setPaneState($, 'down')
    return
  }
  await setPaneState($, pane === undefined ? 'down' : pane.isPlaced ? 'up' : 'unplaced')
}

// ---------- agents: drawn from engine events alone, no model calls ----------
// each subagent lives on a bar as one state strip: the open task bar it was started under,
// the bar of its parent agent, or the mod's own "Agents" bar when no task is open.
// Module maps: a reload forgets running agents, whose strips then stay until the bar is closed.
const agentHome = new Map<string, string>() // agentId -> bar id
const toolUses = new Map<string, string>() // tool_use_id -> agentId, to find who waits on a permission
const waiting = new Set<string>()
let foldUntil = 0 // keep ticking until finished strips have folded

// the mod's own bar mirrors its agents as steps, finished first, so percent and count read done/total
function syncAuto(p: Plan, now: number): Plan {
  const agents = p.agents ?? []
  const isOver = agents.length > 0 && agents.every(a => a.state === 'done' || a.state === 'error')
  const agentsDoneAt = isOver ? (p.agentsDoneAt ?? now) : null
  if (p.id !== AGENTS) return { ...p, agentsDoneAt }
  const rank = (a: AgentRun) => (a.state === 'done' ? 0 : a.state === 'error' ? 1 : 2)
  const steps: PlanStep[] = [...agents]
    .sort((a, b) => rank(a) - rank(b))
    .map(a => ({
      title: a.title,
      status: a.state === 'done' ? 'done' : a.state === 'error' ? 'error' : 'active',
      substeps: [],
      startedAt: a.startedAt,
      ...(a.endedAt === null ? {} : { endedAt: a.endedAt }),
    }))
  const state: PlanState = isOver
    ? agents.some(a => a.state === 'error') ? 'error' : 'done'
    : agents.some(a => a.state === 'waiting') ? 'needs_input' : 'running'
  return { ...p, agentsDoneAt, stages: [{ name: 'Agents', steps }], state }
}

function addRun(p: Plan, run: AgentRun, parentId: string | undefined, now: number): Plan {
  // a batch that has finished makes room for the next one
  const list = p.agentsDoneAt ? [] : [...(p.agents ?? [])]
  let at = list.length
  const parentAt = parentId ? list.findIndex(a => a.id === parentId) : -1
  if (parentAt >= 0) {
    at = parentAt + 1
    while (at < list.length && (list[at]?.depth ?? 0) > 0) at++
  }
  list.splice(at, 0, run)
  return syncAuto({ ...p, agents: list, agentsDoneAt: null, updatedAt: now }, now)
}

// changes one agent's strip inside the latest list; sounds follow the bar's state
async function editAgent($: EngineInterface, agentId: string, change: (a: AgentRun) => AgentRun) {
  const home = agentHome.get(agentId)
  if (!home) return
  const now = await $.clock.now()
  let before: PlanState | undefined
  let after: PlanState | undefined
  let isFolding = false
  await update($, plans, list =>
    list.map(p => {
      if (p.id !== home || !p.agents?.some(a => a.id === agentId)) return p
      before = p.state
      const next = syncAuto({ ...p, agents: p.agents.map(a => (a.id === agentId ? change(a) : a)) }, now)
      after = next.state
      isFolding = !p.agentsDoneAt && next.agentsDoneAt !== null
      return next
    }),
  )
  if (isFolding) foldUntil = now + FOLD_MS + 1500
  if (before !== undefined && after !== undefined) chime($, before, after)
}

async function hidePlan($: EngineInterface, id: string) {
  await update($, plans, list => list.map(p => (p.id === id ? { ...p, hidden: true } : p)))
  await syncPane($)
}

async function foldFinished($: EngineInterface) {
  if (!(await read($, plans)).some(p => p.state === 'done' && !p.isFolded)) return
  await update($, plans, list => list.map(p => (p.state === 'done' && !p.isFolded ? { ...p, isFolded: true } : p)))
  await syncPane($)
}

async function unhidePlan($: EngineInterface, id: string) {
  await update($, plans, list => list.map(p => (p.id === id ? { ...p, hidden: false } : p)))
  await syncPane($)
}

async function hideDone($: EngineInterface) {
  await update($, plans, list => list.map(p => (p.state === 'done' ? { ...p, hidden: true } : p)))
  await syncPane($)
}

async function toggleBubble($: EngineInterface, id: string) {
  await update($, expandedIds, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]))
}

async function togglePane($: EngineInterface, list: readonly Plan[]): Promise<boolean> {
  pressesPending += 1
  try {
    return await pressPane($, list)
  } finally {
    pressesPending -= 1
  }
}

async function pressPane($: EngineInterface, list: readonly Plan[]): Promise<boolean> {
  const pane = await findPane($)
  const isUnplaced = (await read($, paneState)) === 'unplaced'
  const isPaneShown = isUnplaced ? list.some(isDrawn) : pane !== undefined && pane.isShown && pane.isPlaced
  if ((await read($, isOpen)) && isPaneShown) {
    await update($, isOpen, () => false)
    await syncPane($)

    return false
  }
  if (!list.some(isDrawn)) {
    const isAllHidden = list.every(p => p.hidden)
    await update($, plans, all => all.map(p => (isAllHidden || !p.hidden ? { ...p, hidden: false, isFolded: false } : p)))
  }
  if (pane !== undefined && !isUnplaced && !isPaneShown) await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, isOpen, () => true)
  await syncPane($, true)

  return true
}

async function toggleBars($: EngineInterface): Promise<boolean> {
  const list = await read($, plans)
  if (await isDesktopSession($)) return togglePane($, list)
  const isShown = (await read($, isOpen)) && list.every(isDrawn)
  if (isShown) {
    await update($, isOpen, () => false)
    await syncPane($)

    return false
  }
  if (!list.every(isDrawn)) {
    await update($, plans, all => all.map(p => (isDrawn(p) ? p : { ...p, hidden: false, isFolded: false })))
    await update($, isExpanded, () => true)
  }
  await update($, isOpen, () => true)
  await syncPane($)

  return true
}

const STEP_SCHEMA = {
  type: 'object',
  required: ['title', 'status'],
  properties: {
    title: { type: 'string' },
    status: { enum: STATUSES },
    substeps: {
      type: 'array',
      items: { type: 'object', required: ['title', 'status'], properties: { title: { type: 'string' }, status: { enum: STATUSES } } },
    },
  },
}

// only calls that change something count as work for the enforcement below; reading and searching are free
const WORK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])
const WORK_BEFORE_PLAN = 3 // the 4th changing call without a plan is refused once
const CALLS_BEFORE_NUDGE = 6 // working calls without a plan update before a reminder

const TASK_NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g

function launchedTaskId(tool: string, result: unknown): string {
  const r = result && typeof result === 'object' ? (result as Raw) : {}
  if (tool === 'Bash' || tool === 'PowerShell') return str(r.backgroundTaskId, 80)
  if (tool === 'Monitor') return str(r.taskId, 80)
  return r.status === 'async_launched' || r.status === 'remote_launched' ? str(r.taskId, 80) || str(r.agentId, 80) : ''
}

async function noteLaunch($: EngineInterface, tool: string, result: unknown) {
  const taskId = launchedTaskId(tool, result)
  if (taskId) await update($, backgroundTaskIds, ids => [...ids.filter(id => id !== taskId), taskId])
}

function endedTaskIds(text: string): string[] {
  return [...text.matchAll(TASK_NOTIFICATION)]
    .map(m => m[1] ?? '')
    .filter(body => !/<status>\s*running\s*<\/status>/.test(body))
    .map(body => str(/<task-id>([^<]*)<\/task-id>/.exec(body)?.[1], 80))
    .filter(id => id !== '')
}

// an open bar at the end of a turn: a question to the user marks it waiting on its own;
// only a turn that did work and left the bar unexplained is sent back once
async function sendBackOpenBars($: EngineInterface, answer: string, didWork: boolean): Promise<boolean> {
  const open = (await read($, plans)).filter(isOpenPlan)
  if (open.length === 0) return false
  if (/\?\s*$/.test(answer)) {
    const last = lastTouched(open)
    if (last) await putPlan($, { ...last, state: 'needs_input' })

    return false
  }
  if (!didWork) return false
  void $.prompt
    .submit({
      text: `plan-progress: ${open.map(p => p.id).join(', ')} still open. Update each with ${TOOL}: {id, next:true}, or state "done", "needs_input" or "error" with a note.`,
    })
    .catch(() => undefined)

  return true
}

const CLEAR_COMMAND = /(^|<command-name>)\s*\/progress-clear\b/

function closeFinished(p: Plan): Plan {
  const steps = p.stages.flatMap(s => s.steps)
  return p.state !== 'done' && steps.length > 0 && steps.every(s => isFinished(s.status)) ? { ...p, state: 'done' } : p
}

async function replayBars($: EngineInterface): Promise<boolean> {
  const messages = (await $.session.messages().catch(() => undefined)) ?? []
  if (messages.length === 0) return false
  const now = await $.clock.now()
  const barCalls = messages.flatMap(m => m.toolUses).filter(use => use.tool === TOOL).length
  let callIndex = 0
  let replayed: Plan[] = []
  for (const message of messages) {
    const isPersonTyping = message.role === 'user' && message.text.trim() !== '' && (message.toolResults ?? []).length === 0
    if (isPersonTyping && CLEAR_COMMAND.test(message.text)) replayed = []
    for (const use of message.toolUses) {
      if (use.tool === TOOL) callIndex += 1
      if (use.tool !== TOOL || use.isError === true || use.text === undefined) continue
      const id = slug(str(use.input.id, 60) || str(use.input.title, 80))
      const next = normalize(use.input, replayed.find(p => p.id === id) ?? null, now - barCalls + callIndex, id)
      if (next.stages.length > 0) replayed = placeBar(replayed, next).map(closeFinished)
    }
  }
  if (replayed.length > 0) await update($, plans, current => (current.length === 0 ? replayed : current))

  return true
}

async function restoreBarsOnce($: EngineInterface): Promise<void> {
  if (await read($, isRestoreChecked)) return
  const isChecked = (await read($, plans)).length > 0 || (await replayBars($))
  if (!isChecked) return
  await update($, isRestoreChecked, () => true)
  await syncPane($)
}

export const register: Register = on => {
  // per-turn bookkeeping; module variables are fine here, a reload just starts a fresh count
  let workCalls = 0
  let sinceUpdate = 0
  let isPlanTouched = false
  let hasRefused = false

  let isRulesSent = false
  let hasSentBack = false
  let isPersonPrompt = false
  let lastLiveTick = 0

  on('turn.start', async ($, e, next) => {
    workCalls = 0
    sinceUpdate = 0
    isPlanTouched = false
    hasRefused = false
    await restoreBarsOnce($)
    if (isPersonPrompt) await foldFinished($)
    isPersonPrompt = false

    return next(e)
  })

  // the rules ride the session's first prompt; a message only carries one short line when bars are open
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin' || e.origin.name !== 'plan-progress') hasSentBack = false
    const ended = e.origin.kind === 'task-notification' ? endedTaskIds(e.text) : []
    if (ended.length > 0) await update($, backgroundTaskIds, ids => ids.filter(id => !ended.includes(id)))
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') isPersonPrompt = true
    const enter = async (entering: typeof e) => {
      if (isRulesSent) return next(entering)
      const entered = await next({ ...entering, context: [...(entering.context ?? []), RULES] })
      if (entered.drop === undefined) isRulesSent = true

      return entered
    }
    if (e.origin.kind !== 'composer') return enter(e)
    const open = (await read($, plans)).filter(p => p.state !== 'done' && p.id !== AGENTS)
    if (open.length === 0) return enter(e)
    const line = `plan-progress open bars: ${open
      .map(p => {
        const w = where(p)
        return `${p.id} (${p.stages[w.stage]?.name ?? ''} ${w.step}/${w.stageSize}${p.state === 'running' ? '' : `, ${p.state}`})`
      })
      .join(', ')}`

    return enter({ ...e, context: [...(e.context ?? []), line] })
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) isRulesSent = false

    return result
  })

  on('session.end', async ($, e, next) => {
    isRulesSent = false

    return next(e)
  })

  // watches the main loop's changing calls: refuses once when multi-step work starts without a bar,
  // and reminds to update the bar when it goes stale mid-turn
  on('tool.call', async ($, e, next) => {
    // a subagent's call only names its current tool on its strip; no gate, no reminders
    if (e.agentId) {
      const agentId = e.agentId
      if (!agentHome.has(agentId)) return next(e)
      await editAgent($, agentId, a => ({ ...a, state: 'running', tool: e.tool }))
      if (e.tool_use_id) toolUses.set(e.tool_use_id, agentId)
      const ran = await next(e)
      if (e.tool_use_id) toolUses.delete(e.tool_use_id)
      if (waiting.delete(agentId)) await editAgent($, agentId, a => (a.state === 'waiting' ? { ...a, state: 'running' } : a))
      return ran
    }
    if (!WORK_TOOLS.has(e.tool)) {
      const ran = await next(e)
      await noteLaunch($, e.tool, ran.result)

      return ran
    }
    const bars = await read($, plans)
    const hasLivePlan = isPlanTouched || bars.some(isOpenPlan)
    if (!hasLivePlan && !bars.some(p => p.state === 'needs_input') && !hasRefused && workCalls >= WORK_BEFORE_PLAN) {
      hasRefused = true

      return { deny: `plan-progress: several changes ahead. Create a bar with ${TOOL} first, then retry.` }
    }
    const ran = await next(e)
    await noteLaunch($, e.tool, ran.result)
    // a shell call that only read (ls, git status, grep) is not work
    if (ran.deny !== undefined || ran.isReadOnly) return ran
    workCalls += 1
    sinceUpdate += 1
    if (hasLivePlan && sinceUpdate >= CALLS_BEFORE_NUDGE) {
      sinceUpdate = 0

      return { ...ran, context: [...(ran.context ?? []), `plan-progress: bar is stale, send {id, next:true} or {id, done, active}.`] }
    }

    return ran
  })

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan_progress',
      description: 'Live progress bar the user sees, one per id. Create with title + stages; update with short ops (next, done, active, failed) or state.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Bar id; reuse it for updates' },
          title: { type: 'string' },
          kind: { enum: ['plan', 'todo'] },
          stages: {
            type: 'array',
            description: 'Full breakdown, only when creating or restructuring',
            items: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, steps: { type: 'array', items: STEP_SCHEMA } } },
          },
          next: { type: 'boolean', description: 'Active step finished, start the next one' },
          done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
          active: { type: 'string', description: 'Step title now in progress' },
          failed: { type: 'string', description: 'Step title that failed' },
          state: { enum: ['running', 'needs_input', 'error', 'done'] },
          note: { type: 'string', description: 'One line for needs_input or error' },
        },
      },
    })
    $.clock.every(1000, async () => {
      const now = await $.clock.now()
      if (agentHome.size > 0 || now < foldUntil) {
        await update($, tick, n => n + 1)
        return
      }
      if (now - lastLiveTick < LIVE_TICK_MS) return
      lastLiveTick = now
      if ((await read($, plans)).some(p => isDrawn(p) && p.state !== 'done')) await update($, tick, n => n + 1)
    })
    await $.command.register({ name: 'progress', description: 'Show or hide the progress bars' })
    await $.command.register({ name: 'progress-demo', description: 'Show a sample plan in the progress bars' })
    await $.command.register({ name: 'progress-sounds', description: 'Play the decision, error and done sounds' })
    await $.command.register({ name: 'progress-clear', description: 'Remove all progress bars' })
    const started = await next(e)
    await restoreBarsOnce($)
    await syncPane($)

    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (e.surface === 'desktop') await syncPane($)

    return attached
  })

  on('session.detach', async ($, e, next) => {
    const detached = await next(e)
    if (e.surface === 'desktop') await syncPane($)

    return detached
  })

  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE) return next(e)
    if (e.origin.kind === 'person') await update($, isOpen, () => false)
    const closed = await next(e)
    mayBeUp = false
    await setPaneState($, 'down')

    return closed
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const raw = e as unknown as Raw
    const now = await $.clock.now()
    const list = await read($, plans)
    const id = slug(str(raw.id, 60) || str(raw.title, 80))
    const next = normalize(raw, list.find(p => p.id === id) ?? null, now, id)
    if (next.stages.length === 0) return { deny: `plan_progress: no bar "${id}" yet; create it with title and stages.` }
    isPlanTouched = true
    sinceUpdate = 0
    await putPlan($, next)
    const w = where(next)

    const active = next.stages.flatMap(st => st.steps).find(st => st.status === 'active')

    return { result: `${id}: ${Math.min(w.pos, w.total)}/${w.total}, ${next.state}${active ? `, active "${active.title}"` : ''}` }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const live = lastTouched((await read($, plans)).filter(p => p.state === 'running'))
    if (live) await update($, plans, list => list.map(p => (p.id === live.id ? { ...p, state: 'needs_input' as const } : p)))
    play($, 'decision')
    const ran = await next(e)
    if (live) await update($, plans, list => list.map(p => (p.id === live.id && p.state === 'needs_input' ? { ...p, state: 'running' as const } : p)))

    return ran
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    play($, 'decision')
    const ran = await next(e)
    const text = ran.deny === undefined && ran.isError !== true ? (ran.result as { plan?: unknown } | undefined)?.plan : undefined
    if (typeof text === 'string') {
      const parsed = parsePlan(text, await $.clock.now())
      if (parsed) await putPlan($, { ...parsed, id: slug(parsed.title) })
    }

    return ran
  })

  on('command.run', { command: 'progress' }, async $ => {
    if ((await read($, plans)).length === 0) return { text: 'No plan yet. /progress-demo shows a sample.' }
    const isShown = await toggleBars($)

    return { text: isShown ? 'Progress bars shown.' : 'Progress bars hidden.' }
  })

  on('command.run', { command: 'progress-demo' }, async $ => {
    await putPlan($, DEMO(await $.clock.now()))
    await update($, isOpen, () => true)
    await syncPane($)

    return { text: 'Sample plan shown.' }
  })

  on('command.run', { command: 'progress-clear' }, async $ => {
    await update($, plans, () => [])
    await update($, expandedIds, () => [])
    await syncPane($)

    return { text: 'Progress bars removed.' }
  })

  on('command.run', { command: 'progress-sounds' }, async $ => {
    play($, 'decision')
    $.clock.after(900, () => play($, 'error'))
    $.clock.after(1800, () => play($, 'done'))

    return { text: 'Sounds: decision, error, done.' }
  })

  // always drawn, so the person sees the mod is loaded; dim while there is nothing to show
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const all = await read($, plans)
    const count = all.filter(isDrawn).length
    const isPaneDown = e.surface === 'desktop' && (await read($, paneState)) === 'down'
    const isShown = (await read($, isOpen)) && count > 0 && !isPaneDown
    const { Box, Button } = $.ui.resolve(e)
    // other mods add their labels to modes beneath us; keep them
    const below = await next(e)
    const press = () =>
      all.length === 0
        ? $.ui.toast('plan-progress is on. A bar appears when Claude starts a task with several steps.')
        : toggleBars($)

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {e.surface === 'desktop' ? (
          <Button key="progress-toggle" plain dimColor={!isShown} label={count > 1 ? `Progress ${count}` : 'Progress'} onPress={press} />
        ) : (
          <Button key="progress-toggle" dimColor={!isShown} label={count > 1 ? `Progress ${count}` : 'Progress'} onPress={press} />
        )}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'desktop' && (await read($, paneState)) !== 'unplaced') return next(e)
    const shown = (await read($, plans)).filter(isDrawn).slice(-MAX_BARS)
    if (shown.length === 0 || e.props.hasSurvey || !(await read($, isOpen))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isWide = await read($, isExpanded)
    const focus = focusBar(shown)
    const list = isWide || !focus ? shown : [focus]

    return (
      <Box flexDirection="column" gap={1}>
        {list.map((p, i) => {
          const w = where(p)
          const pct = percent(p, w)
          const color = STATE_COLOR[p.state]
          const stageName = p.stages[w.stage]?.name ?? ''
          const bar = `${'━'.repeat(Math.round(pct / 4))}${'─'.repeat(25 - Math.round(pct / 4))}`

          return (
            <Box key={`bar-${p.id}`} flexDirection="row" alignItems="center" gap={1}>
              <Text color={color}>{STATE_GLYPH[p.state]}</Text>
              <Text wrap="truncate">{p.title}</Text>
              {i === 0 && shown.length > 1
                ? [<Button key="progress-expand" plain dimColor label={isWide ? '▴' : `+${shown.length - 1}`} onPress={() => update($, isExpanded, wide => !wide)} />]
                : []}
              <Box flexGrow={1} />
              <Text>
                <Text color={color}>{bar.replace(/─/g, '')}</Text>
                <Text dimColor>{bar.replace(/━/g, '')}</Text>
                <Text color={color}>{` ${stageName} ${w.step}/${w.stageSize}`}</Text>
              </Text>
              <Text dimColor>{`${String(pct).padStart(3, FIGURE_SPACE)}%`}</Text>
              <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => hidePlan($, p.id)} />
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Button, Text } = t
    const Svg = e.surface === 'desktop' && 'Svg' in t ? t.Svg : null
    await read($, tick)
    const now = await $.clock.now()
    const kept = await read($, plans)
    const all = kept.filter(p => !p.hidden)
    const opened = await read($, expandedIds)
    const isOlderShown = await read($, isHistoryOpen)
    if (kept.length === 0) return <Text dimColor>No progress bars.</Text>
    const isDesktop = e.surface === 'desktop'
    const columns = e.props.bodyColumns || 40
    const detailWidth = Math.min(1400, Math.max(120, (columns - DETAIL_INDENT - 2) * 7))
    const byRecent = (a: Plan, b: Plan) => touchedAt(b) - touchedAt(a)
    const live = all.filter(p => p.state !== 'done').sort(byRecent)
    const done = all.filter(p => p.state === 'done').sort(byRecent)
    const older = [...done.slice(RECENT_DONE), ...kept.filter(p => p.hidden)].sort(byRecent)
    const rowFill = ROW_FILL_CHAR.repeat(Math.max(1, Math.floor(columns * ROW_FILL_PER_COLUMN)))

    const heading = (key: string, text: string, top: number, extra: RenderElement[] = []) => (
      <Box key={key} flexDirection="row" alignItems="center" paddingX={1} marginTop={top}>
        <Text bold dimColor>
          {text}
        </Text>
        <Box flexGrow={1} />
        {extra}
      </Box>
    )

    const stepRow = (item: Timed, key: string, depth: number, tint: string, times: Times) => {
      const isLive = item.status === 'active' || item.status === 'error'
      const took = times.items.get(item) ?? ''
      const glyph = item.status === 'pending' ? <Text dimColor>{STEP_GLYPH.pending}</Text> : <Text color={stepColor(item.status, tint)}>{STEP_GLYPH[item.status]}</Text>

      return (
        <Box key={key} flexDirection="row" gap={1} marginLeft={depth * 2} minWidth={0}>
          {glyph}
          <Box flexGrow={1} minWidth={0}>
            <Text bold={isLive} dimColor={!isLive} wrap="truncate">
              {item.title}
            </Text>
          </Box>
          {took ? [<Text key={`${key}-time`} dimColor>{took}</Text>] : []}
        </Box>
      )
    }

    const agentRows = (p: Plan) => {
      const agents = p.agents ?? []
      if (agents.length === 0) return []
      return [
        heading(`agents-${p.id}`, 'Agents', 1, [<Text key={`agents-${p.id}-count`} dimColor>{agentCounts(agents)}</Text>]),
        ...agents.map(a => (
          <Box key={`agent-${p.id}-${a.id}`} flexDirection="row" gap={1} paddingX={1} marginLeft={a.depth * 2} minWidth={0}>
            <Text color={AGENT_COLOR[a.state]}>{AGENT_GLYPH[a.state]}</Text>
            <Box flexGrow={1} minWidth={0}>
              <Text dimColor={a.state === 'done'} wrap="truncate">
                {a.title}
              </Text>
            </Box>
            <Text dimColor>{a.tool}</Text>
            <Text dimColor>{elapsed((a.endedAt ?? now) - a.startedAt)}</Text>
          </Box>
        )),
      ]
    }

    const detail = (p: Plan) => {
      const w = where(p)
      const color = STATE_COLOR[p.state]
      const times = timesOf(p, now)
      const took = span(endOf(p, now) - p.startedAt)
      const isSingle = p.stages.length === 1

      return (
        <Box key={`detail-${p.id}`} flexDirection="column" marginLeft={DETAIL_INDENT} marginRight={1} marginBottom={1} minWidth={0}>
          <Text dimColor>{`${clockTime(p.startedAt)} → ${p.state === 'done' ? clockTime(touchedAt(p)) : 'now'}${took ? ` · ${took}` : ''}`}</Text>
          {p.note
            ? [
                <Box key={`note-${p.id}`} paddingX={1} marginTop={1} backgroundColor={`${color}26`}>
                  <Text color={color} wrap="wrap">
                    {p.note}
                  </Text>
                </Box>,
              ]
            : []}
          {Svg && p.id !== AGENTS
            ? [
                <Box key={`steps-${p.id}`} marginTop={1}>
                  <Svg source={stepsSvg(p, detailWidth)} alt={`${p.title}: ${Math.min(w.pos, w.total)}/${w.total} steps`} width={detailWidth} height={SEG_H} />
                </Box>,
              ]
            : []}
          {p.id === AGENTS
            ? []
            : p.stages.flatMap((s, i) => {
                const finished = s.steps.filter(step => isFinished(step.status)).length
                const stageTime = times.stages[i] ?? ''
                const head = isSingle
                  ? []
                  : [
                      <Box key={`stage-${p.id}-${i}`} flexDirection="row" marginTop={1} minWidth={0}>
                        <Box flexGrow={1} minWidth={0}>
                          <Text bold dimColor wrap="truncate">
                            {s.name}
                          </Text>
                        </Box>
                        <Text dimColor>{`${finished}/${s.steps.length}${stageTime ? ` · ${stageTime}` : ''}`}</Text>
                      </Box>,
                    ]
                return [
                  ...head,
                  ...s.steps.flatMap((step, j) => [
                    stepRow(step, `step-${p.id}-${i}-${j}`, 0, color, times),
                    ...step.substeps.map((sub, k) => stepRow(sub, `sub-${p.id}-${i}-${j}-${k}`, 1, color, times)),
                  ]),
                ]
              })}
          {agentRows(p)}
          <Box flexDirection="row" marginTop={1}>
            <Box flexGrow={1} />
            {p.hidden ? (
              <Button key={`close-${p.id}`} plain dimColor label="Show again" onPress={() => unhidePlan($, p.id)} />
            ) : (
              <Button key={`close-${p.id}`} plain dimColor label="Hide" onPress={() => hidePlan($, p.id)} />
            )}
          </Box>
        </Box>
      )
    }

    const row = (p: Plan, isCompact: boolean) => {
      const w = where(p)
      const pct = percent(p, w)
      const color = STATE_COLOR[p.state]
      const isWide = opened.includes(p.id)
      const isAlert = p.state === 'needs_input' || p.state === 'error'
      const toggle = () => toggleBubble($, p.id)
      const took = shortSpan(endOf(p, now) - p.startedAt)
      const mark = isCompact || !Svg ? <Text color={color}>{STATE_GLYPH[p.state]}</Text> : <Svg source={ringSvg(p, pct)} alt={`${p.title} ${pct}%`} width={RING} height={RING} />
      const right = isCompact ? [clockTime(touchedAt(p))] : [took].filter(part => part !== '')
      const line = isAlert ? (
        <Text key={`line-${p.id}`} color={color} wrap="truncate">
          {overview(p, w)}
        </Text>
      ) : (
        <Text key={`line-${p.id}`} dimColor wrap="truncate">
          {overview(p, w)}
        </Text>
      )

      return [
        <Box key={`row-${p.id}`} position="relative" flexDirection="row" alignItems="center" gap={1} paddingX={1} minWidth={0} {...(isDesktop ? {} : { hover: { backgroundColor: HOVER_BG } })}>
          {mark}
          <Box flexDirection="column" flexGrow={1} minWidth={0}>
            {isDesktop ? (
              <Text key={`title-${p.id}`} dimColor={p.state === 'done' || p.hidden === true} wrap="truncate">
                {p.title}
              </Text>
            ) : (
              <Button key={`toggle-${p.id}`} plain dimColor={p.state === 'done'} label={p.title} onPress={toggle} />
            )}
            {isCompact ? [] : [line]}
          </Box>
          <Box flexDirection="column" alignItems="flex-end">
            {right.map((part, i) => (
              <Text key={`right-${p.id}-${i}`} dimColor>
                {part}
              </Text>
            ))}
          </Box>
          {isDesktop ? (
            <Text key={`chevron-${p.id}`} dimColor>
              {isWide ? '⌄' : '›'}
            </Text>
          ) : (
            <Button key={`chevron-${p.id}`} plain dimColor label={isWide ? '▾' : '▸'} onPress={toggle} />
          )}
          {isDesktop ? (
            <Box key={`hit-${p.id}`} position="absolute" top={0} bottom={0} left={0} right={0} flexDirection="row" alignItems="stretch">
              <Button key={`toggle-${p.id}`} plain label={rowFill} onPress={toggle} />
            </Box>
          ) : (
            []
          )}
        </Box>,
        ...(isWide ? [detail(p)] : []),
      ]
    }

    return (
      <Box flexDirection="column">
        {live.length > 0 ? [heading('live-head', `Active · ${live.length}`, 0), ...live.flatMap(p => row(p, false))] : []}
        {done.length > 0
          ? [
              heading('done-head', `Done · ${done.length}`, live.length > 0 ? 1 : 0, [<Button key="hide-done" plain dimColor label="Hide all" onPress={() => hideDone($)} />]),
              ...done.slice(0, RECENT_DONE).flatMap(p => row(p, false)),
            ]
          : older.length > 0
            ? [heading('history-head', 'History', live.length > 0 ? 1 : 0)]
            : []}
        {isOlderShown ? older.flatMap(p => row(p, true)) : []}
        {older.length > 0
          ? [
              <Box key="older-row" flexDirection="row" paddingX={1}>
                <Button key="older" plain dimColor label={isOlderShown ? 'Show fewer' : `Show ${older.length} older`} onPress={() => update($, isHistoryOpen, shown => !shown)} />
              </Box>,
            ]
          : []}
      </Box>
    )
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!('agentId' in started) || !started.agentId) return started
    const id = started.agentId
    const now = await $.clock.now()
    const parentHome = e.parentAgentId ? agentHome.get(e.parentAgentId) : undefined
    const home = parentHome ?? [...(await read($, plans))].reverse().find(isOpenPlan)?.id ?? AGENTS
    agentHome.set(id, home)
    const run: AgentRun = {
      id,
      title: (e.description || e.subagentType).slice(0, 60),
      state: 'running',
      tool: 'Starting',
      startedAt: now,
      endedAt: null,
      depth: parentHome ? 1 : 0,
    }
    let isNew = false
    await update($, plans, list => {
      if (list.some(p => p.id === home)) {
        return list.map(p => {
          if (p.id !== home) return p
          const added = { ...addRun(p, run, e.parentAgentId, now), isFolded: false }
          return p.id === AGENTS && typeof p.agentsDoneAt === 'number' ? { ...added, hidden: false } : added
        })
      }
      isNew = true
      const auto: Plan = { id: AGENTS, title: 'Agents', kind: 'todo', stages: [], state: 'running', note: null, startedAt: now }
      return placeBar(list, addRun(auto, run, undefined, now))
    })
    if (isNew) await update($, isOpen, () => true)
    await syncPane($)

    return started
  })

  // an agent waiting on a permission prompt turns its strip amber until the call goes on
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const agentId = e.tool_use_id ? toolUses.get(e.tool_use_id) : undefined
    const useId = e.tool_use_id
    // the mode often settles an ask by itself in a blink; only a call still held after a moment waits on the person
    if (agentId && useId && verdict.decision === 'ask') {
      $.clock.after(600, async () => {
        if (toolUses.get(useId) !== agentId) return
        waiting.add(agentId)
        await editAgent($, agentId, a => ({ ...a, state: 'waiting', tool: 'Needs approval' }))
      })
    }

    return verdict
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId && agentHome.has(agentId)) {
      const now = await $.clock.now()
      const isFailed = e.reason !== 'answer'
      const tool = e.reason === 'aborted' ? 'Stopped' : isFailed ? 'Failed' : 'Done'
      await editAgent($, agentId, a => ({ ...a, state: isFailed ? 'error' : 'done', tool, endedAt: now }))
      // the mod's own bar sounds through its state; a strip on a task bar sounds here
      if (isFailed && agentHome.get(agentId) !== AGENTS) play($, 'error')
      agentHome.delete(agentId)
      waiting.delete(agentId)
    }
    if (agentId && (await read($, backgroundTaskIds)).includes(agentId)) {
      await update($, backgroundTaskIds, ids => ids.filter(id => id !== agentId))
    }
    // a plan whose steps are all finished closes itself
    for (const p of await read($, plans)) {
      if (p.id === AGENTS) continue
      if (p.state === 'done') continue
      const steps = p.stages.flatMap(s => s.steps)
      if (steps.length > 0 && steps.every(s => isFinished(s.status))) await putPlan($, { ...p, state: 'done' })
    }
    if (!agentId && e.reason === 'answer' && !hasSentBack && agentHome.size === 0 && (await read($, backgroundTaskIds)).length === 0) {
      hasSentBack = await sendBackOpenBars($, e.answer, workCalls > 0 || isPlanTouched)
    }

    return next(e)
  })
}
