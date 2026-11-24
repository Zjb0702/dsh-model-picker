// 偏好存储（Host 半边）的单元测试：归一化 / 迁移 / 原子写 / 回环路由。
// 运行：node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { apply, __internals } from '../index.js'

const { createStateStore, makeRoutes, normalizeState, STATE_VERSION, ROUTE_BASE } = __internals

function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'model-picker-test-'))
}

// 请求体按真实的流式请求模拟：路由里用的是 `for await (const chunk of req)`。
function fakeReq(options = {}) {
  const req = new PassThrough()
  req.method = options.method ?? 'GET'
  req.url = options.url ?? '/'
  req.socket = { remoteAddress: options.remote ?? '127.0.0.1' }
  req.headers = {}
  req.rawBody = options.rawBody
  return req
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '', done: false }
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers ?? {}
  }
  res.write = (chunk) => { res.body += chunk }
  res.end = (chunk) => {
    if (chunk !== undefined) res.body += chunk
    res.done = true
  }
  return res
}

async function call(route, req, res) {
  const pending = route.handler(req, res)
  if (req.rawBody !== undefined) req.write(req.rawBody)
  req.end()
  await pending
  return JSON.parse(res.body)
}

test('normalizeState：旧格式 map + 别名字段都能读取成当前结构', () => {
  const legacy = {
    version: 1,
    order: ['prov-a', 'prov-b'],
    reasoningEfforts: {
      'prov-a::model-a': 'high',
      'prov-b:model-b': 'low',
    },
  }
  const state = normalizeState(legacy)
  assert.equal(state.version, STATE_VERSION)
  assert.deepEqual(state.providerOrder, ['prov-a', 'prov-b'])
  assert.deepEqual(state.efforts, [
    { provider: 'prov-a', model: 'model-a', effort: 'high' },
    { provider: 'prov-b', model: 'model-b', effort: 'low' },
  ])
})

test('normalizeState：损坏/非对象输入回落到空状态而不是抛错', () => {
  assert.deepEqual(normalizeState(null), { version: STATE_VERSION, providerOrder: [], efforts: [], layout: null })
  assert.deepEqual(normalizeState([1, 2, 3]), { version: STATE_VERSION, providerOrder: [], efforts: [], layout: null })
  assert.deepEqual(normalizeState({ providerOrder: 'nope', efforts: 'nope' }), {
    version: STATE_VERSION, providerOrder: [], efforts: [], layout: null,
  })
  // 单条记录形式、非法记录被跳过
  const single = normalizeState({ effort: { provider: 'p', model: 'm', effort: 'max' } })
  assert.deepEqual(single.efforts, [{ provider: 'p', model: 'm', effort: 'max' }])
  const mixed = normalizeState({ efforts: [{ provider: 'p', model: 'm', effort: 'low' }, { provider: 1 }, 'x'] })
  assert.deepEqual(mixed.efforts, [{ provider: 'p', model: 'm', effort: 'low' }])
})

test('createStateStore：写入后重开仍能读到（落盘生效）', async () => {
  const dir = await tempDir()
  try {
    const store = createStateStore({ dir })
    assert.deepEqual(await store.read(), { version: STATE_VERSION, providerOrder: [], efforts: [], layout: null })

    const saved = await store.update({ providerOrder: ['b', 'a'], effort: { provider: 'b', model: 'm2', effort: 'high' } })
    assert.deepEqual(saved.providerOrder, ['b', 'a'])
    assert.deepEqual(saved.efforts, [{ provider: 'b', model: 'm2', effort: 'high' }])

    // 同一份记录再写一次：按 (provider, model) 覆盖，而不是追加
    const replaced = await store.update({ effort: { provider: 'b', model: 'm2', effort: 'low' } })
    assert.deepEqual(replaced.efforts, [{ provider: 'b', model: 'm2', effort: 'low' }])

    const reopened = createStateStore({ dir })
    assert.deepEqual(await reopened.read(), replaced)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createStateStore：旧格式文件读取时迁移成当前版本并写回', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'state.json')
    await writeFile(file, JSON.stringify({
      version: 1,
      providerOrder: ['x'],
      reasoningEfforts: { 'x::m1': 'medium' },
    }), 'utf8')

    const store = createStateStore({ dir })
    const state = await store.read()
    assert.deepEqual(state, {
      version: STATE_VERSION,
      providerOrder: ['x'],
      efforts: [{ provider: 'x', model: 'm1', effort: 'medium' }],
      layout: null,
    })
    // 迁移结果应已写回磁盘（不是只在内存里）
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(onDisk.version, STATE_VERSION)
    assert.deepEqual(onDisk.efforts, state.efforts)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('createStateStore：损坏文件留档后从空状态开始', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'state.json')
    await writeFile(file, '{ not json', 'utf8')

    const store = createStateStore({ dir })
    assert.deepEqual(await store.read(), { version: STATE_VERSION, providerOrder: [], efforts: [], layout: null })

    const names = await readdir(dir)
    assert.equal(names.filter((name) => name.startsWith('state.json.bad-')).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('路由：GET 读、PUT 合并写、方法/来源/请求体校验', async () => {
  const dir = await tempDir()
  try {
    const store = createStateStore({ dir })
    const routes = makeRoutes(store, {})
    const readRoute = routes.find((route) => route.path === `${ROUTE_BASE}/state`)
    const saveRoute = routes.find((route) => route.path === `${ROUTE_BASE}/state/save`)
    assert.ok(readRoute && saveRoute)

    const read = await call(readRoute, fakeReq(), fakeRes())
    assert.equal(read.ok, true)
    assert.deepEqual(read.state, { version: STATE_VERSION, providerOrder: [], efforts: [], layout: null })

    const saved = await call(saveRoute, fakeReq({
      method: 'PUT',
      rawBody: JSON.stringify({ providerOrder: ['p1', 'p2'], effort: { provider: 'p1', model: 'm', effort: 'high' } }),
    }), fakeRes())
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.state.providerOrder, ['p1', 'p2'])
    assert.deepEqual(saved.state.efforts, [{ provider: 'p1', model: 'm', effort: 'high' }])

    // 错误的请求方法
    const wrongMethod = await call(readRoute, fakeReq({ method: 'POST' }), fakeRes())
    assert.equal(wrongMethod.error, 'method not allowed: POST')

    // 非法 JSON
    const badBody = await call(saveRoute, fakeReq({ method: 'PUT', rawBody: '{ oops' }), fakeRes())
    assert.equal(badBody.ok, false)
    assert.equal(badBody.error.code, 'state/write')

    // 非回环来源
    const nonLoopback = await call(readRoute, fakeReq({ remote: '203.0.113.9' }), fakeRes())
    assert.equal(nonLoopback.error, 'forbidden: loopback only')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('apply：注册三条同源回环路由，并在清理时逐条释放', () => {
  const registered = []
  const released = []
  const disposers = []
  const ctx = {
    webServer: {
      register(route) {
        registered.push(route)
        return () => released.push(route.path)
      },
    },
    effect(fn) {
      disposers.push(fn())
    },
    get() {
      return undefined
    },
  }

  apply(ctx)
  assert.deepEqual(
    registered.map((route) => route.path).sort(),
    [`${ROUTE_BASE}/health`, `${ROUTE_BASE}/state`, `${ROUTE_BASE}/state/save`].sort(),
  )
  assert.ok(registered.every((route) => route.kind === 'exact' && typeof route.handler === 'function'))

  for (const dispose of disposers) dispose()
  assert.equal(released.length, 3)
})

test('normalizeState：v3 尺寸字段读取、夹紧、别名与旧字段共存', () => {
  const { sanitizeLayout, LAYOUT_LIMITS } = __internals

  // 旧文件（v2）没有 layout：迁移后为 null，原有配置一项不丢
  const legacy = normalizeState({
    version: 2,
    providerOrder: ['p'],
    efforts: [{ provider: 'p', model: 'm', effort: 'high' }],
  })
  assert.deepEqual(legacy, {
    version: STATE_VERSION,
    providerOrder: ['p'],
    efforts: [{ provider: 'p', model: 'm', effort: 'high' }],
    layout: null,
  })

  // 合法尺寸原样保留（取整）
  assert.deepEqual(normalizeState({
    layout: { railWidth: 210, paneWidth: 360, height: 300 },
  }).layout, { railWidth: 210, paneWidth: 360, height: 300 })
  assert.deepEqual(normalizeState({
    layout: { railWidth: 210.4, paneWidth: 360.6, height: null },
  }).layout, { railWidth: 210, paneWidth: 361, height: null })

  // 越界/非法：逐项夹紧或置 null，不会整份文件失效
  const clamped = normalizeState({
    providerOrder: ['q'],
    layout: { railWidth: 9999, paneWidth: 10, height: -5 },
  })
  assert.deepEqual(clamped.layout, {
    railWidth: LAYOUT_LIMITS.railMax,
    paneWidth: LAYOUT_LIMITS.paneMin,
    height: LAYOUT_LIMITS.heightMin,
  })
  assert.deepEqual(clamped.providerOrder, ['q'])

  // 三个字段都无效等价于没有记录
  assert.equal(sanitizeLayout({ railWidth: 'x', paneWidth: NaN, height: Infinity }), null)
  // 旧别名 panel / size 也能读
  assert.equal(normalizeState({ panel: { railWidth: 180 } }).layout.railWidth, 180)
  assert.equal(normalizeState({ size: { height: 240 } }).layout.height, 240)
  // 显式 null / 非对象
  assert.equal(normalizeState({ layout: null }).layout, null)
  assert.equal(sanitizeLayout('nope'), null)
})

test('createStateStore：尺寸写入后重开仍保持，且可清除', async () => {
  const dir = await tempDir()
  try {
    const store = createStateStore({ dir })
    const saved = await store.update({ layout: { railWidth: 230, paneWidth: 420, height: 320 } })
    assert.deepEqual(saved.layout, { railWidth: 230, paneWidth: 420, height: 320 })
    // 写尺寸不影响已有的顺序与档位记忆
    await store.update({ providerOrder: ['p1', 'p2'], effort: { provider: 'p1', model: 'm', effort: 'high' } })
    const reopened = createStateStore({ dir })
    const state = await reopened.read()
    assert.deepEqual(state.layout, { railWidth: 230, paneWidth: 420, height: 320 })
    assert.deepEqual(state.providerOrder, ['p1', 'p2'])
    assert.deepEqual(state.efforts, [{ provider: 'p1', model: 'm', effort: 'high' }])

    // null 表示清除，回到默认/自适应
    const cleared = await store.update({ layout: null })
    assert.equal(cleared.layout, null)
    assert.deepEqual(cleared.providerOrder, ['p1', 'p2'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('路由：PUT 可携带 layout，GET 返回完整状态', async () => {
  const dir = await tempDir()
  try {
    const store = createStateStore({ dir })
    const routes = makeRoutes(store, {})
    const saveRoute = routes.find((route) => route.path === `${ROUTE_BASE}/state/save`)
    const readRoute = routes.find((route) => route.path === `${ROUTE_BASE}/state`)

    const saved = await call(saveRoute, fakeReq({
      method: 'PUT',
      rawBody: JSON.stringify({ layout: { railWidth: 200, paneWidth: 300, height: null } }),
    }), fakeRes())
    assert.deepEqual(saved.state.layout, { railWidth: 200, paneWidth: 300, height: null })

    const read = await call(readRoute, fakeReq(), fakeRes())
    assert.deepEqual(read.state.layout, { railWidth: 200, paneWidth: 300, height: null })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
