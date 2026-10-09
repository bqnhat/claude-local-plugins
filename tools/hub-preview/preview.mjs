#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARK = '@@HUB_FIXTURE@@'
const USAGE = `Usage: node tools/hub-preview/preview.mjs [options]

Renders the session-hub Mod status pane from the sample data sets in
fixtures.test.tsx, without opening a Claude session.

  --plugin <dir>   plugin folder (default: plugins/session-hub)
  --out <dir>      output folder (default: tools/hub-preview/out)
  --claude <bin>   claude binary (default: $CLAUDE_BIN, else claude on PATH)
  --widths <list>  body widths in columns (default: 42,76)
  --only <text>    keep the scenarios whose name contains <text>
  --shots          save one PNG per shot (Playwright headless shell, Chrome or Edge; $CHROME_BIN)
  --theme <name>   light (default) or dark, for --shots
  --height <px>    screenshot height for --shots (default: 1100)
  --serve [port]   serve the gallery on 127.0.0.1 (default port 4720)
  --watch          rebuild when the plugin's hooks change (with --serve the page reloads)
`

function parseArgs(argv) {
  const o = { plugin: resolve(HERE, '../../plugins/session-hub'), out: join(HERE, 'out'), claude: process.env.CLAUDE_BIN || 'claude', widths: [42, 76], only: '', shots: false, theme: '', height: 1100, serve: 0, watch: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--plugin') o.plugin = resolve(next())
    else if (a === '--out') o.out = resolve(next())
    else if (a === '--claude') o.claude = next()
    else if (a === '--widths') o.widths = next().split(',').map(Number).filter(n => n > 0)
    else if (a === '--only') o.only = next()
    else if (a === '--shots') o.shots = true
    else if (a === '--theme') o.theme = next()
    else if (a === '--height') o.height = Number(next())
    else if (a === '--serve') o.serve = /^\d+$/.test(argv[i + 1] ?? '') ? Number(next()) : 4720
    else if (a === '--watch') o.watch = true
    else if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE)
      process.exit(0)
    } else throw new Error(`unknown option ${a}\n\n${USAGE}`)
  }
  return o
}

function collect(o) {
  const work = mkdtempSync(join(tmpdir(), 'hub-preview-'))
  try {
    const copy = join(work, 'session-hub')
    for (const part of ['.claude-plugin', 'hooks', 'types', 'sounds']) if (existsSync(join(o.plugin, part))) cpSync(join(o.plugin, part), join(copy, part), { recursive: true })
    mkdirSync(join(copy, 'tests'), { recursive: true })
    const fixtures = readFileSync(join(HERE, 'fixtures.test.tsx'), 'utf8').replace(/const WIDTHS: number\[\] = \[[^\]]*\]/, `const WIDTHS: number[] = [${o.widths.join(', ')}]`)
    writeFileSync(join(copy, 'tests', 'fixtures.test.tsx'), fixtures)
    const viaShell = process.platform === 'win32' && !/\.exe$/i.test(o.claude)
    const options = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
    const run = viaShell ? spawnSync(`"${o.claude}" plugin test "${copy}"`, { ...options, shell: true }) : spawnSync(o.claude, ['plugin', 'test', copy], options)
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    const shots = []
    for (const line of output.split(/\r?\n/)) {
      const at = line.indexOf(MARK)
      if (at < 0) continue
      const shot = JSON.parse(line.slice(at + MARK.length))
      if (!o.only || shot.scenario.includes(o.only)) shots.push(shot)
    }
    const failed = run.status !== 0 ? output.split(/\r?\n/).filter(line => /fail|error|✗|×/i.test(line) && !line.includes(MARK)).slice(0, 40).join('\n') : ''
    return { shots, failed, status: run.status }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function writeGallery(o, result, version) {
  mkdirSync(o.out, { recursive: true })
  writeFileSync(join(o.out, 'trees.json'), JSON.stringify(result.shots, null, 1))
  const page = readFileSync(join(HERE, 'gallery.html'), 'utf8')
    .replace('/*@@DATA@@*/', `window.HUB_SHOTS = ${JSON.stringify(result.shots).replace(/</g, '\\u003c')}; window.HUB_VERSION = ${JSON.stringify(version)}; window.HUB_FAILED = ${JSON.stringify(result.failed)};`)
    .replace('/*@@RENDERER@@*/', readFileSync(join(HERE, 'renderer.js'), 'utf8'))
  writeFileSync(join(o.out, 'index.html'), page)
}

function headlessShells() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'ms-playwright'), join(homedir(), '.cache/ms-playwright'), join(homedir(), 'Library/Caches/ms-playwright')].filter(Boolean)
  const found = []
  for (const root of roots) {
    let names = []
    try {
      names = readdirSync(root).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()
    } catch {
      continue
    }
    for (const name of names) for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) found.push(join(root, name, sub))
  }
  return found
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_BIN,
    ...headlessShells(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  return candidates.find(path => existsSync(path))
}

function takeShots(o, result) {
  const browser = findBrowser()
  if (!browser) throw new Error('no Edge or Chrome found: set CHROME_BIN')
  const dir = join(o.out, 'shots')
  mkdirSync(dir, { recursive: true })
  const profiles = []
  const saved = []
  try {
    for (const shot of result.shots) {
      const id = `${shot.scenario}--${shot.shot}--${shot.columns}`
      const file = join(dir, `${id}${o.theme === 'dark' ? '--dark' : ''}.png`)
      const profile = mkdtempSync(join(tmpdir(), 'hub-preview-browser-'))
      profiles.push(profile)
      const url = `file:///${join(o.out, 'index.html').replace(/\\/g, '/')}?shot=${encodeURIComponent(id)}${o.theme ? `&theme=${o.theme}` : ''}`
      rmSync(file, { force: true })
      spawnSync(browser, [...(/headless-shell/.test(browser) ? [] : ['--headless=new']), '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--force-device-scale-factor=1', `--window-size=${shot.columns * 8 + 60},${o.height}`, `--screenshot=${file}`, url], { encoding: 'utf8', timeout: 60_000 })
      if (existsSync(file)) saved.push(file)
    }
  } finally {
    for (const profile of profiles) {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      } catch {}
    }
  }
  return saved
}

function build(o, version) {
  const started = Date.now()
  const result = collect(o)
  writeGallery(o, result, version)
  const shots = o.shots ? takeShots(o, result) : []
  const took = ((Date.now() - started) / 1000).toFixed(1)
  process.stdout.write(`${result.shots.length} shots from ${new Set(result.shots.map(s => s.scenario)).size} scenarios in ${took}s -> ${join(o.out, 'index.html')}\n`)
  if (shots.length) process.stdout.write(`${shots.length} PNG files -> ${join(o.out, 'shots')}\n`)
  if (result.status !== 0) process.stdout.write(`plugin test exited ${result.status}\n${result.failed}\n`)
}

function serve(o, getVersion) {
  createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/version') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end(String(getVersion()))
      return
    }
    const file = join(o.out, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''))
    if (!file.startsWith(o.out) || !existsSync(file)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(readFileSync(file))
  }).listen(o.serve, '127.0.0.1', () => process.stdout.write(`gallery on http://127.0.0.1:${o.serve}/\n`))
}

const o = parseArgs(process.argv.slice(2))
let version = 1
build(o, version)
if (o.serve) serve(o, () => version)
if (o.watch) {
  let timer
  const rebuild = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      version += 1
      try {
        build(o, version)
      } catch (error) {
        process.stdout.write(`rebuild failed: ${error.message}\n`)
      }
    }, 300)
  }
  watch(join(o.plugin, 'hooks'), rebuild)
  watch(HERE, (_event, name) => {
    if (name && /\.(tsx|js|html)$/.test(name)) rebuild()
  })
}
