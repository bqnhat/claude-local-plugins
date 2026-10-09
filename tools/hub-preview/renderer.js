const HUB_CELL = 8
const HUB_LINE = 19
const HUB_THEME_KEYS = {
  text: 'var(--text)',
  inverseText: 'var(--bg)',
  inactive: 'var(--dim)',
  subtle: 'var(--dim)',
  suggestion: 'var(--blue)',
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',
  claude: 'var(--claude)',
  permission: 'var(--blue)',
}

function hubColor(value) {
  if (typeof value !== 'string') return undefined
  return HUB_THEME_KEYS[value] ?? value
}

function hubSize(value) {
  if (value === undefined || value === null) return undefined
  return typeof value === 'number' ? `${value * HUB_CELL}px` : String(value)
}

function hubText(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(hubText).join('')
  return hubText(node.children)
}

function hubChildren(node) {
  const list = node.children === undefined ? [] : Array.isArray(node.children) ? node.children : [node.children]
  return list.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== '')
}

function hubBoxStyle(el, p) {
  const s = el.style
  s.display = p.display === 'none' ? 'none' : 'flex'
  s.flexDirection = p.flexDirection ?? 'row'
  if (p.flexGrow !== undefined) s.flexGrow = String(p.flexGrow)
  if (p.flexShrink !== undefined) s.flexShrink = String(p.flexShrink)
  if (p.flexWrap) s.flexWrap = p.flexWrap
  if (p.alignItems) s.alignItems = p.alignItems
  if (p.alignSelf && p.alignSelf !== 'auto') s.alignSelf = p.alignSelf
  if (p.justifyContent) s.justifyContent = p.justifyContent
  if (p.gap !== undefined) s.gap = hubSize(p.gap)
  if (p.columnGap !== undefined) s.columnGap = hubSize(p.columnGap)
  if (p.rowGap !== undefined) s.rowGap = hubSize(p.rowGap)
  for (const k of ['width', 'height', 'minWidth', 'minHeight']) if (p[k] !== undefined) s[k] = hubSize(p[k])
  const sides = { Top: 'Top', Bottom: 'Bottom', Left: 'Left', Right: 'Right' }
  for (const kind of ['margin', 'padding']) {
    const all = p[kind]
    const x = p[`${kind}X`]
    const y = p[`${kind}Y`]
    for (const side of Object.keys(sides)) {
      const own = p[`${kind}${side}`]
      const axis = side === 'Top' || side === 'Bottom' ? y : x
      const v = own ?? axis ?? all
      if (v !== undefined) s[`${kind}${side}`] = hubSize(v)
    }
  }
  if (p.position) s.position = p.position
  for (const k of ['top', 'left', 'right', 'bottom']) if (p[k] !== undefined) s[k] = hubSize(p[k])
  if (p.backgroundColor) s.backgroundColor = hubColor(p.backgroundColor)
  if (p.overflow) s.overflow = p.overflow
  if (p.borderStyle) {
    s.border = `1px solid ${hubColor(p.borderColor) ?? 'var(--border)'}`
    s.borderRadius = p.borderStyle === 'round' ? '8px' : '3px'
    if (p.padding === undefined && p.paddingX === undefined && p.paddingLeft === undefined) {
      s.paddingLeft = '12px'
      s.paddingRight = '12px'
    }
    if (p.padding === undefined && p.paddingY === undefined && p.paddingTop === undefined) {
      s.paddingTop = '8px'
      s.paddingBottom = '8px'
    }
  }
}

function hubTextStyle(el, p, inherited) {
  const s = el.style
  const color = hubColor(p.color)
  if (color) s.color = color
  else if (p.dimColor) s.color = 'var(--dim)'
  if (p.backgroundColor) s.backgroundColor = hubColor(p.backgroundColor)
  if (p.bold) s.fontWeight = '600'
  if (p.italic) s.fontStyle = 'italic'
  const lines = [p.underline ? 'underline' : '', p.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')
  if (lines) s.textDecoration = lines
  if (p.inverse) {
    s.color = 'var(--bg)'
    s.backgroundColor = 'var(--text)'
  }
  const wrap = p.wrap ?? inherited ?? 'wrap'
  if (wrap === 'wrap') {
    s.whiteSpace = 'pre-wrap'
    s.overflowWrap = 'anywhere'
  } else {
    s.whiteSpace = 'pre'
    s.overflow = 'hidden'
    s.textOverflow = 'ellipsis'
    s.minWidth = '0'
  }
}

function hubRender(node, parentIsText) {
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node))
  if (Array.isArray(node)) {
    const frag = document.createDocumentFragment()
    for (const child of node) {
      const out = hubRender(child, parentIsText)
      if (out) frag.appendChild(out)
    }
    return frag
  }
  if (!node || typeof node !== 'object') return null
  const p = node.props ?? {}
  const kids = hubChildren(node)
  const tag = (name, cls) => {
    const el = document.createElement(name)
    el.className = cls
    if (p.key) el.dataset.key = p.key
    return el
  }
  switch (node.type) {
    case 'Fragment': {
      const frag = document.createDocumentFragment()
      for (const child of kids) {
        const out = hubRender(child, parentIsText)
        if (out) frag.appendChild(out)
      }
      return frag
    }
    case 'Box': {
      const el = tag('div', 'hub-box')
      hubBoxStyle(el, p)
      for (const child of kids) {
        const out = hubRender(child, false)
        if (out) el.appendChild(out)
      }
      return el
    }
    case 'Text': {
      const el = tag(parentIsText ? 'span' : 'div', 'hub-text')
      hubTextStyle(el, p)
      for (const child of kids) {
        const out = hubRender(child, true)
        if (out) el.appendChild(out)
      }
      return el
    }
    case 'Button': {
      const el = tag('button', p.plain ? 'hub-button plain' : `hub-button native ${p.variant ?? ''}`)
      el.type = 'button'
      el.textContent = p.label ?? hubText(kids)
      if (p.dimColor) el.classList.add('dim')
      el.title = node.press ? `press: ${p.key ?? p.label}` : ''
      return el
    }
    case 'Svg': {
      const el = tag('img', 'hub-svg')
      el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.source ?? '')}`
      el.alt = p.alt ?? ''
      el.title = p.alt ?? ''
      if (p.width !== undefined) el.width = p.width
      if (p.height !== undefined) el.height = p.height
      if (p.width !== undefined) el.style.width = `${p.width}px`
      if (p.height !== undefined) el.style.height = `${p.height}px`
      return el
    }
    case 'Link': {
      const el = tag('a', 'hub-link')
      el.textContent = p.label ?? hubText(kids) ?? p.url
      el.href = '#'
      return el
    }
    case 'Code': {
      const el = tag('pre', 'hub-code')
      el.textContent = p.code ?? p.source ?? hubText(kids)
      return el
    }
    case 'Markdown': {
      const el = tag('div', 'hub-markdown')
      el.textContent = p.source ?? p.markdown ?? hubText(kids)
      return el
    }
    default: {
      const el = tag('div', 'hub-unknown')
      el.textContent = `[${node.type}]`
      return el
    }
  }
}

function hubPane(shot) {
  const frame = document.createElement('section')
  frame.className = 'hub-pane'
  frame.style.width = `${shot.columns * HUB_CELL + 2 * HUB_CELL + 2}px`
  frame.dataset.shot = `${shot.scenario}--${shot.shot}--${shot.columns}`
  const head = document.createElement('header')
  head.className = 'hub-pane-head'
  head.innerHTML = '<span>Mod status</span><span class="hub-pane-tools">⤢&nbsp;&nbsp;✕</span>'
  const body = document.createElement('div')
  body.className = 'hub-pane-body'
  const out = hubRender(shot.tree, false)
  if (out) body.appendChild(out)
  frame.appendChild(head)
  frame.appendChild(body)
  return frame
}
