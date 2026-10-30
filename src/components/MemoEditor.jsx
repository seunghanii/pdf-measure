import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { htmlToMarkdown, inlineHtml, markdownToHtml, photoHtml, rowsToMarkdown, tableRows, tsvRows } from '../lib/memoMarkdown'

// 메모 글 상자. 쓰는 그 자리에서 마크다운이 바로 적용됩니다 (예: "# " 를 치면 그 줄이 제목으로).
// 라이브러리 없이 브라우저 편집(contentEditable)에 줄 모양 바꾸기만 직접 얹었습니다.
// 크롬의 목록·표 명령은 <p> 안에 목록을 넣거나 표를 깨뜨려서 줄 모양은 직접 바꾸고, 그래서 되돌리기(Ctrl+Z)도 직접 관리합니다.
// 저장은 글(마크다운)로: 부모가 editorRef 로 htmlToMarkdown 해서 가져갑니다.
// 맨 바깥 덩어리는 p, h1~h3, blockquote, ul/ol(li), table, hr, 사진(div.memo-photo) 만 씁니다.

const MEMO_HELP = [
  ['# 제목', '## 소제목', '### 작은 제목'],
  ['- 목록', '1. 번호 목록', '[] 할 일', '> 인용', '--- 구분선'],
  ['**굵게**', '*기울임*', '~~취소선~~', 'Ctrl+B, Ctrl+I'],
  ['엑셀 표 복사 → 붙여넣기 = 표', '표 안에서 Tab = 다음 칸'],
]

const exec = (cmd, value) => document.execCommand(cmd, false, value)
const HISTORY_MAX = 100
const TYPING_GROUP_MS = 1200 // 이 안에 이어 친 글자는 되돌리기 한 번으로

// 커서가 있는 줄: 가장 가까운 문단·제목·인용·목록 항목·표 칸
const LINE_TAGS = /^(P|DIV|H[1-6]|BLOCKQUOTE|LI|TD|TH)$/
function lineAt(editor, node) {
  let n = node?.nodeType === 3 ? node.parentNode : node
  while (n && n !== editor) {
    if (LINE_TAGS.test(n.tagName)) return n
    n = n.parentNode
  }
  return null
}
// 글 상자 바로 아래 덩어리
function topAt(editor, node) {
  let n = node
  while (n && n.parentNode !== editor) n = n.parentNode
  return n
}
const cellAt = (editor, node) => {
  const b = lineAt(editor, node)
  return b && (b.tagName === 'TD' || b.tagName === 'TH') ? b : null
}

// 줄 처음부터 커서까지
function rangeFromStart(line, sel) {
  const r = document.createRange()
  r.setStart(line, 0)
  r.setEnd(sel.focusNode, sel.focusOffset)
  return r
}
const textBefore = (line, sel) => rangeFromStart(line, sel).toString().replace(/\u00a0/g, ' ')

function caretInto(el, atEnd = false) {
  const sel = window.getSelection()
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(!atEnd)
  sel.removeAllRanges()
  sel.addRange(r)
}

const fillEmpty = (el) => {
  if (!el.textContent && !el.querySelector('br,img')) el.innerHTML = '<br>'
}

// 줄 태그 바꾸기 (p ↔ h1 ↔ blockquote). 내용은 그대로 옮김
function retag(line, tag) {
  const n = document.createElement(tag)
  while (line.firstChild) n.appendChild(line.firstChild)
  fillEmpty(n)
  line.replaceWith(n)
  return n
}

// 문단 → 목록 항목 (바로 위·아래가 같은 목록이면 이어 붙임)
function toList(line, tag, task) {
  const li = document.createElement('li')
  if (task != null) li.dataset.task = task
  while (line.firstChild) li.appendChild(line.firstChild)
  fillEmpty(li)
  const prev = line.previousElementSibling
  const next = line.nextElementSibling
  if (prev?.tagName === tag) {
    prev.appendChild(li)
    line.remove()
    if (next?.tagName === tag) {
      while (next.firstChild) prev.appendChild(next.firstChild)
      next.remove()
    }
  } else if (next?.tagName === tag) {
    next.prepend(li)
    line.remove()
  } else {
    const list = document.createElement(tag)
    list.appendChild(li)
    line.replaceWith(list)
  }
  return li
}

// 목록 항목 → 문단 (목록은 그 자리에서 둘로 나뉨)
function listToParagraph(li) {
  const list = li.parentNode
  const p = document.createElement('p')
  while (li.firstChild) p.appendChild(li.firstChild)
  fillEmpty(p)
  const rest = []
  for (let n = li.nextElementSibling; n; n = n.nextElementSibling) rest.push(n)
  list.after(p)
  if (rest.length) {
    const tail = document.createElement(list.tagName)
    rest.forEach((n) => tail.appendChild(n))
    p.after(tail)
  }
  li.remove()
  if (!list.children.length) list.remove()
  return p
}

// ---------- 되돌리기 기록 ----------
function pathOf(root, node) {
  const path = []
  while (node && node !== root) {
    path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node))
    node = node.parentNode
  }
  return node === root ? path : null
}
function nodeAtPath(root, path) {
  let n = root
  for (const i of path) n = n?.childNodes[i]
  return n
}

// ---------- 표 ----------
const gridOf = (table) => [...table.rows].map((tr) => [...tr.cells].map((c) => c.innerHTML))
const posOf = (cell) => [cell.parentNode.rowIndex, cell.cellIndex]

// 표를 칸 내용 배열로 다시 만듦 (첫 줄은 머리줄. thead 는 크롬이 깨뜨리기 쉬워 tbody 하나에 th 로)
function setGrid(table, grid, focus) {
  const cols = Math.max(1, ...grid.map((r) => r.length))
  const tr = (r, tag) => `<tr>${Array.from({ length: cols }, (_, i) => `<${tag}>${r[i] ? r[i] : '<br>'}</${tag}>`).join('')}</tr>`
  table.innerHTML = `<tbody>${tr(grid[0] ?? [], 'th')}${grid
    .slice(1)
    .map((r) => tr(r, 'td'))
    .join('')}</tbody>`
  if (focus) {
    const [r, c] = focus
    const row = table.rows[Math.max(0, Math.min(r, table.rows.length - 1))]
    if (row) caretInto(row.cells[Math.max(0, Math.min(c, row.cells.length - 1))], true)
  }
}

// 맨 끝이 표·구분선·사진이면 그 뒤에 글을 쓸 수 없어서 빈 줄이 필요
const needsLineAfter = (n) => !!n && (n.tagName === 'TABLE' || n.tagName === 'HR' || !!n.dataset?.img)

// apiRef.current.insertPhotos(ids): 커서 자리(없으면 맨 끝)에 사진 넣기
// loadPhoto(id) → Promise<주소>, onOpenPhoto(ids, i): 사진 크게 보기
export default function MemoEditor({ initial, editorRef, apiRef, onEdit, onPasteFiles, loadPhoto, onOpenPhoto, autoFocus }) {
  const [empty, setEmpty] = useState(!String(initial ?? '').trim())
  const [inTable, setInTable] = useState(false)
  const history = useRef({ undo: [], redo: [], typingAt: 0 })

  const snapshot = () => {
    const el = editorRef.current
    const sel = window.getSelection()
    const path = sel.focusNode && el.contains(sel.focusNode) ? pathOf(el, sel.focusNode) : null
    return { html: el.innerHTML, caret: path && { path, offset: sel.focusOffset } }
  }
  // 고치기 직전에 부름. typing: 이어 치는 글자는 묶음
  const record = (typing = false) => {
    const h = history.current
    const now = performance.now()
    if (typing && now - h.typingAt < TYPING_GROUP_MS) {
      h.typingAt = now
      return
    }
    h.typingAt = typing ? now : 0
    h.undo.push(snapshot())
    if (h.undo.length > HISTORY_MAX) h.undo.shift()
    h.redo.length = 0
  }
  // 사진 주소 채우기 (아직 못 불러온 사진은 불러온 뒤에)
  const hydrate = () => {
    for (const box of editorRef.current.querySelectorAll('[data-img]')) {
      const img = box.querySelector('img')
      if (!img || img.getAttribute('src')) continue
      loadPhoto(box.dataset.img).then((url) => {
        if (url) img.src = url
        else img.alt = '사진을 불러오지 못했어요'
      })
    }
  }
  const restore = (s) => {
    const el = editorRef.current
    el.innerHTML = s.html
    hydrate()
    const n = s.caret && nodeAtPath(el, s.caret.path)
    if (n) {
      const r = document.createRange()
      r.setStart(n, Math.min(s.caret.offset, n.nodeType === 3 ? n.length : n.childNodes.length))
      r.collapse(true)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    } else caretInto(el, true)
  }
  const undoRedo = (redo) => {
    const h = history.current
    const from = redo ? h.redo : h.undo
    const to = redo ? h.undo : h.redo
    const s = from.pop()
    if (!s) return
    to.push(snapshot())
    h.typingAt = 0
    restore(s)
    changed()
  }

  useLayoutEffect(() => {
    const el = editorRef.current
    el.innerHTML = markdownToHtml(initial)
    hydrate()
    apiRef.current = {
      insertPhotos: (ids) => {
        const sel = window.getSelection()
        if (!sel.focusNode || !el.contains(sel.focusNode)) caretInto(el, true)
        record()
        insertBlocks(ids.map(photoHtml).join(''))
        changed()
      },
    }
    try {
      exec('defaultParagraphSeparator', 'p')
      exec('styleWithCSS', false)
    } catch {
      // 오래된 브라우저: 기본값으로
    }
    if (autoFocus) {
      el.focus()
      caretInto(el.lastElementChild ?? el, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 브라우저가 고치기 직전 (글자 입력, 지우기, 붙여넣기, Ctrl+B 등) → 되돌리기 기록
  useEffect(() => {
    const el = editorRef.current
    const before = (e) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault()
        undoRedo(e.inputType === 'historyRedo')
        return
      }
      record(e.inputType === 'insertText' || e.inputType === 'insertCompositionText' || e.inputType === 'deleteContentBackward')
    }
    el.addEventListener('beforeinput', before)
    return () => el.removeEventListener('beforeinput', before)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 커서가 표 안에 있는지 (표 버튼을 보여 줄지)
  useEffect(() => {
    const onSel = () => {
      const el = editorRef.current
      const sel = window.getSelection()
      const yes = !!(el && sel.focusNode && el.contains(sel.focusNode) && cellAt(el, sel.focusNode))
      setInTable((cur) => (cur === yes ? cur : yes))
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [editorRef])

  const changed = () => {
    const el = editorRef.current
    // 글 상자가 비거나 맨 끝이 표·구분선이면 글을 이어 쓸 빈 줄을 둠
    if (!el.firstChild) el.innerHTML = '<p><br></p>'
    else if (needsLineAfter(el.lastElementChild)) el.append(Object.assign(document.createElement('p'), { innerHTML: '<br>' }))
    setEmpty(!el.textContent.trim() && !el.querySelector('table,hr,li'))
    onEdit()
  }

  // 줄 맨 앞 기호 + 띄어쓰기 → 그 줄 모양 바꾸기
  const blockRule = (el, sel) => {
    const line = lineAt(el, sel.focusNode)
    if (!line) return
    const before = textBefore(line, sel)
    const tag = line.tagName
    const dropMarker = () => {
      record()
      rangeFromStart(line, sel).deleteContents()
    }
    if (tag === 'LI') {
      if (line.dataset.task === undefined && /^\[[ xX]?\] $/.test(before)) {
        dropMarker()
        line.dataset.task = /x/i.test(before) ? '1' : '0'
        fillEmpty(line)
        caretInto(line)
      }
      return
    }
    if ((tag !== 'P' && tag !== 'DIV') || line.parentNode !== el) return
    let m
    if ((m = /^(#{1,3}) $/.exec(before))) {
      dropMarker()
      caretInto(retag(line, `h${m[1].length}`))
    } else if (/^> $/.test(before)) {
      dropMarker()
      caretInto(retag(line, 'blockquote'))
    } else if ((m = /^(?:[-*+] )?\[([ xX]?)\] $/.exec(before)) || /^[-*+] $/.test(before)) {
      dropMarker()
      caretInto(toList(line, 'UL', m ? (/x/i.test(m[1]) ? '1' : '0') : null))
    } else if (/^\d+[.)] $/.test(before)) {
      dropMarker()
      caretInto(toList(line, 'OL', null))
    }
  }

  // **굵게** *기울임* ~~취소선~~ 를 닫는 기호를 치는 순간 꾸밈으로
  const inlineRule = (sel) => {
    const node = sel.focusNode
    if (node?.nodeType !== 3) return
    const text = node.nodeValue.slice(0, sel.focusOffset)
    const rules = [
      [/\*\*(?=\S)([^*]*?\S)\*\*$/, 'strong', 'bold', 4],
      [/~~(?=\S)([^~]*?\S)~~$/, 's', 'strikeThrough', 4],
      [/(?:^|[^*\\])\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*$/, 'em', 'italic', 2],
    ]
    for (const [re, tag, cmd, marks] of rules) {
      const m = re.exec(text)
      if (!m) continue
      record()
      const r = document.createRange()
      r.setStart(node, sel.focusOffset - m[1].length - marks)
      r.setEnd(node, sel.focusOffset)
      sel.removeAllRanges()
      sel.addRange(r)
      exec('insertHTML', `<${tag}>${inlineHtml(m[1].replace(/([*~\\])/g, '\\$1'))}</${tag}>`)
      // 이어 쓰는 글은 꾸밈 없이
      if (document.queryCommandState(cmd)) exec(cmd)
      history.current.typingAt = 0
      return
    }
  }

  const onInput = (e) => {
    const ne = e.nativeEvent
    const el = editorRef.current
    const sel = window.getSelection()
    if (ne.inputType === 'insertText' && !ne.isComposing && sel.isCollapsed && sel.focusNode) {
      if (ne.data === ' ') blockRule(el, sel)
      else if (ne.data === '*' || ne.data === '~') inlineRule(sel)
    }
    if (ne.inputType === 'insertParagraph') {
      // 할 일에서 Enter: 새 항목은 체크 안 된 상태로
      const li = lineAt(el, sel.focusNode)
      if (li?.tagName === 'LI' && li.dataset.task !== undefined && !li.textContent.trim()) li.dataset.task = '0'
    }
    changed()
  }

  const onKeyDown = (e) => {
    const el = editorRef.current
    const sel = window.getSelection()
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault()
      undoRedo(key === 'y' || e.shiftKey)
      return
    }
    if (mod && key === 'u') {
      e.preventDefault() // 밑줄은 마크다운에 없어서 막음
      return
    }
    if (!sel.focusNode || e.nativeEvent.isComposing) return
    const line = lineAt(el, sel.focusNode)
    const cell = cellAt(el, sel.focusNode)

    if (e.key === 'Tab' && cell) {
      e.preventDefault()
      const table = cell.closest('table')
      const cells = [...table.querySelectorAll('th,td')]
      const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1)
      if (i >= cells.length) editTable((g, [r]) => (g.splice(r + 1, 0, []), [r + 1, 0]))
      else if (i >= 0) caretInto(cells[i], true)
      return
    }
    if (e.key === 'Enter' && cell) {
      e.preventDefault()
      record()
      exec('insertLineBreak')
      return
    }
    if (e.key === 'Enter' && line) {
      const t = line.tagName
      const text = line.textContent.replace(/\u00a0/g, ' ')
      // --- 치고 Enter → 구분선
      if (t === 'P' && line.parentNode === el && /^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        e.preventDefault()
        record()
        const hr = document.createElement('hr')
        const p = document.createElement('p')
        p.innerHTML = '<br>'
        line.replaceWith(hr)
        hr.after(p)
        caretInto(p)
        changed()
        return
      }
      // 빈 제목·인용·목록 항목에서 Enter → 일반 줄로
      if (/^(H[1-6]|BLOCKQUOTE|LI)$/.test(t) && !text.trim() && !line.querySelector('img')) {
        e.preventDefault()
        record()
        caretInto(t === 'LI' ? listToParagraph(line) : retag(line, 'p'))
        changed()
        return
      }
      if (e.shiftKey) {
        // 메모는 한 줄 = 한 덩어리라서 Shift+Enter 도 새 줄
        e.preventDefault()
        record()
        exec('insertParagraph')
        return
      }
    }
    if (e.key === 'Backspace' && sel.isCollapsed && line && !cell && textBefore(line, sel) === '') {
      const t = line.tagName
      // 줄 맨 앞에서 지우기 → 제목·인용·목록을 일반 줄로 (할 일은 먼저 네모만 뺌)
      if (/^(H[1-6]|BLOCKQUOTE|LI)$/.test(t)) {
        e.preventDefault()
        record()
        if (t === 'LI' && line.dataset.task !== undefined) delete line.dataset.task
        else caretInto(t === 'LI' ? listToParagraph(line) : retag(line, 'p'))
        changed()
      }
    }
  }

  // 할 일 네모 누르기, 사진 누르기(크게 보기)·빼기
  const onClick = (e) => {
    const photo = e.target.closest?.('[data-img]')
    if (photo) {
      e.preventDefault()
      if (e.target.closest('[data-del]')) {
        record()
        const next = photo.nextElementSibling
        photo.remove()
        if (next) caretInto(next)
        changed()
      } else {
        const ids = [...editorRef.current.querySelectorAll('[data-img]')].map((b) => b.dataset.img)
        onOpenPhoto(ids, ids.indexOf(photo.dataset.img))
      }
      return
    }
    const li = e.target.closest?.('li[data-task]')
    if (!li) return
    const r = li.getBoundingClientRect()
    if (e.clientX - r.left > 22) return
    e.preventDefault()
    record()
    li.dataset.task = li.dataset.task === '1' ? '0' : '1'
    changed()
  }

  // ---------- 붙여넣기 ----------

  // 여러 줄 덩어리(HTML)를 커서 자리에 넣음. 줄 가운데면 그 줄을 둘로 나눔
  const insertBlocks = (html) => {
    const el = editorRef.current
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const frag = tpl.content
    // markdownToHtml 이 끝에 붙이는 빈 줄은 빼고, 필요하면 아래에서 다시 붙임
    if (frag.lastChild?.tagName === 'P' && !frag.lastChild.textContent && frag.childNodes.length > 1) frag.lastChild.remove()
    const nodes = [...frag.childNodes]
    if (!nodes.length) return
    const sel = window.getSelection()
    if (!sel.isCollapsed) sel.deleteFromDocument()
    const top = sel.focusNode && el.contains(sel.focusNode) ? topAt(el, sel.focusNode) : null
    let rest = null // 줄 가운데에 넣어 둘로 나뉜 뒷부분
    if (!top || top === el) el.append(frag)
    else if (/^(P|H[1-6]|BLOCKQUOTE|DIV)$/.test(top.tagName)) {
      const r = document.createRange()
      r.setStart(sel.focusNode, sel.focusOffset)
      r.setEnd(top, top.childNodes.length)
      const tail = r.extractContents()
      if (tail.textContent) {
        rest = top.cloneNode(false)
        rest.append(tail)
        top.after(rest)
      }
      if (!top.textContent && !top.querySelector('img')) top.replaceWith(frag)
      else top.after(frag)
    } else top.after(frag)
    hydrate()
    const last = nodes[nodes.length - 1]
    if (needsLineAfter(last)) {
      // 그 아래에 이어 쓸 줄: 나뉜 뒷부분이나 빈 줄이 있으면 거기, 없으면 새 빈 줄
      let next = last.nextElementSibling
      if (!(next && (next === rest || (next.tagName === 'P' && !next.textContent)))) {
        next = document.createElement('p')
        next.innerHTML = '<br>'
        last.after(next)
      }
      caretInto(next)
    } else caretInto(last, true)
  }

  // 표 칸 안에 표를 붙여넣으면 그 칸부터 채움 (모자란 줄·칸은 늘림)
  const fillTable = (cell, rows) => {
    const table = cell.closest('table')
    const grid = gridOf(table)
    const [r0, c0] = posOf(cell)
    rows.forEach((row, dr) => {
      row.forEach((v, dc) => {
        const r = r0 + dr
        while (grid.length <= r) grid.push([])
        grid[r][c0 + dc] = v ? inlineHtml(v) : ''
      })
    })
    setGrid(table, grid, [r0 + rows.length - 1, c0 + Math.max(...rows.map((x) => x.length)) - 1])
  }

  const onPaste = (e) => {
    const cd = e.clipboardData
    if (!cd) return
    const files = [...(cd.files ?? [])].filter((f) => f.type.startsWith('image/'))
    const html = cd.getData('text/html')
    const plain = cd.getData('text/plain')
    // 사진만 복사한 경우 (엑셀은 표와 함께 그림도 주므로 표가 있으면 표가 먼저)
    if (files.length && !/<table/i.test(html)) {
      e.preventDefault()
      onPasteFiles(files)
      return
    }
    e.preventDefault()
    const el = editorRef.current
    const cell = cellAt(el, window.getSelection().focusNode)
    let rows = null
    let md = null
    if (/<table/i.test(html) || (html && /<(p|div|h[1-6]|li|br|strong|b|em|i)[\s>]/i.test(html))) {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const tables = doc.body.querySelectorAll('table')
      if (tables.length === 1 && !doc.body.textContent.replace(tables[0].textContent, '').trim()) {
        // 표만 복사 (엑셀, 구글 시트, 웹의 표)
        rows = tableRows(tables[0]).filter((r) => r.length)
      } else md = htmlToMarkdown(doc.body)
    } else if (/\t/.test(plain)) rows = tsvRows(plain)
    else md = plain.replace(/\r\n?/g, '\n')

    if (rows && rows.length === 1 && rows[0].length === 1) {
      md = rows[0][0].replace(/<br>/g, ' ')
      rows = null
    }
    if (!rows && !md) return
    record()
    if (rows) {
      if (cell) fillTable(cell, rows)
      else insertBlocks(markdownToHtml(rowsToMarkdown(rows).join('\n')))
    } else if (cell) exec('insertText', md.replace(/\n+/g, ' '))
    else {
      const lines = md.replace(/\n+$/, '').split('\n')
      // 한 줄짜리는 줄 안에 그대로 (굵게 등 꾸밈은 살림), 여러 줄은 덩어리로
      if (lines.length === 1 && !/^(#{1,3} |[-*+] |\d+[.)] |> |\|)/.test(lines[0])) exec('insertHTML', inlineHtml(lines[0]))
      else insertBlocks(markdownToHtml(lines.join('\n')))
    }
    history.current.typingAt = 0
    changed()
  }

  // ---------- 표 버튼 ----------
  const editTable = (fn) => {
    const el = editorRef.current
    const cell = cellAt(el, window.getSelection().focusNode)
    if (!cell) return
    record()
    const table = cell.closest('table')
    const grid = gridOf(table)
    const focus = fn(grid, posOf(cell), table)
    if (focus !== 'removed') setGrid(table, grid, focus)
    changed()
  }
  const removeTable = (table) => {
    const p = document.createElement('p')
    p.innerHTML = '<br>'
    table.replaceWith(p)
    caretInto(p)
    return 'removed'
  }
  const tableButtons = [
    ['줄 추가', () => editTable((g, [r, c]) => (g.splice(r + 1, 0, []), [r + 1, c]))],
    ['칸 추가', () => editTable((g, [r, c]) => (g.forEach((row) => row.splice(c + 1, 0, '')), [r, c + 1]))],
    ['줄 지우기', () => editTable((g, [r, c], table) => (g.length > 1 ? (g.splice(r, 1), [Math.min(r, g.length - 1), c]) : removeTable(table)))],
    ['칸 지우기', () => editTable((g, [r, c], table) => (Math.max(...g.map((row) => row.length)) > 1 ? (g.forEach((row) => row.splice(c, 1)), [r, Math.max(0, c - 1)]) : removeTable(table)))],
    ['표 지우기', () => editTable((g, p, table) => removeTable(table))],
  ]

  return (
    <div className="relative">
      {empty && (
        <div className="pointer-events-none absolute top-3 right-4 left-4 text-sm leading-relaxed text-ink-400">
          메모를 적어 주세요. "# " 제목, "- " 목록처럼 바로 꾸며지고, 엑셀 표는 붙여넣으면 표가 돼요.
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="메모 내용"
        spellCheck={false}
        className="memo-doc min-h-24 px-4 py-3 outline-none"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onPaste={onPaste}
      />
      {inTable && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-1 bg-white/90 px-3 py-1.5 text-xs">
          {tableButtons.map(([label, fn]) => (
            <button
              key={label}
              onMouseDown={(e) => {
                e.preventDefault() // 커서를 표 안에 둔 채로
                fn()
              }}
              className="rounded-md bg-white px-2 py-0.5 text-ink-600 shadow-xs ring-1 ring-ink-200 hover:bg-ink-100"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 꾸미기 도움말 (메모장 아래 줄의 ? 버튼)
export function MemoHelp() {
  const [help, setHelp] = useState(false)
  return (
    <div className="relative">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setHelp((v) => !v)}
        aria-pressed={help}
        aria-label="메모 꾸미기 도움말"
        title="메모 꾸미기 도움말"
        className={`flex h-6 w-6 items-center justify-center rounded-full text-ink-500 ring-1 ring-ink-200 ${help ? 'bg-ink-800 text-white' : 'bg-white hover:bg-ink-100'}`}
      >
        ?
      </button>
      {help && (
        <div className="absolute bottom-8 left-0 z-10 w-64 rounded-lg bg-white p-3 text-xs text-ink-600 shadow-lg ring-1 ring-ink-200">
          <div className="mb-1.5 font-semibold text-ink-800">쓰면서 바로 꾸미기</div>
          {MEMO_HELP.map((row, i) => (
            <div key={i} className="mb-1 flex flex-wrap gap-1">
              {row.map((s) => (
                <code key={s} className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700">
                  {s}
                </code>
              ))}
            </div>
          ))}
          <div className="mt-1.5 text-ink-500">줄 맨 앞에서 지우기(Backspace)를 누르면 일반 글로 돌아가요.</div>
        </div>
      )}
    </div>
  )
}
