/**
 * 书签操作。只依赖传进来的 bookmarks API，所以能在 Node 里用假的 API 直接测。
 *
 * 路径约定：folder path 是文件夹名数组。第一段如果是顶层文件夹（书签栏、其他书签），
 * 就从它开始；写成 '@bar' 表示书签栏（不依赖浏览器语言）；都不是就当作书签栏下面的子文件夹。
 */
export const VERSION = '0.1.0'
const MAX_BATCH = 200
const MAX_LIST = 20000

const isWeb = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
const same = (a, b) => a.replace(/\/$/, '').toLowerCase() === b.replace(/\/$/, '').toLowerCase()

async function roots(bm) {
  const [root] = await bm.getTree()
  return root.children ?? []
}

async function listAll(bm) {
  const items = []
  const folders = []
  const visit = (node, path) => {
    if (node.url) {
      if (items.length < MAX_LIST) items.push({ id: node.id, title: node.title, url: node.url, path, parentId: node.parentId, added: node.dateAdded })
      return
    }
    folders.push({ id: node.id, title: node.title, path, count: node.children?.length ?? 0 })
    for (const child of node.children ?? []) visit(child, child.url ? path : [...path, child.title])
  }
  for (const top of await roots(bm)) visit(top, [top.title])
  return { items, folders }
}

/** 找到（必要时创建）路径对应的文件夹，返回它的 id。 */
async function folderId(bm, path, create) {
  const tops = await roots(bm)
  let node
  let rest = path
  if (path[0] === '@bar') {
    node = tops[0]
    rest = path.slice(1)
  } else {
    node = tops.find((t) => t.title === path[0])
    if (node) rest = path.slice(1)
    else node = tops[0]
  }
  for (const name of rest) {
    const children = await bm.getChildren(node.id)
    let next = children.find((c) => !c.url && c.title === name)
    if (!next) {
      if (!create) return null
      next = await bm.create({ parentId: node.id, title: name })
    }
    node = next
  }
  return node.id
}

const clean = (path) => (Array.isArray(path) ? path.map((s) => String(s).trim()).filter(Boolean) : [])

export const ops = {
  ping: async () => ({ version: VERSION }),

  list: async (bm) => listAll(bm),

  create: async (bm, { items }) => {
    const todo = (Array.isArray(items) ? items : []).slice(0, MAX_BATCH)
    const created = []
    const skipped = []
    const cache = new Map()
    for (const item of todo) {
      if (!isWeb(item.url)) {
        skipped.push(`${item.url}（地址无效）`)
        continue
      }
      const path = clean(item.path)
      const key = path.join('\u0000')
      const id = await folderId(bm, path.length ? path : ['@bar'], true)
      if (!cache.has(key)) cache.set(key, (await bm.getChildren(id)).filter((c) => c.url).map((c) => c.url))
      const known = cache.get(key)
      if (known.some((u) => same(u, item.url))) {
        skipped.push(`${item.url}（该文件夹里已有）`)
        continue
      }
      const node = await bm.create({ parentId: id, title: String(item.title || item.url), url: item.url })
      known.push(item.url)
      created.push(node.id)
    }
    return { created: created.length, skipped }
  },

  update: async (bm, { id, title, url }) => {
    const patch = {}
    if (typeof title === 'string') patch.title = title
    if (typeof url === 'string') {
      if (!isWeb(url)) throw new Error(`地址无效：${url}`)
      patch.url = url
    }
    await bm.update(String(id), patch)
    return {}
  },

  move: async (bm, { ids, path }) => {
    const target = await folderId(bm, clean(path).length ? clean(path) : ['@bar'], true)
    let moved = 0
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, MAX_BATCH)) {
      try {
        await bm.move(String(id), { parentId: target })
        moved += 1
      } catch {
        /* id 不存在就跳过 */
      }
    }
    return { moved }
  },

  /** 只删书签，不删文件夹：删文件夹会连带里面的全部内容，风险太大，不提供。 */
  remove: async (bm, { ids }) => {
    let removed = 0
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, MAX_BATCH)) {
      try {
        const [node] = await bm.get(String(id))
        if (node?.url) {
          await bm.remove(String(id))
          removed += 1
        }
      } catch {
        /* 不存在就跳过 */
      }
    }
    return { removed }
  },
}

export async function handle(bm, op, args) {
  const run = ops[op]
  if (!run) throw new Error(`不支持的操作：${op}`)
  return run(bm, args ?? {})
}
