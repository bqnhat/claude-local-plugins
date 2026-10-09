import { mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const TOOL = 'mcp__session-hub__plan_progress'
const PLUGIN = 'session-hub'
const PANE = 'session-hub'
const MARK = '@@HUB_FIXTURE@@'
const WIDTHS: number[] = [42, 76]

type Usage = { read: number; write: number; fresh: number }
type World = { clock: MockClock; usage: Usage; model: string; isPaneUp: boolean }
type Shot = { name: string; section?: 'progress' | 'next' | 'calls' | 'cache'; cacheView?: 'tokens' | 'savings'; expand?: string[]; collapse?: string[] }

const at = (hh: number, mm: number, ss = 0) => new Date(2026, 9, 9, hh, mm, ss).getTime()

function world(on: On, now: number, model = 'claude-opus-5-5'): World {
  const w: World = { clock: mock.clock(on, { now }), usage: { read: 0, write: 0, fresh: 0 }, model, isPaneUp: false }
  mock.store(on, {})
  on('session.surfaces', async () => ({ value: ['desktop'] }))
  on('session.messages', async () => ({ value: [] }))
  on('session.cwd', async () => ({ value: 'C:\\work\\app' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } as never }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.register', async () => ({ value: undefined }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.call', async () => ({ result: undefined as never }))
  on('audio.play', async () => ({ value: undefined }))
  on('ui.open', async () => {
    w.isPaneUp = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: w.isPaneUp ? [{ id: PANE, title: 'Mod status', isShown: true, isFocused: false, isPlaced: true, plugin: PLUGIN }] : [] }))
  on('ui.toast', async () => ({ value: undefined }))
  on('agent.list', async () => ({ value: [] }))
  on('agent.spawn', async (_$, e) => ({ model: 'test-model', agentId: `agent-${e.tool_use_id}` }))
  on('ui.render', async () => <></>)
  on('turn.step', async function* (_$, e) {
    const u = w.usage
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: u.fresh, output_tokens: 10, cache_read_input_tokens: u.read, cache_creation_input_tokens: u.write, model: w.model },
    } as never
  })
  return w
}

async function request($: Engine, w: World, turnId: string, usage: Usage) {
  w.usage = usage
  const stream = $.turn.step({ turnId, index: 0, model: w.model, messageCount: 1 } as never)
  for await (const _chunk of stream) {
  }
}

async function turn($: Engine, w: World, turnId: string, steps: number, total: Usage, last?: Usage, gapMs = 20_000) {
  const tail = last ?? { read: Math.round(total.read / steps), write: Math.round(total.write / steps), fresh: Math.round(total.fresh / steps) }
  const head = { read: total.read - tail.read, write: total.write - tail.write, fresh: total.fresh - tail.fresh }
  for (let i = 0; i < steps - 1; i++) {
    const share = (n: number) => Math.round(n / (steps - 1))
    await request($, w, turnId, { read: share(head.read), write: share(head.write), fresh: share(head.fresh) })
    await w.clock.advance(gapMs)
  }
  await request($, w, turnId, tail)
}

const bar = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never)

async function dump($: Engine, scenario: string, shots: Shot[]) {
  for (const shot of shots) {
    for (const columns of WIDTHS) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'desktop',
        component: 'Pane',
        requestId: PANE,
        props: { title: 'Mod status', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } as never,
      })
      if (shot.section) await ui.press({ key: `rail-${shot.section}` })
      if (shot.cacheView) await ui.press({ key: `cache-view-${shot.cacheView}` })
      for (const id of shot.expand ?? []) if (await ui.find({ type: 'Button', key: `toggle-${id}` })) await ui.press({ key: `toggle-${id}` })
      const tree = await ui.drawn()
      console.log(`${MARK}${JSON.stringify({ scenario, shot: shot.name, columns, tree })}`)
      for (const id of shot.expand ?? []) if (await ui.find({ type: 'Button', key: `toggle-${id}` })) await ui.press({ key: `toggle-${id}` })
      await ui.unmount()
    }
  }
}

const UI_CHECK = {
  id: 'ui-check',
  title: 'UI check',
  stages: [
    { name: 'Khảo sát', steps: [{ title: 'Đọc khung pane', status: 'done' }, { title: 'Đọc API UI', status: 'done' }] },
    { name: 'Sửa code', steps: [{ title: 'Tab Tokens', status: 'done' }, { title: 'Tab Savings', status: 'done' }, { title: 'Footer TTL', status: 'active' }] },
    { name: 'Kiểm tra', steps: [{ title: 'Chạy test', status: 'pending' }, { title: 'Xem trên pane', status: 'pending' }] },
  ],
}

test('progress-design: the failed bar from the design, expanded', { options: { ttlMinutes: 5 } }, async ($, on) => {
  const w = world(on, at(17, 46))
  await bar($, {
    id: 'cache-pane',
    title: 'Cache pane Mềm',
    stages: [
      { name: 'Khảo sát', steps: [{ title: 'Đọc khung pane', status: 'active' }, { title: 'Đọc API UI', status: 'pending' }] },
      { name: 'Sửa code', steps: [{ title: 'Tab Tokens', status: 'pending' }, { title: 'Tab Savings', status: 'pending' }, { title: 'Footer TTL', status: 'pending' }] },
      { name: 'Kiểm tra', steps: [{ title: 'Chạy test', status: 'pending' }, { title: 'Xem trên pane', status: 'pending' }] },
      { name: 'Phát hành', steps: [{ title: 'Tăng version', status: 'pending' }, { title: 'Commit và push', status: 'pending' }] },
    ],
  })
  await w.clock.advance(96_000)
  await bar($, { id: 'cache-pane', done: ['Đọc khung pane', 'Đọc API UI'], active: 'Tab Tokens' })
  await w.clock.advance(149_000)
  await bar($, { id: 'cache-pane', done: ['Tab Tokens', 'Tab Savings'], active: 'Footer TTL' })
  await w.clock.advance(29_000)
  await bar($, { id: 'cache-pane', done: ['Footer TTL'], active: 'Chạy test' })
  await w.clock.advance(250_000)
  await bar($, { id: 'cache-pane', done: ['Chạy test'], active: 'Tăng version' })
  await w.clock.advance(22_000)
  await bar($, { id: 'cache-pane', done: ['Tăng version', 'Commit và push'], active: 'Xem trên pane' })
  await w.clock.advance(22_000)
  await bar($, { id: 'cache-pane', failed: 'Xem trên pane', note: 'Phiên này giữ bản đã nạp; cần cập nhật plugin + phiên mới' })
  await turn($, w, 't1', 3, { read: 300_000, write: 151_000, fresh: 30 }, { read: 0, write: 151_000, fresh: 2 })
  await w.clock.set(at(17, 57))
  await dump($, 'progress-design', [{ name: 'expanded', section: 'progress', expand: ['cache-pane'] }, { name: 'collapsed', section: 'progress' }])
})

test('progress-local62: the UI check bar from the local.62 screenshot', { options: { ttlMinutes: 60 } }, async ($, on) => {
  const w = world(on, at(18, 9, 0))
  await bar($, UI_CHECK)
  await w.clock.advance(16_000)
  await bar($, { id: 'ui-check', done: ['Footer TTL', 'Chạy test'], active: 'Xem trên pane' })
  await w.clock.advance(2_000)
  await bar($, { id: 'ui-check', failed: 'Xem trên pane', note: 'Bar mẫu để chụp kiểm tra giao diện' })
  await turn($, w, 't1', 9, { read: 716_000, write: 39_900, fresh: 18 }, { read: 88_300, write: 201, fresh: 2 }, 3000)
  await w.clock.advance(31_000)
  await dump($, 'progress-local62', [{ name: 'expanded', section: 'progress', expand: ['ui-check'] }])
})

test('cache-local62: one turn from the local.62 screenshot', { options: { ttlMinutes: 60 } }, async ($, on) => {
  const w = world(on, at(18, 8, 30), 'claude-sonnet-5-5')
  await turn($, w, 't1', 9, { read: 716_000, write: 39_900, fresh: 18 }, { read: 88_300, write: 201, fresh: 2 }, 3000)
  await w.clock.advance(40_000)
  await dump($, 'cache-local62', [{ name: 'tokens', section: 'cache', cacheView: 'tokens' }])
})

test('cache-design: four turns from the design, both tabs', { options: { ttlMinutes: 5 } }, async ($, on) => {
  const w = world(on, at(13, 40))
  await turn($, w, 't1', 17, { read: 1_740_000, write: 79_200, fresh: 34 })
  await w.clock.set(at(13, 50))
  await turn($, w, 't2', 4, { read: 436_000, write: 86_200, fresh: 8 })
  await w.clock.set(at(13, 55))
  await turn($, w, 't3', 11, { read: 1_560_000, write: 16_000, fresh: 22 })
  await w.clock.set(at(13, 59))
  await turn($, w, 't4', 1, { read: 151_000, write: 2_800, fresh: 2 })
  await w.clock.set(at(14, 0, 48))
  await bar($, { ...UI_CHECK, id: 'ui-check' })
  await dump($, 'cache-design', [
    { name: 'tokens', section: 'cache', cacheView: 'tokens' },
    { name: 'savings', section: 'cache', cacheView: 'savings' },
  ])
})

test('cache-many: fourteen turns, the chart keeps the last twelve', { options: { ttlMinutes: 60 } }, async ($, on) => {
  const w = world(on, at(9, 0))
  for (let i = 1; i <= 14; i++) {
    const read = 200_000 + ((i * 137_000) % 900_000)
    await turn($, w, `t${i}`, 1 + (i % 5), { read, write: i % 4 === 0 ? 120_000 : 6_000 + i * 900, fresh: 4 + i })
    await w.clock.advance(4 * 60_000)
  }
  await dump($, 'cache-many', [
    { name: 'tokens', section: 'cache', cacheView: 'tokens' },
    { name: 'savings', section: 'cache', cacheView: 'savings' },
  ])
})

test('cache-expiring: under a minute left', { options: { ttlMinutes: 5, warnMinutes: 1 } }, async ($, on) => {
  const w = world(on, at(10, 0))
  await turn($, w, 't1', 3, { read: 90_000, write: 40_000, fresh: 12 })
  await w.clock.advance(4 * 60_000 + 20_000)
  await dump($, 'cache-expiring', [{ name: 'tokens', section: 'cache', cacheView: 'tokens' }])
})

test('cache-expired: the cache ran out', { options: { ttlMinutes: 5 } }, async ($, on) => {
  const w = world(on, at(10, 0))
  await turn($, w, 't1', 2, { read: 40_000, write: 60_000, fresh: 12 })
  await w.clock.advance(7 * 60_000)
  await dump($, 'cache-expired', [{ name: 'tokens', section: 'cache', cacheView: 'tokens' }])
})

test('cache-guess: lifetime not learned yet', async ($, on) => {
  const w = world(on, at(10, 0), 'claude-sonnet-5-5')
  await turn($, w, 't1', 2, { read: 0, write: 60_000, fresh: 1200 })
  await w.clock.advance(30_000)
  await dump($, 'cache-guess', [{ name: 'tokens', section: 'cache', cacheView: 'tokens' }])
})

test('progress-mixed: running, waiting, done and history', { options: { ttlMinutes: 60 } }, async ($, on) => {
  const w = world(on, at(9, 10))
  for (let i = 1; i <= 5; i++) {
    await bar($, { id: `old-${i}`, title: `Việc cũ số ${i}`, stages: [{ name: 'Làm', steps: [{ title: 'Bước một', status: 'done' }, { title: 'Bước hai', status: 'active' }] }] })
    await w.clock.advance(60_000)
    await bar($, { id: `old-${i}`, state: 'done' })
  }
  await bar($, {
    id: 'deploy',
    title: 'Triển khai bản vá thanh toán',
    stages: [
      { name: 'Chuẩn bị', steps: [{ title: 'Đọc log lỗi', status: 'done' }, { title: 'Tái hiện lỗi', status: 'done' }] },
      { name: 'Sửa', steps: [{ title: 'Sửa validate', status: 'active', substeps: [{ title: 'Ngày tháng', status: 'done' }, { title: 'Số tiền', status: 'active' }] }, { title: 'Viết test', status: 'pending' }] },
      { name: 'Phát hành', steps: [{ title: 'Tạo PR', status: 'pending' }] },
    ],
  })
  await w.clock.advance(140_000)
  await bar($, { id: 'ask', title: 'Chọn cách đặt tên nhánh', kind: 'todo', stages: [{ name: 'Việc', steps: [{ title: 'Liệt kê lựa chọn', status: 'done' }, { title: 'Chờ người dùng chọn', status: 'active' }] }] })
  await bar($, { id: 'ask', state: 'needs_input', note: 'Cần ngài chọn tiền tố nhánh' })
  await w.clock.advance(35_000)
  await turn($, w, 't1', 4, { read: 300_000, write: 20_000, fresh: 40 })
  await dump($, 'progress-mixed', [
    { name: 'list', section: 'progress' },
    { name: 'running-expanded', section: 'progress', expand: ['deploy'] },
    { name: 'waiting-expanded', section: 'progress', expand: ['ask'] },
  ])
})

test('progress-long: long titles and a single-stage list', { options: { ttlMinutes: 60 } }, async ($, on) => {
  const w = world(on, at(11, 0))
  await bar($, {
    id: 'long',
    title: 'Đồng bộ toàn bộ dữ liệu hội viên từ hệ thống cũ sang hệ thống mới kèm kiểm tra chéo',
    kind: 'todo',
    stages: [
      {
        name: 'Việc',
        steps: [
          { title: 'Xuất dữ liệu hội viên từ cơ sở dữ liệu cũ theo từng lô năm nghìn bản ghi', status: 'done' },
          { title: 'Chuẩn hoá định dạng số điện thoại và địa chỉ', status: 'done' },
          { title: 'Nạp vào hệ thống mới', status: 'active' },
          { title: 'Đối chiếu số lượng', status: 'pending' },
          { title: 'Báo cáo', status: 'pending' },
        ],
      },
    ],
  })
  await w.clock.advance(400_000)
  await turn($, w, 't1', 2, { read: 120_000, write: 9_000, fresh: 20 })
  await dump($, 'progress-long', [{ name: 'expanded', section: 'progress', expand: ['long'] }])
})

test('empty: nothing yet', async ($, on) => {
  world(on, at(8, 0))
  await dump($, 'empty', [
    { name: 'progress', section: 'progress' },
    { name: 'cache', section: 'cache' },
  ])
})
