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

// RAIL_WIDTH / PANE_WIDTH / GAP 定义在区段外（样式与默认布局都用），当参数注入。
const utils = new Function('RAIL_WIDTH', 'PANE_WIDTH', 'GAP', `${source.slice(begin, end)}
return {
  PANEL_LIMITS, clampNumber, findRememberedEffort, supportsEffort, normalizeLayout,
  normalizePickerState, rememberEffortIn, orderedGroupsOf, resolveEffortSelection,
  resolveSwitchEffort, moveProviderId, resolveHitZone, panelCursor, shouldArmHover,
  hoverNeedsRestart, exceedsDragThreshold, clampDragDelta, applyResizeDelta, resolvePanelBox,
};
`)(196, 340, 6)

const {
  PANEL_LIMITS, clampNumber, findRememberedEffort, supportsEffort, normalizeLayout,
  normalizePickerState, rememberEffortIn, orderedGroupsOf, resolveEffortSelection,
  resolveSwitchEffort, moveProviderId, resolveHitZone, panelCursor, shouldArmHover,
  hoverNeedsRestart, exceedsDragThreshold, clampDragDelta, applyResizeDelta, resolvePanelBox,
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
  assert.deepEqual(normalizePickerState(undefined), { layout: null, providerOrder: [], efforts: [] })
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

test('normalizeLayout：只接受有限数，全空归一为 null，兼容旧字段名', () => {
  assert.equal(normalizeLayout(undefined), null)
  assert.equal(normalizeLayout(null), null)
  assert.equal(normalizeLayout([]), null)
  assert.equal(normalizeLayout({}), null)
  assert.deepEqual(normalizeLayout({ railWidth: 200, paneWidth: 300, height: 240 }),
    { railWidth: 200, paneWidth: 300, height: 240 })
  // 单个字段也可以是 null（表示该项沿用默认/自适应）
  assert.deepEqual(normalizeLayout({ railWidth: 200 }), { railWidth: 200, paneWidth: null, height: null })
  // 全部非法等价于没有记录
  assert.equal(normalizeLayout({ railWidth: NaN, paneWidth: Infinity, height: '240' }), null)
  // 旧版字段名 panel / size 仍能读
  assert.equal(normalizePickerState({ size: { railWidth: 180 } }).layout.railWidth, 180)
  assert.equal(normalizePickerState({ panel: { height: 320 } }).layout.height, 320)
  // 新字段不会挤掉旧字段
  const migrated = normalizePickerState({
    version: 2,
    providerOrder: ['p'],
    efforts: [{ provider: 'p', model: 'm', effort: 'high' }],
    layout: { railWidth: 210, paneWidth: 360, height: null },
  })
  assert.deepEqual(migrated, {
    layout: { railWidth: 210, paneWidth: 360, height: null },
    providerOrder: ['p'],
    efforts: [{ provider: 'p', model: 'm', effort: 'high' }],
  })
})

test('clampNumber：区间收敛', () => {
  assert.equal(clampNumber(5, 10, 20), 10)
  assert.equal(clampNumber(25, 10, 20), 20)
  assert.equal(clampNumber(15, 10, 20), 15)
})

test('resolveHitZone：角/上边/左右边的优先次序与窄热区', () => {
  // 两栏同一行：供应商栏 100..296，间隙 6，模型栏 302..642，高 300
  const boxes = {
    rail: { left: 100, top: 200, width: 196, height: 300 },
    pane: { left: 302, top: 200, width: 340, height: 300 },
  }
  const at = (x, y) => resolveHitZone({ x, y }, boxes)

  // 左上角优先于上边框：横向 12px 以内
  assert.equal(at(101, 201), 'corner')
  assert.equal(at(111, 201), 'corner')
  assert.equal(at(113, 201), 'top')
  // 上边框横跨两栏
  assert.equal(at(200, 202), 'top')
  assert.equal(at(500, 200.5), 'top')
  // 两条左竖边：宽 5px，且只在卡片高度内
  assert.equal(at(101, 350), 'rail-w')
  assert.equal(at(105, 350), 'rail-w')
  assert.equal(at(107, 350), null)
  assert.equal(at(303, 350), 'pane-w')
  assert.equal(at(308, 350), null)
  // 两栏之间的 6px 间隙不属于任何热区
  assert.equal(at(299, 350), null)
  // 栏内内容区域、卡片下方、完全在卡片外
  assert.equal(at(160, 350), null)
  assert.equal(at(101, 510), null)
  assert.equal(at(20, 20), null)
  // 缺一栏时不崩、不出热区
  assert.equal(resolveHitZone({ x: 101, y: 350 }, { rail: boxes.rail }), null)
  assert.equal(resolveHitZone({ x: 101, y: 350 }, {}), null)
})

test('panelCursor / shouldArmHover / hoverNeedsRestart / exceedsDragThreshold', () => {
  assert.equal(panelCursor('rail-w'), 'col-resize')
  assert.equal(panelCursor('pane-w'), 'col-resize')
  assert.equal(panelCursor('top'), 'row-resize')
  assert.equal(panelCursor('corner'), 'nwse-resize')
  assert.equal(panelCursor(null), undefined)

  const waiting = { zone: 'top', since: 1000, x: 50, y: 50 }
  // 延迟未到不武装；到点才武装
  assert.equal(shouldArmHover(waiting, 1000 + PANEL_LIMITS.hoverDelayMs - 1), false)
  assert.equal(shouldArmHover(waiting, 1000 + PANEL_LIMITS.hoverDelayMs), true)
  assert.equal(shouldArmHover(null, 9999), false)

  // 容差内的手抖不重置；超出容差重新计时
  assert.equal(hoverNeedsRestart(waiting, { x: 54, y: 50 }), false)
  assert.equal(hoverNeedsRestart(waiting, { x: 55, y: 50 }), true)
  assert.equal(hoverNeedsRestart(waiting, { x: 50, y: 45 }), true)
  assert.equal(hoverNeedsRestart(null, { x: 0, y: 0 }), false)

  // 按下后必须先超过拖动阈值，单纯点击不改尺寸
  assert.equal(exceedsDragThreshold(0, 0), false)
  assert.equal(exceedsDragThreshold(2, 0), false)
  assert.equal(exceedsDragThreshold(0, 2), false)
  assert.equal(exceedsDragThreshold(3, 0), true)
  assert.equal(exceedsDragThreshold(0, -3), true)
})

test('applyResizeDelta：边框跟手、分栏补偿，且只有单一 height', () => {
  const base = { left: 400, railWidth: 196, paneWidth: 340, height: 300 }
  // 供应商栏左边框向左拖 40：面板左边缘跟手，供应商栏变宽，模型栏不动
  assert.deepEqual(applyResizeDelta('rail-w', base, -40, 77),
    { left: 360, railWidth: 236, paneWidth: 340, height: 300 })
  // 模型栏左边框（分栏边界）向左拖：总宽不变，供应商栏补偿，模型栏变宽
  assert.deepEqual(applyResizeDelta('pane-w', base, -40, 77),
    { left: 400, railWidth: 156, paneWidth: 380, height: 300 })
  // 上边框向上拖 50：两栏共用的高度变高，水平位置不动
  assert.deepEqual(applyResizeDelta('top', base, 99, -50),
    { left: 400, railWidth: 196, paneWidth: 340, height: 350 })
  // 左上角：左边缘与高度同时变
  assert.deepEqual(applyResizeDelta('corner', base, -20, -30),
    { left: 380, railWidth: 216, paneWidth: 340, height: 330 })
  // base.left 缺省时按 0 处理，不会得到 NaN
  assert.equal(applyResizeDelta('rail-w', { railWidth: 196, paneWidth: 340, height: 300 }, 10, 0).left, 10)
})

test('resolvePanelBox：高度自适应、上下展开与最大高度', () => {
  const base = {
    railWidth: 196, paneWidth: 340, height: null, gap: 6,
    viewportWidth: 1200, viewportHeight: 900,
    triggerLeft: 400, triggerTop: 600, triggerBottom: 640, preferAbove: true,
  }
  const above = resolvePanelBox(base)
  assert.equal(above.width, 196 + 6 + 340)
  assert.equal(above.left, 400)
  // height=null 表示内容自适应，实际高度由 maxHeight 约束
  assert.equal(above.height, null)
  assert.equal(above.maxHeight, 600 - PANEL_LIMITS.margin)
  // 上方展开：底边钉住触发按钮上沿
  assert.equal(above.bottom, 900 - 600 + PANEL_LIMITS.margin)
  assert.equal(above.top, null)

  const below = resolvePanelBox({ ...base, preferAbove: false })
  assert.equal(below.top, 640 + PANEL_LIMITS.margin)
  assert.equal(below.bottom, null)

  // 下方展开、上边框上拖 40（dy=-40）：上边缘跟手上移，高度 +40，底边原地不动
  const risen = resolvePanelBox({ ...base, preferAbove: false, height: 240 + 40, triggerBottom: 640 - 40 })
  assert.equal(risen.top, 640 - 40 + PANEL_LIMITS.margin)
  assert.equal(risen.top + risen.height, 640 + PANEL_LIMITS.margin + 240)

  // 一直往上拖：上边缘最多到视口 margin，高度按剩余空间收
  const lifted = resolvePanelBox({ ...base, preferAbove: false, height: 660, triggerBottom: 640 - 2000 })
  assert.equal(lifted.top, PANEL_LIMITS.margin)
  const tightTop = resolvePanelBox({
    ...base, preferAbove: false, height: 660, viewportHeight: 500, triggerBottom: 100,
  })
  assert.equal(tightTop.top, 100 + PANEL_LIMITS.margin)
  assert.equal(tightTop.maxHeight, 500 - PANEL_LIMITS.margin - tightTop.top)
  assert.equal(tightTop.height, tightTop.maxHeight)

  // 用户给定高度：被夹在 [min(180, maxHeight), maxHeight]
  assert.equal(resolvePanelBox({ ...base, height: 320 }).height, 320)
  assert.equal(resolvePanelBox({ ...base, height: 1000 }).height, 592)
  assert.equal(resolvePanelBox({ ...base, height: 10 }).height, 180)
  // 下方可用空间很小：maxHeight 不低于 120，高度也跟着收到 120
  const tight = resolvePanelBox({
    ...base, height: 400, preferAbove: false, viewportHeight: 700, triggerBottom: 690,
  })
  assert.equal(tight.maxHeight, 120)
  assert.equal(tight.height, 120)
})

test('resolvePanelBox：宽高上下限与视口钳制', () => {
  const base = {
    railWidth: 196, paneWidth: 340, height: null, gap: 6,
    viewportWidth: 1200, viewportHeight: 900,
    triggerLeft: 400, triggerTop: 600, triggerBottom: 640, preferAbove: true,
  }
  // 单栏钳制
  assert.equal(resolvePanelBox({ ...base, railWidth: 50 }).railWidth, PANEL_LIMITS.railMin)
  assert.equal(resolvePanelBox({ ...base, railWidth: 999 }).railWidth, PANEL_LIMITS.railMax)
  assert.equal(resolvePanelBox({ ...base, paneWidth: 50 }).paneWidth, PANEL_LIMITS.paneMin)
  assert.equal(resolvePanelBox({ ...base, paneWidth: 9999 }).paneWidth, PANEL_LIMITS.paneMax)

  // 视口窄：总宽先收模型栏，仍超再收供应商栏，且不越出视口
  const narrow = resolvePanelBox({
    ...base, railWidth: 196, paneWidth: 760, viewportWidth: 700,
  })
  assert.equal(narrow.width, 700 - 16)
  assert.ok(narrow.left >= PANEL_LIMITS.margin)
  assert.ok(narrow.left + narrow.width <= 700 - PANEL_LIMITS.margin)
  assert.equal(narrow.paneWidth, 700 - 16 - 6 - 196)

  // 左右位置被夹在视口内
  assert.equal(resolvePanelBox({ ...base, triggerLeft: 0 }).left, PANEL_LIMITS.margin)
  assert.equal(resolvePanelBox({ ...base, triggerLeft: 5000 }).left, 1200 - 542 - 8)
})

test('clampDragDelta：边框到达上下限时多余位移被丢掉', () => {
  const base = { left: 400, railWidth: 196, paneWidth: 340, height: 300 }

  // 供应商栏左边框：左边缘不越过视口 margin(8)，宽度不越 120..420
  assert.deepEqual(clampDragDelta('rail-w', base, -100, 50), { dx: -100, dy: 50 })
  // 负方向先撞上供应商栏最大宽度（420），还没到视口左侧
  assert.equal(clampDragDelta('rail-w', base, -500, 0).dx, base.railWidth - PANEL_LIMITS.railMax)
  assert.equal(clampDragDelta('rail-w', base, 999, 0).dx, base.railWidth - PANEL_LIMITS.railMin)

  // 分栏边界：供应商栏 ≥120、模型栏 ≥220 同时成立
  assert.deepEqual(clampDragDelta('pane-w', base, 0, 77), { dx: 0, dy: 77 })
  // 负方向先撞供应商栏最小宽度（120），不是模型栏最大宽度
  assert.equal(clampDragDelta('pane-w', base, -999, 0).dx, PANEL_LIMITS.railMin - base.railWidth)
  assert.equal(clampDragDelta('pane-w', base, 999, 0).dx, base.paneWidth - PANEL_LIMITS.paneMin)

  // 高度：180..660
  assert.equal(clampDragDelta('top', base, 30, -500).dy, PANEL_LIMITS.heightMin - base.height)
  assert.equal(clampDragDelta('top', base, 30, 999).dy, PANEL_LIMITS.heightMax - base.height)
  assert.equal(clampDragDelta('top', base, 30, 40).dx, 30)

  // 左上角：两个轴同时收敛
  const corner = clampDragDelta('corner', base, -999, 999)
  assert.equal(corner.dx, base.railWidth - PANEL_LIMITS.railMax)
  assert.equal(corner.dy, PANEL_LIMITS.heightMax - base.height)
})
