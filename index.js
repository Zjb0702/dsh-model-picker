// 模型选择器 —— Host 半边。
//
// 这个插件是纯 UI 插件：选择器的界面与选择动作全在浏览器半边，模型目录和
// 回填仍走客户端已有的 remote 面（ctx.remote.session.modelCatalog /
// selectModel）。Host 这半边只负责一件浏览器做不到的事——把「用户偏好」
// 落到磁盘：
//
//   1. 思考档位记忆：按「供应商 + 模型」记住用户上次显式选中的档位；
//   2. 供应商顺序：记住左侧供应商栏的顺序。
//
// 宿主自己的会话投影（modelSelection）只保存“当前这一次选择”（provider /
// model / reasoningEffort 一个组合），不会按模型分别记录档位；所以档位
// 记忆必须由插件自己持久化，并且放在宿主进程侧，才能跨页面重载与 App
// 重启生效（浏览器 localStorage 绑定在端口上，DSH 每次启动端口会变）。
//
// 存储位置：$DSH_HOME/model-picker/state.json
//   （默认 ~/.dsh/model-picker/state.json；可用环境变量 DSH_HOME 改根目录）
// 读写接口：同源回环路由，只有本机浏览器页面能用：
//   GET  /api/dsh-model-picker/state       读取
//   PUT  /api/dsh-model-picker/state/save  合并写入（providerOrder / effort）
//
// 向后兼容：state.json 允许旧格式（见 normalizeState 的注释），读取时
// 自动归一成当前版本；无法解析的文件会先改名留档，再从空状态开始。
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const ROUTE_BASE = '/api/dsh-model-picker'
// 当前磁盘格式版本。v2 = { version, providerOrder: string[], efforts: [{ provider, model, effort }] }。
const STATE_VERSION = 2
const MAX_PROVIDERS = 200
const MAX_EFFORTS = 1000
const MAX_ID_LENGTH = 200
const MAX_BODY_BYTES = 64 * 1024

export const inject = ['webServer']

function resolveDshHome() {
  const home = process.env.DSH_HOME
  return typeof home === 'string' && home.trim() !== '' ? home : path.join(homedir(), '.dsh')
}

function sanitizeId(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || text.length > MAX_ID_LENGTH) return undefined
  return text
}

function sanitizeOrder(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const id = sanitizeId(value)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_PROVIDERS) break
  }
  return out
}

function sanitizeEffortRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return undefined
  const provider = sanitizeId(record.provider)
  const model = sanitizeId(record.model)
  const effort = sanitizeId(record.effort)
  if (provider === undefined || model === undefined || effort === undefined) return undefined
  return { provider, model, effort }
}

function effortKey(record) {
  return `${record.provider}\u0000${record.model}`
}

// 旧格式的键形如 "provider::model"（也兼容手写的 "provider:model"，模型名里
// 一般没有冒号；若两边都有冒号则按第一个冒号切开）。
function splitLegacyKey(key) {
  const at = key.indexOf(':')
  if (at <= 0 || at === key.length - 1) return undefined
  return [key.slice(0, at), key.slice(at + 1)]
}

function normalizeEfforts(input) {
  const out = []
  const index = new Map()
  const add = (record) => {
    const clean = sanitizeEffortRecord(record)
    if (clean === undefined) return
    const key = effortKey(clean)
    const at = index.get(key)
    if (at !== undefined) {
      out[at] = clean
      return
    }
    index.set(key, out.length)
    out.push(clean)
  }

  // 单条记录：{ provider, model, effort }
  if (input !== null && typeof input === 'object' && !Array.isArray(input)
    && typeof input.provider === 'string' && typeof input.model === 'string' && typeof input.effort === 'string') {
    add(input)
    return out
  }

  if (Array.isArray(input)) {
    for (const record of input) add(record)
    return out.slice(0, MAX_EFFORTS)
  }

  if (input !== null && typeof input === 'object') {
    for (const [key, effort] of Object.entries(input)) {
      if (typeof effort !== 'string') continue
      const parts = key.includes('::') ? key.split('::') : splitLegacyKey(key)
      if (parts === undefined || parts.length !== 2) continue
      add({ provider: parts[0], model: parts[1], effort })
    }
  }
  return out.slice(0, MAX_EFFORTS)
}

/**
 * 把任意（可能是旧版本的）磁盘内容归一成当前状态。
 *
 * 旧格式兼容点：
 *   - providerOrder 也接受别名顺序字段 order / providers；
 *   - efforts 也接受 reasoningEfforts / effortByModel（map 形式）或单条记录；
 *   - 数组形式的记录项必须是字符串字段，非法项直接跳过而不是让整份文件失效。
 */
export function normalizeState(raw) {
  const state = { version: STATE_VERSION, providerOrder: [], efforts: [] }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return state
  const order = raw.providerOrder ?? raw.order ?? raw.providers
  if (Array.isArray(order)) state.providerOrder = sanitizeOrder(order)
  state.efforts = normalizeEfforts(raw.efforts ?? raw.reasoningEfforts ?? raw.effortByModel ?? raw.effort)
  return state
}

function cloneState(state) {
  return {
    version: state.version,
    providerOrder: [...state.providerOrder],
    efforts: state.efforts.map((record) => ({ ...record })),
  }
}

function applyPatch(state, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('request body must be a JSON object')
  }
  if (Array.isArray(patch.providerOrder)) {
    state.providerOrder = sanitizeOrder(patch.providerOrder)
  }
  if (Array.isArray(patch.efforts)) {
    for (const record of patch.efforts) {
      upsertEffort(state, sanitizeEffortRecord(record))
    }
  }
  if (patch.effort !== undefined) {
    upsertEffort(state, sanitizeEffortRecord(patch.effort))
  }
}

function upsertEffort(state, record) {
  if (record === undefined) return
  const key = effortKey(record)
  const at = state.efforts.findIndex((entry) => effortKey(entry) === key)
  if (at >= 0) state.efforts[at] = record
  else if (state.efforts.length < MAX_EFFORTS) state.efforts.push(record)
}

async function writeAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/**
 * 状态仓库：惰性读取、串行写入、损坏文件留档。
 * `options.dir` 预留给测试，生产路径是 $DSH_HOME/model-picker。
 */
export function createStateStore(options = {}) {
  const dir = options.dir ?? path.join(resolveDshHome(), 'model-picker')
  const file = path.join(dir, 'state.json')
  let state = null
  let loading = null
  let queue = Promise.resolve()

  async function ensure() {
    if (state !== null) return state
    if (loading !== null) return loading
    loading = (async () => {
      let raw = null
      let readable = true
      try {
        raw = JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          readable = false
          await rename(file, `${file}.bad-${Date.now()}`).catch(() => {})
        }
      }
      const normalized = normalizeState(raw)
      state = normalized
      // 旧格式第一次读到就顺手迁移成规范形状；损坏文件已经留档，这里直接重建。
      const migrated = raw !== null && JSON.stringify(normalized) !== JSON.stringify(raw)
      if (migrated || !readable) {
        await writeAtomic(file, normalized).catch(() => {})
      }
      return state
    })().finally(() => {
      loading = null
    })
    return loading
  }

  async function read() {
    return cloneState(await ensure())
  }

  function update(patch) {
    const run = queue.then(async () => {
      await ensure()
      applyPatch(state, patch)
      await writeAtomic(file, state)
      return cloneState(state)
    })
    queue = run.catch(() => {})
    return run
  }

  return { read, update, dir, file }
}

function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? ''
  return address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed
}

export function makeRoutes(store, ctx) {
  // 组合层的 connection 服务负责鉴权（Host/Origin 围栏 + 登录 token）；
  // 本机回环判定作为第二道防线。与 dsh-artifact-vault 的做法保持一致。
  const connection = ctx?.connection ?? (typeof ctx?.get === 'function' ? ctx.get('connection', false) : undefined)
  const requestRejection = typeof connection?.requestRejection === 'function'
    ? (req) => connection.requestRejection(req)
    : () => undefined

  const guard = (req, res, method) => {
    const rejection = requestRejection(req)
    if (rejection !== undefined) {
      writeJson(res, Number(rejection) || 403, { error: 'forbidden: untrusted or unauthenticated request' })
      return false
    }
    if (!isLoopback(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  return [
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/state`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, { ok: true, state: await store.read() })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: { code: 'state/read', message: String(error?.message ?? error) } })
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/state/save`,
      handler: async (req, res) => {
        if (!guard(req, res, 'PUT')) return
        try {
          const body = await readBody(req)
          writeJson(res, 200, { ok: true, state: await store.update(body) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: { code: 'state/write', message: String(error?.message ?? error) } })
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/health`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, version: STATE_VERSION, file: store.file })
      },
    },
  ]
}

export function apply(ctx) {
  const store = createStateStore()
  const routes = makeRoutes(store, ctx)
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already released */
        }
      }
    }
  }, 'model-picker: state routes')
}

/** 测试接缝：不依赖 Cordis 图也能构造仓库、注册路由、跑归一化。 */
export const __internals = { createStateStore, makeRoutes, normalizeState, ROUTE_BASE, STATE_VERSION }