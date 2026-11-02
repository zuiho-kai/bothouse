import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true })
}
const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { TaskBoard } = await vite.ssrLoadModule('/src/client/TaskBoard.tsx')
  const { zh } = await vite.ssrLoadModule('/src/client/locales.ts')
  const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key])
  const root = createRoot(document.getElementById('root'))
  const rooms = [{ id: 1, name: '工作频道', kind: 'chat' }]
  const base = { id: 91, room_id: 1, parent_task: null, title: '美化任务卡', owner: 'sol', owner_name: 'Sol',
    created_by: 'owner', created_by_name: '用户', status: 'accepted', next_check_at: null,
    assign_msg_id: 5, result_msg_id: null, note: null, created_at: Date.now() / 1000 - 1800,
    updated_at: Date.now() / 1000, returned_at: null }
  const file = { id: 1, attachment_id: 'example', url: '/collab/api/attachments/example',
    role: 'deliverable', name: 'result.txt', label: null, mime: 'text/plain', size: 5 }
  const css = await readFile(resolve('lib/style.css'), 'utf8')
  for (const [name, files] of [['empty', []], ['with-file', [file]]]) {
    await act(async () => { root.render(createElement(TaskBoard, { tasks: [{ ...base, files }], rooms, chatId: 1, roomId: 1, t, onOpen() {}, onListFiles: async () => ({ files, candidates: [] }), onAttachFile: async () => {} })) })
    await act(async () => { document.querySelector('button[aria-haspopup="dialog"]').click() })
    const card = document.querySelector('[data-task-id="91"]')
    if (!card || !!card.querySelector('[aria-label="交付文件"]') !== !!files.length) throw new Error(`Unexpected ${name} card markup`)
    const markup = card.outerHTML.replace(/_([a-zA-Z]+)_1nq3o_\d+/g, 'dshc_$1')
    const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>${css}\nbody{margin:0;padding:32px;background:#f5f5f5;color:#222;font:14px sans-serif}.preview{width:440px}.preview ul{padding:0;list-style:none;grid-template-columns:minmax(0,1fr)}</style><div class="preview"><ul class="dshc_boardCardGrid">${markup}</ul></div></html>`
    await writeFile(resolve(`task-board-${name}.html`), html)
  }
  root.unmount()
} finally {
  await vite.close()
  dom.window.close()
}
