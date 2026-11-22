// 模型选择器 —— 浏览器半边。
//
// 交互与布局按参考图（zcode 的模型选择器）实现，两级结构：
//   1. 左侧卡片是一级菜单：一行一个供应商；
//   2. 鼠标移到某一行，右侧卡片立即换成该供应商的模型列表——左行高亮与右侧
//      列表读的是同一个派生值，同一次渲染一起变，所以不闪烁、不错位；
//   3. 右侧卡片自上而下：供应商标题行 / “模型”小标题 / 模型行（选中打勾）/
//      分隔线 / “思考强度”行 / 渐变色滑条；
//   4. 点某个模型即回填（selectModel）并保持打勾高亮。
//
// 供应商与模型全部来自项目现有的 Host 模型目录
// （ctx.remote.session.modelCatalog），不硬编码任何名字；
// 回填走 ctx.remote.session.selectModel。
window.__ModuleLoader__.load({
	id: '@local/dsh-model-picker',
	factory(require) {
		const React = require('react');
		const ReactDOM = require('react-dom');
		const h = React.createElement;
		const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React;

		const NS = 'model-picker';
		// 坐位：输入框工具行里的模型选择器。宿主自带的实现注册在 priority 0，
		// single 插槽只渲染 priority 最低的那一个，所以这里用一个明确更低的值
		// 覆盖它；本插件停用后宿主的实现自动回来。
		const SEAT = 'conversation.input.model';
		const PRIORITY = -200;
		const RAIL_WIDTH = 196;
		const PANE_WIDTH = 340;
		const GAP = 6;
		// 圆点下方标注的英文单词。档位集合本身完全由模型决定（宿主目录的
		// reasoning.efforts），这里只是把已知档位 id 的写法统一一下：
		// 宿主给的 name 是首字母大写形式（"Xhigh"），这里写成 "X-High"。
		const TIER_WORDS = {
			off: 'Off',
			minimal: 'Minimal',
			low: 'Low',
			medium: 'Medium',
			high: 'High',
			xhigh: 'X-High',
			max: 'Max',
		};
		const PANEL_MAX_HEIGHT = 420;

		const CSS = `
.dsh-mp-root { display: inline-flex; min-width: 0; }
.dsh-mp-trigger {
	display: inline-flex; align-items: center; gap: 6px; height: 28px; max-width: 240px;
	padding: 0 8px; border: 0; border-radius: 8px; background: transparent;
	color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1;
	cursor: pointer; transition: background-color .12s ease;
}
.dsh-mp-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-mp-trigger:disabled { opacity: .5; cursor: default; background: transparent; }
.dsh-mp-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-mp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mp-effort { color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.dsh-mp-chevron { flex: none; display: inline-flex; opacity: .65; }
/* 输入框那一行放不下文字时，宿主会给这一格设 --dsh-composer-model-text-display: none
   与 --dsh-composer-model-icon-display: block：文字收起、改用图标。和宿主自带的
   选择器保持同一套约定，行内布局才不会挤坏。 */
.dsh-mp-glyph { display: var(--dsh-composer-model-icon-display, none); flex: none; }
.dsh-mp-name, .dsh-mp-effort, .dsh-mp-trigger .dsh-mp-badge { display: var(--dsh-composer-model-text-display, block); }

.dsh-mp-layer { position: fixed; z-index: 2147483000; display: flex; gap: ${GAP}px; align-items: stretch; }
.dsh-mp-card {
	display: flex; flex-direction: column; min-height: 0;
	/* 用 inherit 而不是 100%：层的高度由内容决定，百分比 max-height 在
	   这种弹性行里可能不生效；inherit 直接拿到层上内联的像素上限。 */
	max-height: inherit;
	overflow: hidden; background: var(--dsw-alias-bg-overlay);
	border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
	box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
}
.dsh-mp-rail { flex: none; width: ${RAIL_WIDTH}px; padding: 6px; overflow-y: auto; }
.dsh-mp-pane { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; padding: 6px; overflow: hidden; }
/* 模型区自己滚动：上方标题与下方思考强度不跟着滚，面板高度也只在
   96~220px 之间变化，不会因为换了个供应商就大幅跳动。 */
.dsh-mp-models {
	display: flex; flex-direction: column; gap: 2px;
	min-height: 96px; max-height: 220px; overflow-y: auto; overflow-x: hidden;
}

.dsh-mp-row {
	display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
	height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent;
	color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left;
	cursor: pointer;
}
/* 悬停与选中是两种不同语义，刻意用两套不同族的令牌，保证一眼可分：
     - 选中（常亮、带 ✓）：中性灰底 --dsw-alias-interactive-bg-active；
     - 悬停（临时提示）：业务蓝一族——浅蓝底 --dsw-alias-state-business-tertiary
       配品牌蓝文字 --dsw-alias-state-business-primary。
   不沿用参考图里那种中性灰：浅色主题下悬停是 deepseek-100 淡蓝底 +
   deepseek-500 蓝字，深色主题下是 deepseek-800 深蓝底 + deepseek-400 亮蓝字，
   两套主题里都跟面板底色 --dsw-alias-bg-overlay 和选中灰底分得开。

   悬停高亮由组件状态 data-lit 驱动，而不是只靠 :hover：指针从左侧供应商行
   移到右侧模型列表时，供应商行的 :hover 会失效，但状态里的 data-lit 仍然
   成立，所以同一时刻左右各有一行亮着；指针离开整个面板时状态清空，全部熄灭。

   下面这些规则只改背景色和文字色，行高 / 内边距 / 边框宽度一律不动，
   悬停时行不会变大变小，列表不会跳动或错位。 */
@media (hover: hover) {
	/* 指针真实停在行上时的兜底样式，与 data-lit 用的是同一套颜色。
	   已选中的行被 :not([data-active='true']) 排除在外，所以选中与悬停
	   同时成立时，一定是下面那条选中态胜出。 */
	.dsh-mp-row:not([data-active='true']):hover:not(:disabled) {
		background: var(--dsw-alias-state-business-tertiary);
		color: var(--dsw-alias-state-business-primary);
	}
}
/* 状态驱动的悬停高亮：供应商行与模型行共用这一条规则，两处样式完全一致。
   同样排除已选中的行，选中态永远压过悬停态。 */
.dsh-mp-row[data-lit='true']:not([data-active='true']):not(:disabled) {
	background: var(--dsw-alias-state-business-tertiary);
	color: var(--dsw-alias-state-business-primary);
}
/* 键盘操作时焦点行与悬停行同一套提示样式；已选中的行同样不参与。 */
.dsh-mp-row:not([data-active='true']):focus-visible {
	background: var(--dsw-alias-state-business-tertiary);
	color: var(--dsw-alias-state-business-primary);
}
/* 选中态常亮（不依赖 :hover，指针移出后仍然亮着）：
   模型行 = 当前选中的模型，供应商行 = 当前选中模型所属的供应商，都带 ✓。 */
.dsh-mp-row[data-active='true'] {
	background: var(--dsw-alias-interactive-bg-active);
}
.dsh-mp-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-mp-row:disabled { opacity: .6; cursor: default; }
.dsh-mp-row-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mp-row-check { flex: none; display: inline-flex; color: var(--dsw-alias-brand-primary); }
/* 模型名不长时不该把徽标推到最右边：名字与徽标相邻，靠中间的弹性空位
   把勾选标记顶到行尾——与参考图里「名字 + 视觉 + …… + ✓」的排布一致。 */
.dsh-mp-model-row .dsh-mp-row-label { flex: 0 1 auto; }
.dsh-mp-model-row .dsh-mp-fill { flex: 1 1 auto; min-width: 0; }
.dsh-mp-badge {
	flex: none; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	padding: 1px 5px; border-radius: 4px; font-size: 10px; line-height: 14px;
	background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary);
}
.dsh-mp-badge[data-tone='info'] { background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-state-business-primary); }
.dsh-mp-badge[data-tone='success'] { background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); }
.dsh-mp-badge[data-tone='warning'] { background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-primary); }
/* 悬停底色是业务蓝一族，蓝色的徽标（如「视觉」）正好同色会糊成一片；
   行亮起时把徽标底色换成面板底色，保证徽标文字仍然读得清。
   只改徽标的背景，不改徽标尺寸，行高也不受影响。 */
.dsh-mp-row[data-lit='true'] .dsh-mp-badge,
.dsh-mp-row:not([data-active='true']):hover .dsh-mp-badge {
	background: var(--dsw-alias-bg-overlay);
}

.dsh-mp-head {
	display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px;
	font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary);
}
.dsh-mp-head-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mp-divider { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l1); }
.dsh-mp-caption { padding: 6px 10px 4px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-mp-note { padding: 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-mp-error { padding: 8px 10px 4px; font-size: 12px; color: var(--dsw-alias-state-error-primary); }

.dsh-mp-effort-row {
	display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px;
	font-size: 13px; color: var(--dsw-alias-label-secondary);
}
.dsh-mp-effort-value { color: var(--dsw-alias-label-primary); font-size: 12px; }

/* 档位滑条：整条轨道画一条绿→蓝的渐变，未选中的部分用面板底色盖住，
   所以“填充到哪”就是“选中哪一档”，颜色随档位自然变化。 */
.dsh-mp-scale { padding: 6px 14px 2px; }
.dsh-mp-track {
	position: relative; height: 12px; border-radius: 999px; cursor: pointer; touch-action: none;
	background: linear-gradient(90deg, var(--dsw-alias-state-success-primary), var(--dsw-alias-brand-primary));
}
.dsh-mp-track:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }
.dsh-mp-track[data-static='true'] { cursor: default; }
.dsh-mp-rest {
	position: absolute; top: 0; bottom: 0; right: 0; z-index: 1;
	border-radius: 0 999px 999px 0; background: var(--dsw-alias-bg-layer-3);
	/* 点击某一档：未选中段与滑柄一起平滑移动“一次”，不会先退回旧档再跳过去。 */
	transition: left 120ms ease;
}/* 大圆滑柄：zcode 同款的白色大圆（22px），圆心即档位落点；两端各内缩
   11px（见 tierLeft），圆始终收在色条两端之内，不会探出面板。 */
.dsh-mp-knob {
	position: absolute; top: 50%; z-index: 4; width: 22px; height: 22px; margin-left: -11px;
	transform: translateY(-50%); border-radius: 50%; background: #fff;
	box-shadow: 0 2px 8px rgba(0, 0, 0, .3); pointer-events: none;
	transition: left 120ms ease;
}
/* 拖动中（data-drag）必须跟手：指针到哪画到哪，不能有补间。
   过渡只作用于绝对定位的 left/width，不参与布局，所以滑条与各行几何都不变。 */
.dsh-mp-track[data-drag='true'] .dsh-mp-rest,
.dsh-mp-track[data-drag='true'] .dsh-mp-knob { transition: none; }

/* 每个档位一个小圆点。圆点接管指针事件，但自己不处理点击：按下/移动照旧冒泡到
   轨道，由轨道统一按最近档位取整，所以“点圆点”和“拖到圆点”仍是同一条路径，
   不会一次操作提交两次。

   zcode 同款的小圆点：白色实心 8px，恒定大小——它不放大，只有大滑柄移动；
   悬停时同样只做轻微提亮（transform: scale 不占布局，不会推动相邻圆点）。
   圆点的 left 由 tierLeft 计算（两端各内缩滑柄半径），整条轨道从头到尾都
   藏在色条内部，不会再探出渐变框。 */
.dsh-mp-ticks { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.dsh-mp-tick {
	position: absolute; top: 50%; width: 20px; height: 20px; transform: translate(-50%, -50%);
	display: flex; align-items: center; justify-content: center;
	pointer-events: auto;
}
.dsh-mp-tick-dot {
	width: 8px; height: 8px; border-radius: 50%; background: #fff;
	transform: scale(1); transition: transform 90ms ease;
}
@media (hover: hover) {
	.dsh-mp-tick:hover .dsh-mp-tick-dot {
		transform: scale(1.3);
	}
}
/* 档位英文单词：每个圆点正下方一行。 */
.dsh-mp-labels { position: relative; height: 15px; margin-top: 5px; }
.dsh-mp-label {
	position: absolute; top: 0; transform: translateX(-50%); font-size: 10px; line-height: 15px;
	color: var(--dsw-alias-label-tertiary); white-space: nowrap; pointer-events: none;
}
.dsh-mp-label[data-current='true'] { color: var(--dsw-alias-label-primary); }
/* 首尾两个标签不越出面板边界。 */
.dsh-mp-label[data-edge='start'] { transform: none; }
.dsh-mp-label[data-edge='end'] { transform: translateX(-100%); }
`;

		/* ---------- 图标：不依赖宿主的 primitives 包，自带最小 SVG ---------- */
		const glyph = (size, children) => h('svg', {
			width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
			stroke: 'currentColor', strokeWidth: 1.6,
			strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
		}, children);
		const IconCheck = () => glyph(14, h('path', { d: 'M3.5 8.5 6.5 11.5 12.5 5' }));
		const IconChevronDown = () => glyph(12, h('path', { d: 'M4 6.5 8 10.5 12 6.5' }));
		const IconChevronRight = () => glyph(12, h('path', { d: 'M6.5 4 10.5 8 6.5 12' }));
		// 触发按钮在窄行里的替代图形（两个叠放的方块，代表“模型”）。
		const IconGlyph = () => glyph(16, [
			h('rect', { key: 'a', x: '2.5', y: '3', width: '11', height: '4', rx: '1.2' }),
			h('rect', { key: 'b', x: '2.5', y: '9', width: '11', height: '4', rx: '1.2' }),
		]);

		const effortIndexOf = (efforts, id) => {
			if (id === undefined) return -1;
			return efforts.findIndex((effort) => effort.id === id);
		};
		// 同一条路由（供应商 + 模型）即视为“宿主已经追上来了”。思考强度不参与比较：
		// 宿主回填的投影可能不带 reasoningEffort，若把它算进相等判断，乐观值会一直
		// 挂着，反而盖住之后从别处发起的切换。
		const sameRoute = (a, b) => a !== null && b !== null
			&& a.provider === b.provider && a.model === b.model;

		return {
			inject: ['slots', 'locale', 'remote', 'remote.session', 'sessions'],
			apply(ctx) {
				// 1) 样式：一个 <style> 标签，随 ctx.effect 的清理函数一起移除。
				ctx.effect(() => {
					const tag = document.createElement('style');
					tag.setAttribute('data-dsh-model-picker', '');
					tag.textContent = CSS;
					document.head.appendChild(tag);
					return () => { tag.remove(); };
				}, 'dsh-model-picker: styles');

				// 2) 文案：注册中英两套，其余语言回落到英文。
				ctx.effect(() => ctx.locale.register(NS, {
					zh: {
						'label.select': '选择模型',
						'menu.models': '模型',
						'menu.effort': '思考强度',
						// 档位名的中文写法；圆点下方仍用宿主的英文名。
						'effort.off': '关闭思考',
						'effort.minimal': '极低',
						'effort.low': '低',
						'effort.medium': '中',
						'effort.high': '高',
						'effort.xhigh': '极高',
						'effort.max': '最高',
						'empty': '该供应商暂无可用模型。',
						'emptyCatalog': '暂无可用模型。',
						'loading': '加载中…',
						'error.sessionInUse': '该会话正被另一个 DSH 实例占用，请关闭其他实例后重试。',
						'error.action': '切换失败：{message}',
					},
					en: {
						'label.select': 'Select model',
						'menu.models': 'Models',
						'menu.effort': 'Reasoning effort',
						'effort.off': 'Off',
						'effort.minimal': 'Minimal',
						'effort.low': 'Low',
						'effort.medium': 'Medium',
						'effort.high': 'High',
						'effort.xhigh': 'Extra high',
						'effort.max': 'Max',
						'empty': 'No models available for this provider.',
						'emptyCatalog': 'No models available.',
						'loading': 'Loading…',
						'error.sessionInUse': 'This session is owned by another DSH instance. Quit it and retry.',
						'error.action': 'Could not switch: {message}',
					},
				}), 'dsh-model-picker: dictionaries');

				const t = ctx.locale.bind(NS);
				// remote 面在模块求值期不可读，统一用 thunk 延迟到组件运行时。
				const sessionFace = () => ctx.remote.session;
				// 被寻址的子会话（subagent）没有独立的模型选择权，宿主自带的选择器
				// 在这种会话里直接不渲染；这里保持一致，免得选完没有效果。
				const isAddressedSubagent = (sessionId) => {
					try {
						const sessions = ctx.sessions;
						if (typeof sessions?.subagentAddress !== 'function') return false;
						return sessions.subagentAddress(sessionId) !== undefined;
					} catch { return false; }
				};
				// 本地化文本（LocalizedText = string | {en, zh, …}）：按当前语言取，
				// 取不到回落到英文。locale.getLocale() 返回的是快照对象，活动语言在 .active。
				const resolveText = (text) => {
					if (typeof text === 'string') return text;
					if (text === undefined || text === null) return undefined;
					let active = 'en';
					try {
						const snapshot = ctx.locale.getLocale();
						active = typeof snapshot === 'string' ? snapshot : (snapshot?.active ?? 'en');
					} catch { active = 'en'; }
					return text[active] ?? text[active.split('-')[0]] ?? text.en;
				};

				/* ---------- 选择器组件 ---------- */
				function ModelPicker(props) {
					const { sessionId, locked } = props;
					const useProjection = props.useProjection;

					const [open, setOpen] = useState(false);
					const [catalog, setCatalog] = useState({ status: 'idle' });
					const [hovered, setHovered] = useState(null);
					// 悬停高亮用组件状态记录，而不是只靠 CSS 的 :hover：
					//   litProvider = 左侧正在高亮的供应商行；
					//   litModel    = 右侧正在高亮的模型行。
					// 指针从供应商行移到右侧模型列表时，供应商行的 :hover 会消失，
					// 但 litProvider 不会被清掉，所以两行可以同时亮着；只有在指针
					// 离开整个面板时才一起清空。hovered 仍然只负责“右侧展示哪一家”。
					const [litProvider, setLitProvider] = useState(null);
					const [litModel, setLitModel] = useState(null);
					const [optimistic, setOptimistic] = useState(null);
					const [busy, setBusy] = useState(false);
					const [error, setError] = useState(null);
					const [pos, setPos] = useState(null);
					// dragIndex = 拖动中的预览档位；dragging = 指针真的在滑条上移动过。
					// 二者分开：只点一下（没移动）时拖拽态不成立，颜色条才能平滑地
					// 过渡一次；真的拖动时关掉过渡，指针到哪画到哪。
					const [dragIndex, setDragIndex] = useState(null);
					const [dragging, setDragging] = useState(false);

					const rootRef = useRef(null);
					const triggerRef = useRef(null);
					const layerRef = useRef(null);
					const trackRef = useRef(null);

					// 本会话已选中的模型（宿主投影）。投影里的 next 是“刚切、还没发出去”
					// 的那一个，优先级高于目录默认值。
					// 注意：这里必须无条件调用，座位没给 useProjection 时用等价的空实现，
					// 否则 Hook 顺序会随 props 变化。
					const readProjection = typeof useProjection === 'function'
						? useProjection
						: () => undefined;
					const projection = readProjection('modelSelection');
					const projected = projection?.next ?? projection?.lastUsed ?? null;
					const current = optimistic ?? projected ?? catalog.value?.default ?? null;

					const groups = catalog.value?.groups ?? [];

					// 右侧展示的供应商：悬停项优先，否则是当前选中模型所属的供应商，
					// 再否则是第一个。全部派生自 state，不额外写一份，所以悬停切换时
					// 左行高亮与右侧列表在同一次渲染里一起变。
					const hoveredValid = hovered !== null && groups.some((group) => group.id === hovered);
					const activeId = hoveredValid
						? hovered
						: (current !== null && groups.some((group) => group.id === current.provider))
							? current.provider
							: groups[0]?.id;
					const activeGroup = groups.find((group) => group.id === activeId);

					const currentGroup = current === null ? undefined : groups.find((group) => group.id === current.provider);
					const currentModel = currentGroup === undefined || current === null
						? undefined
						: currentGroup.models.find((model) => model.id === current.model);

					// 思考强度属于“当前选中的模型”，不属于悬停的供应商：所以触发按钮上的
					// 思考强度只跟 current 走，鼠标在左边一列上移动时它不会跟着变。
					const currentEfforts = currentModel?.reasoning?.efforts ?? [];
					const currentEffortId = current?.reasoningEffort ?? currentModel?.reasoning?.defaultEffort;

					// 面板里的滑条同样只描述当前选中模型，和悬停的供应商无关——这样鼠标在
					// 左侧一列上滑动时，右侧下方这一块既不换内容也不改高度，面板不会跳动。
					//
					// 档位完全来自宿主目录：efforts 是各模型自己声明的可选档位，顺序就是从弱
					// 到强，每个档位一个圆点。声明了 off 的模型（例如 DeepSeek 线路）off 排在
					// 第一个，拖到最左边就是“关闭思考”；没声明 off 的模型没有这一档，最左边
					// 就是它最弱的思考档——宿主会拒绝它不支持的档位，所以这里不能凭空造一个。
					const efforts = currentEfforts;
					const effortId = currentEffortId;
					const effortCount = efforts.length;
					// 第 i 个档位在轨道上的百分比位置（只有一个档位时固定在左端）。
					const tierPercent = (index) => (effortCount > 1 ? (index / (effortCount - 1)) * 100 : 0);
					// 大滑柄半径 11px；轨道两端各内缩一个半径，滑柄与档位圆点才不会探出
					// 色条两端（之前用裸 0%~100%，最左/最右的圆点会探出渐变框）。
					const KNOB_RADIUS = 11;
					const tierLeft = (index) => `calc(${tierPercent(index)}% + ${(KNOB_RADIUS * (1 - 2 * (index / Math.max(1, effortCount - 1)))).toFixed(2)}px)`;
					// 档位英文单词：宿主给的 name 是档位 id 的首字母大写形式（如 "Xhigh"），
					// 这里对已知档位给一个统一的写法；遇到自定义档位仍用宿主给的 name。
					const tierLabel = (effort) => TIER_WORDS[effort.id] ?? effort.name ?? effort.id;
					// 行内显示的中文档位名：目录只给英文 name，这里按档位 id 本地化；
					// 遇到未知 id（自定义档位）就回落到宿主给的 name。
					const tierTitle = (effort) => {
						if (effort === undefined) return '';
						const key = `effort.${effort.id}`;
						const text = t(key);
						return text === key ? tierLabel(effort) : text;
					};
					const settledIndex = Math.max(0, effortIndexOf(efforts, effortId));
					// 拖动中的预览值也要夹在合法范围内：拖动过程中若目录刷新导致档位数变少，
					// 预览值不能越界。
					const shownIndex = Math.min(Math.max(0, dragIndex ?? settledIndex), Math.max(0, effortCount - 1));
					const knobLeft = tierLeft(shownIndex);
					const effortName = tierTitle(efforts[shownIndex]);

					const loadCatalog = useCallback(async () => {
						setCatalog((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }));
						try {
							const response = await sessionFace().modelCatalog();
							if (response?.ok !== true) throw new Error(response?.error?.message ?? 'catalog unavailable');
							setCatalog({ status: 'ready', value: response.value });
						} catch (failure) {
							setCatalog({ status: 'error', message: String(failure?.message ?? failure) });
						}
					}, []);

					// 首帧就要显示当前模型名，所以挂载即拉一次；每次打开面板再拉一次，
					// 让供应商/模型列表跟上宿主侧的变化（宿主有缓存，代价很小）。
					useEffect(() => { loadCatalog(); }, [loadCatalog]);
					useEffect(() => { if (open) loadCatalog(); }, [open, loadCatalog]);

					// 宿主投影追上来之后丢掉本地乐观值，避免它盖住之后的外部切换。
					useEffect(() => {
						if (optimistic !== null && sameRoute(projected, optimistic)) setOptimistic(null);
					}, [projected, optimistic]);

					// 定位：优先在触发按钮上方展开，上方空间不足时翻到下方。
					// 在绘制前算好，避免先出现再跳动。
					useLayoutEffect(() => {
						if (!open) { setPos(null); return; }
						const measure = () => {
							const anchor = triggerRef.current;
							if (anchor === null) return;
							const rect = anchor.getBoundingClientRect();
							const width = Math.min(RAIL_WIDTH + GAP + PANE_WIDTH, window.innerWidth - 16);
							const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
							const above = rect.top - 8;
							if (above >= 240) {
								setPos({ left, width, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(PANEL_MAX_HEIGHT, above) });
							} else {
								setPos({ left, width, top: rect.bottom + 8, maxHeight: PANEL_MAX_HEIGHT });
							}
						};
						measure();
						window.addEventListener('resize', measure);
						window.addEventListener('scroll', measure, true);
						return () => {
							window.removeEventListener('resize', measure);
							window.removeEventListener('scroll', measure, true);
						};
					}, [open]);

					// 每次打开都把展示的供应商对齐到当前选中项，而不是上次悬停的位置。
					useEffect(() => {
						if (!open) return;
						setHovered(null);
						setError(null);
						// 面板（重新）打开时不残留上一次的悬停高亮。
						setLitProvider(null);
						setLitModel(null);
					}, [open]);

					// 指针离开整个面板：所有悬停高亮一起熄灭。
					// 只清高亮，不动 hovered——右侧展示哪一家仍由 hovered/activeId 决定，
					// 关闭面板时本来就会重置，所以指针离开面板不该把列表切走。
					const clearLit = useCallback(() => {
						setLitProvider(null);
						setLitModel(null);
					}, []);

					// 点外面 / Esc 关闭。
					useEffect(() => {
						if (!open) return;
						const onPointerDown = (event) => {
							const root = rootRef.current;
							const layer = layerRef.current;
							if (root !== null && root.contains(event.target)) return;
							if (layer !== null && layer.contains(event.target)) return;
							setOpen(false);
						};
						const onKeyDown = (event) => {
							if (event.key !== 'Escape') return;
							event.stopPropagation();
							setOpen(false);
							triggerRef.current?.focus();
						};
						document.addEventListener('mousedown', onPointerDown, true);
						document.addEventListener('keydown', onKeyDown, true);
						return () => {
							document.removeEventListener('mousedown', onPointerDown, true);
							document.removeEventListener('keydown', onKeyDown, true);
						};
					}, [open]);

					const submit = useCallback(async (selection) => {
						if (sessionId === undefined || sessionId === null) return false;
						setBusy(true);
						setError(null);
						try {
							const response = await sessionFace().selectModel({
								sessionId,
								provider: selection.provider,
								model: selection.model,
								...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
							});
							if (response?.ok !== true) {
								const failure = response?.error;
								setError(failure?.code === 'session/writer-held'
									? t('error.sessionInUse')
									: t('error.action', { message: `${failure?.code ?? 'error'}: ${failure?.message ?? ''}` }));
								return false;
							}
							setOptimistic(selection);
							return true;
						} catch (failure) {
							setError(t('error.action', { message: String(failure?.message ?? failure) }));
							return false;
						} finally {
							setBusy(false);
						}
					}, [sessionId, t]);

					const chooseModel = useCallback(async (group, model) => {
						const onSameRoute = current !== null && current.provider === group.id && current.model === model.id;
						// 同一条路由下保留当前思考强度；换了模型则用该模型的默认值。
						const effort = onSameRoute ? current.reasoningEffort : model.reasoning?.defaultEffort;
						if (onSameRoute && effort === current.reasoningEffort) { setOpen(false); return; }
						const ok = await submit({
							provider: group.id,
							model: model.id,
							...(effort === undefined ? {} : { reasoningEffort: effort }),
						});
						if (ok) setOpen(false);
					}, [current, submit]);

					const chooseEffort = useCallback(async (nextEffortId) => {
						if (current === null) return;
						// 已经生效的强度不必再发一次；未显式选中时以模型默认值为准。
						if (nextEffortId === currentEffortId) return;
						await submit({ provider: current.provider, model: current.model, reasoningEffort: nextEffortId });
					}, [current, currentEffortId, submit]);

					// 滑条：按下/拖动只更新预览（dragIndex），抬起时提交一次，避免拖过
					// 每一档都发一次请求。点击某个圆点走的是同一条路径（圆点不自己处理
					// 点击，指针事件冒泡到轨道，由轨道按最近档位取整）。
					//
					// 关于“闪两下”：原来的抬起处理是先 setDragIndex(null) 再提交，于是
					// 先是预览退回旧档（第 1 次渲染），等乐观值落地又跳到新档（第 2 次
					// 渲染）；再加上 left/width 没有过渡，两次都是一步到位，看起来就是
					// 抖两下。现在改成“先提交、等值落地后再撤预览”，中间不会出现旧档
					// 那一帧；点击时保留过渡，于是颜色条只平滑地变一次。
					const indexAt = (event) => {
						const track = trackRef.current;
						if (track === null || effortCount < 2) return 0;
						const rect = track.getBoundingClientRect();
						const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
						return Math.max(0, Math.min(effortCount - 1, Math.round(ratio * (effortCount - 1))));
					};
					const onTrackPointerDown = (event) => {
						if (effortCount < 2 || busy) return;
						event.currentTarget.setPointerCapture?.(event.pointerId);
						setDragIndex(indexAt(event));
					};
					const onTrackPointerMove = (event) => {
						if (dragIndex === null) return;
						const index = indexAt(event);
						// 同一档内的细微抖动不算拖动，这样“点一下”仍然是平滑的一次过渡；
						// 真的跨档了才进入拖动态，去掉过渡让滑柄严格跟手。
						if (index === dragIndex) return;
						setDragging(true);
						setDragIndex(index);
					};
					const onTrackPointerUp = (event) => {
						if (dragIndex === null) return;
						const index = indexAt(event);
						const target = efforts[index];
						setDragging(false);
						// 没变化（或当前不可切）时直接撤预览，不必来回发请求。
						if (target === undefined || target.id === currentEffortId) {
							setDragIndex(null);
							return;
						}
						// 先提交，等乐观值/投影追上后再撤预览：中途没有“退回旧档”的一帧。
						// 清预览用函数式更新，只清自己这一次的预览——快速连点时后一次
						// 点击的预览不会被前一次的回调清掉。
						chooseEffort(target.id).finally(() => {
							setDragIndex((previous) => (previous === index ? null : previous));
						});
					};
					// 点圆点与拖动的区别只在“按下后是否继续移动”：轨道统一按最近档位取整，
					// 所以点一下圆点、拖到某个圆点、拖到两档之间，都落到同一条提交路径上。

					if (sessionId === undefined || sessionId === null) return null;
					if (isAddressedSubagent(sessionId)) return null;

					const triggerName = current === null
						? (catalog.status === 'idle' || catalog.status === 'loading' ? t('loading') : t('label.select'))
						: (currentModel?.name ?? current.model);
					const triggerBadgeText = resolveText(currentModel?.badge?.text);
					const triggerEffort = efforts.length === 0 ? undefined : tierTitle(efforts[settledIndex]);

					const layer = open && pos !== null
						? ReactDOM.createPortal(
							h('div', {
								ref: layerRef,
								className: 'dsh-mp-layer',
								style: {
									left: pos.left,
									width: pos.width,
									maxHeight: pos.maxHeight,
									...(pos.top === undefined ? { bottom: pos.bottom } : { top: pos.top }),
								},
								role: 'dialog',
								'aria-label': t('label.select'),
								// 指针离开整个面板（含两张卡片与中间缝隙）时才熄灭所有
								// 悬停高亮；在两列之间移动不会触发这里的 mouseleave，
								// 因为缝隙也在面板内。
								onMouseLeave: clearLit,
							},
								// 一级菜单：供应商。悬停即切换右侧内容。
								h('div', { className: 'dsh-mp-card dsh-mp-rail' },
									groups.length === 0
										? h('div', { className: 'dsh-mp-note' },
											catalog.status === 'error'
												? catalog.message
												: catalog.status === 'ready' ? t('emptyCatalog') : t('loading'))
										: groups.map((group) => h('button', {
											key: group.id,
											type: 'button',
											className: 'dsh-mp-row',
											// data-active 只表示“真正被选中的那一家”（带 ✓、常亮），
											// 不随悬停变化。右侧展示哪一家仍由 activeId 派生（见上）。
											'data-active': current !== null && current.provider === group.id ? 'true' : 'false',
											// data-lit 是“指针正指向这一家”的临时高亮。它由状态驱动：
											// 指针移到右侧模型列表后仍然保持，直到离开整个面板才清空。
											'data-lit': litProvider === group.id ? 'true' : 'false',
											onMouseEnter: () => {
												setHovered(group.id);
												setLitProvider(group.id);
												// 指针回到左列时，右列不该还留着上一行的亮底：
												// 右列只在指针真正停在模型列表里时才亮。
												setLitModel(null);
											},
											onFocus: () => {
												setHovered(group.id);
												setLitProvider(group.id);
											},
											onClick: () => setHovered(group.id),
										},
											h('span', { className: 'dsh-mp-row-label' }, group.name ?? group.id),
											current !== null && current.provider === group.id
												? h('span', { className: 'dsh-mp-row-check' }, h(IconCheck))
												: null,
										)),
								),
								// 二级区域：该供应商的模型列表 + 思考强度。
								h('div', { className: 'dsh-mp-card dsh-mp-pane' },
									activeGroup === undefined
										? null
										: [
											h('div', { key: 'head', className: 'dsh-mp-head' },
												h('span', { className: 'dsh-mp-head-name' }, activeGroup.name ?? activeGroup.id),
												h('span', { className: 'dsh-mp-chevron' }, h(IconChevronRight)),
											),
											h('div', { key: 'd1', className: 'dsh-mp-divider' }),
											h('div', { key: 'cap', className: 'dsh-mp-caption' }, t('menu.models')),
											h('div', { key: 'models', className: 'dsh-mp-models' },
												activeGroup.models.length === 0
													? h('div', { className: 'dsh-mp-note' }, t('empty'))
													: activeGroup.models.map((model) => {
														const selected = current !== null
															&& current.provider === activeGroup.id && current.model === model.id;
														const badgeText = resolveText(model.badge?.text);
														return h('button', {
															key: model.id,
															type: 'button',
															className: 'dsh-mp-row dsh-mp-model-row',
															'data-active': selected ? 'true' : 'false',
															// 与供应商行同一套临时高亮：指针进入即亮，
															// 指针离开面板时才随 clearLit 一起熄灭。
															'data-lit': litModel === model.id ? 'true' : 'false',
															disabled: busy,
															title: model.description ?? model.name ?? model.id,
															onMouseEnter: () => setLitModel(model.id),
															// 指针从这一行移到别的行（或滑到思考强度那一行）时熄灭自己；
															// 供应商行的高亮不受影响，左右两列互不干扰。
															// 用函数式更新并带上 id 判断：即使 mouseleave 与 mouseenter
															// 被合批到同一轮，也不会把刚点亮的新行误熄灭。
															onMouseLeave: () => setLitModel((prev) => (prev === model.id ? null : prev)),
															onFocus: () => setLitModel(model.id),
															onClick: () => { chooseModel(activeGroup, model); },
														},
															h('span', { className: 'dsh-mp-row-label' }, model.name ?? model.id),
															badgeText === undefined
																? null
																: h('span', { className: 'dsh-mp-badge', 'data-tone': model.badge?.tone ?? 'neutral' }, badgeText),
															h('span', { className: 'dsh-mp-fill' }),
															selected ? h('span', { className: 'dsh-mp-row-check' }, h(IconCheck)) : null,
														);
													}),
											),
											error === null ? null : h('div', { key: 'err', className: 'dsh-mp-error' }, error),
											efforts.length === 0 ? null : h('div', { key: 'd2', className: 'dsh-mp-divider' }),
											efforts.length === 0 ? null : h('div', { key: 'effort', className: 'dsh-mp-effort-row' },
												h('span', null, t('menu.effort')),
												h('span', { className: 'dsh-mp-effort-value' }, effortName),
											),
											efforts.length === 0 ? null : h('div', { key: 'scale', className: 'dsh-mp-scale' },
												h('div', {
													ref: trackRef,
													className: 'dsh-mp-track',
													'data-static': effortCount < 2 ? 'true' : 'false',
													// 拖拽中关掉过渡，滑柄严格跟手；点击时保留过渡，
													// 颜色条只平滑地变一次。
													'data-drag': dragging ? 'true' : 'false',
													role: 'slider',
													tabIndex: 0,
													'aria-label': t('menu.effort'),
													'aria-valuemin': 0,
													'aria-valuemax': Math.max(0, effortCount - 1),
													'aria-valuenow': shownIndex,
													'aria-valuetext': effortName,
													onPointerDown: onTrackPointerDown,
													onPointerMove: onTrackPointerMove,
													onPointerUp: onTrackPointerUp,
													onPointerCancel: onTrackPointerUp,
													onKeyDown: (event) => {
														if (effortCount < 2) return;
														if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
														event.preventDefault();
														const next = Math.max(0, Math.min(effortCount - 1,
															shownIndex + (event.key === 'ArrowLeft' ? -1 : 1)));
														const target = efforts[next];
														if (target !== undefined) chooseEffort(target.id);
													},
												},
													// 未选中的那段：用面板底色盖住渐变，于是“填充到哪”就是
													// “选到哪一档”，颜色条随档位变化。left 也走 tierLeft，
													// 与大滑柄共用同一套两端内缩的坐标，避免“段短了但圆还在”。
													h('span', {
														className: 'dsh-mp-rest',
														style: { left: knobLeft },
													}),
													// 每个档位一个小圆点（zcode 同款白色实心）。圆点不接 onClick：
													// 指针事件冒泡到轨道，由轨道按最近档位取整，
													// 所以点圆点和拖到圆点是同一条提交路径。
													// data-current = 拖动中指针所在的那一档。
													h('span', { className: 'dsh-mp-ticks' },
														efforts.map((effort, index) => h('span', {
															key: effort.id,
															className: 'dsh-mp-tick',
															'data-current': index === shownIndex ? 'true' : 'false',
															style: { left: tierLeft(index) },
														}, h('span', { className: 'dsh-mp-tick-dot' }))),
													),
													h('span', { className: 'dsh-mp-knob', style: { left: knobLeft } }),
												),
												// 圆点下方标注该档位的英文单词（Off / Low / Medium / High / Max）。
												h('div', { className: 'dsh-mp-labels' },
													efforts.map((effort, index) => h('span', {
														key: effort.id,
														className: 'dsh-mp-label',
														'data-current': index === shownIndex ? 'true' : 'false',
														'data-edge': index === 0 ? 'start' : (index === effortCount - 1 ? 'end' : 'middle'),
														style: { left: `${tierPercent(index)}%` },
													}, tierLabel(effort))),
												),
											),
										],
								),
							),
							document.body,
						)
						: null;

					return h('div', { className: 'dsh-mp-root', ref: rootRef },
						h('button', {
							ref: triggerRef,
							type: 'button',
							className: 'dsh-mp-trigger',
							disabled: locked === true,
							title: triggerName,
							'aria-haspopup': 'dialog',
							'aria-expanded': open ? 'true' : 'false',
							'aria-busy': busy ? 'true' : 'false',
							onClick: () => setOpen((previous) => !previous),
						},
							h('span', { className: 'dsh-mp-glyph' }, h(IconGlyph)),
							h('span', { className: 'dsh-mp-name' }, triggerName),
							triggerBadgeText === undefined
								? null
								: h('span', { className: 'dsh-mp-badge', 'data-tone': currentModel?.badge?.tone ?? 'neutral' }, triggerBadgeText),
							triggerEffort === undefined ? null : h('span', { className: 'dsh-mp-effort' }, triggerEffort),
							h('span', { className: 'dsh-mp-chevron' }, h(IconChevronDown)),
						),
						layer,
					);
				}

				// 3) 坐位注册：覆盖输入框工具行里的模型选择器。
				// 不声明 children——宿主自带的实现已经声明了 .label / .options，
				// 再声明一次会抛“already declared”；本组件自己渲染完整的两级面板。
				ctx.slots.inject(SEAT, () => ctx.slots.register({
					name: SEAT,
					priority: PRIORITY,
					locale: NS,
				}, ModelPicker));
			},
		};
	},
});
