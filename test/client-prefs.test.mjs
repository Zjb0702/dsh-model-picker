// 浏览器半边纯函数测试：直接从 client.js 的「偏好状态辅助」区段取代码执行，
// 不启动 DOM/React，只验证顺序合并与档位记忆的规则。
// 运行：node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const begin = source.indexOf('// #region 偏好状态辅助')
const end = source.indexOf('// #endregion')
assert.ok(begin >= 0 && end > begin, 'client.js 缺少偏好状态辅助区标记')

const utils = new Function(`${source.slice(begin, end)}
return {
  findRememberedEffort, supportsEffort, normalizePickerState, rememberEffortIn, orderedGroupsOf,
  resolveEffortSelection, resolveSwitchEffort, moveProviderId,
};
`)()

const {
  findRememberedEffort, supportsEffort, normalizePickerState, rememberEffortIn, orderedGroupsOf,
  resolveEffortSelection, resolveSwitchEffort, moveProviderId,
} = utils

const model = (id, efforts, defaultEffort) => ({
  id,
  reasoning: { efforts: efforts.map((level) => ({ id: level, name: level })), defaultEffort },
})

test('normalizePickerState：过滤掉不完整/非法记录', () => {
  const state = normalizePickerState({
    providerOrder: ['a', 3, null, 'b', 'a'],
    efforts: [
      { provider: 'a', model: 'm', effort: 'high' },
      { provider: 'a', model: 'm' },
      { provider: 1, model: 'm', effort: 'high' },
      null,
    ],
  })
  // providerOrder 原样保留（由 Host 侧负责去重）；efforts 只保留完整记录
  assert.deepEqual(state.providerOrder, ['a', 'b', 'a'])
  assert.deepEqual(state.efforts, [{ provider: 'a', model: 'm', effort: 'high' }])
  assert.deepEqual(normalizePickerState(undefined), { providerOrder: [], efforts: [] })
})

test('rememberEffortIn / findRememberedEffort：按供应商+模型覆盖记忆', () => {
  let state = { providerOrder: [], efforts: [] }
  state = rememberEffortIn(state, 'p1', 'm1', 'high')
  state = rememberEffortIn(state, 'p2', 'm1', 'low')
  state = rememberEffortIn(state, 'p1', 'm1', 'max')
  assert.deepEqual(state.efforts, [
    { provider: 'p2', model: 'm1', effort: 'low' },
    { provider: 'p1', model: 'm1', effort: 'max' },
  ])
  assert.equal(findRememberedEffort(state, 'p1', 'm1'), 'max')
  assert.equal(findRememberedEffort(state, 'p1', 'm2'), undefined)
  assert.equal(findRememberedEffort(undefined, 'p1', 'm1'), undefined)
})

test('supportsEffort：只接受该模型声明的档位', () => {
  const m = model('m', ['low', 'high'], 'low')
  assert.equal(supportsEffort(m, 'high'), true)
  assert.equal(supportsEffort(m, 'medium'), false)
  assert.equal(supportsEffort(m, undefined), false)
  assert.equal(supportsEffort(undefined, 'high'), false)
  assert.equal(supportsEffort({ id: 'x' }, 'high'), false)
})

test('orderedGroupsOf：记忆顺序优先，新出现的供应商按目录顺序接在后面', () => {
  const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(
    orderedGroupsOf(groups, { providerOrder: [], efforts: [] }).map((g) => g.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    orderedGroupsOf(groups, { providerOrder: ['c', 'a'], efforts: [] }).map((g) => g.id),
    ['c', 'a', 'b'],
  )
  // 记忆里的已删除供应商被忽略，不占位
  assert.deepEqual(
    orderedGroupsOf(groups, { providerOrder: ['gone', 'b'], efforts: [] }).map((g) => g.id),
    ['b', 'a', 'c'],
  )
})
test('resolveEffortSelection：显示跟记忆走，提交判断跟宿主走', () => {
  const m = model('m', ['low', 'medium', 'high'], 'low')
  // 宿主已在高档、记忆是低档：滑条显示记忆（低），但 host 记录的是高
  assert.deepEqual(resolveEffortSelection({ reasoningEffort: 'high' }, m, 'low'), { host: 'high', display: 'low' })
  // 宿主投影没带档位：host 落到默认低档；记忆支持时显示记忆
  assert.deepEqual(resolveEffortSelection(null, m, 'high'), { host: 'low', display: 'high' })
  assert.deepEqual(resolveEffortSelection({}, m, 'high'), { host: 'low', display: 'high' })
  // 记忆里的档位已失效（模型升级删档）：显示回落到宿主档位
  assert.deepEqual(resolveEffortSelection({ reasoningEffort: 'high' }, m, 'max'), { host: 'high', display: 'high' })
  // 模型没有档位元数据：两边都是 undefined，不崩
  assert.deepEqual(resolveEffortSelection({ reasoningEffort: 'high' }, undefined, 'high'), { host: undefined, display: undefined })
})

test('resolveSwitchEffort：同路由保留档位，换模型优先记忆、否则默认', () => {
  const m = model('m2', ['low', 'high'], 'low')
  const same = resolveSwitchEffort({ provider: 'p', model: 'm2', reasoningEffort: 'high' }, 'p', m, 'low')
  assert.deepEqual(same, { onSameRoute: true, effort: 'high' })

  const remembered = resolveSwitchEffort({ provider: 'p', model: 'm1', reasoningEffort: 'low' }, 'p', m, 'high')
  assert.deepEqual(remembered, { onSameRoute: false, effort: 'high' })

  // 记忆档位不在目标模型的档位集合里：用目录默认值
  const stale = resolveSwitchEffort({ provider: 'p', model: 'm1', reasoningEffort: 'low' }, 'p', m, 'max')
  assert.deepEqual(stale, { onSameRoute: false, effort: 'low' })

  // 同名模型换到别的供应商：不算同路由
  const otherProvider = resolveSwitchEffort({ provider: 'q', model: 'm2', reasoningEffort: 'high' }, 'p', m, undefined)
  assert.deepEqual(otherProvider, { onSameRoute: false, effort: 'low' })
})

test('moveProviderId：拖到别处/末尾/开头，以及原地不动', () => {
  const order = ['a', 'b', 'c']
  assert.deepEqual(moveProviderId(order, 'a', 2), ['b', 'a', 'c'])
  assert.deepEqual(moveProviderId(order, 'a', 3), ['b', 'c', 'a'])
  assert.deepEqual(moveProviderId(order, 'c', 0), ['c', 'a', 'b'])
  assert.deepEqual(moveProviderId(order, 'b', 3), ['a', 'c', 'b'])
  // 原地：返回同一个数组引用，调用方据此跳过写盘
  assert.equal(moveProviderId(order, 'b', 1), order)
  assert.equal(moveProviderId(order, 'b', 2), order)
  // 未知 id 原样返回
  assert.equal(moveProviderId(order, 'zzz', 0), order)
})
