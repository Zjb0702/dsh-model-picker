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
		// 偏好存储（Host 半边提供）：按「供应商 + 模型」记忆思考档位，
		// 并记住左侧供应商栏的顺序。页面重载、App 重启后仍在。
		const STATE_URL = '/api/dsh-model-picker/state';
		const STATE_SAVE_URL = '/api/dsh-model-picker/state/save';

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
/* 左侧每一行 = 拖动手柄 + 供应商按钮。点供应商按钮仍是原来的“切到这家”，
   只有按在左侧小按钮上并拖动才进入排序；手柄本身不选中任何东西。 */
.dsh-mp-rail-row { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
.dsh-mp-rail-row > .dsh-mp-row { flex: 1 1 auto; width: auto; min-width: 0; }
.dsh-mp-rail-row[data-dragging='true'] .dsh-mp-row,
.dsh-mp-rail-row[data-dragging='true'] .dsh-mp-row[data-lit='true'] {
	background: var(--dsw-alias-interactive-bg-active);
	color: var(--dsw-alias-label-primary);
}
.dsh-mp-handle {
	flex: none; width: 16px; height: 26px; padding: 0; border: 0; border-radius: 6px;
	background: transparent; color: var(--dsw-alias-label-tertiary);
	display: inline-flex; align-items: center; justify-content: center;
	cursor: grab; touch-action: none;
}
.dsh-mp-handle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dsh-mp-handle:active,
.dsh-mp-rail-row[data-dragging='true'] .dsh-mp-handle {
	cursor: grabbing; background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-state-business-primary);
}
.dsh-mp-handle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
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

/* 面板缩放：四块热区是绝对定位的透明薄片，默认 pointer-events:none——
   没被“武装”前它们对指针完全透明，划过边框既不改光标也不抢事件。
   指针在热区内静止够久（见 trackHover）才把 data-armed 置 true，
   此时才接管指针并显示对应的缩放光标与一条细提示线。 */
.dsh-mp-grip { position: absolute; z-index: 60; pointer-events: none; background: transparent; }
.dsh-mp-grip[data-armed='true'] { pointer-events: auto; }
.dsh-mp-grip::after {
	content: ''; position: absolute; border-radius: 2px; opacity: 0;
	background: var(--dsw-alias-state-business-primary); transition: opacity .12s ease;
}
.dsh-mp-grip[data-armed='true']::after { opacity: .55; }
.dsh-mp-grip[data-zone='rail-w'][data-armed='true'],
.dsh-mp-grip[data-zone='pane-w'][data-armed='true'] { cursor: col-resize; }
.dsh-mp-grip[data-zone='top'][data-armed='true'] { cursor: row-resize; }
.dsh-mp-grip[data-zone='corner'][data-armed='true'] { cursor: nwse-resize; }
.dsh-mp-grip[data-zone='rail-w']::after,
.dsh-mp-grip[data-zone='pane-w']::after { top: 10px; bottom: 10px; left: 2px; width: 1px; }
.dsh-mp-grip[data-zone='top']::after { left: 10px; right: 10px; top: 2px; height: 1px; }
.dsh-mp-grip[data-zone='corner']::after { left: 2px; top: 2px; width: 6px; height: 6px; border-radius: 2px; }
/* 缩放中的行内文案不要被选中（拖到面板外时也不会选到旁边的文字）。 */
.dsh-mp-layer[data-resizing='true'] { user-select: none; }
/* 用户手动定高之后，模型列表吃掉剩余高度，而不是固定 220px 上限。 */
.dsh-mp-layer[data-sized='true'] .dsh-mp-models { flex: 1 1 auto; max-height: none; }
.dsh-mp-layer[data-sized='true'] .dsh-mp-card { min-height: 0; }
/* 拖到很矮时宁可让两栏各自滚动，也不把思考强度滑条裁掉。 */
.dsh-mp-layer[data-sized='true'] .dsh-mp-pane { overflow-y: auto; }
/* 拖动中的尺寸读数：实时预览的辅助反馈，松手消失。 */
.dsh-mp-size-badge {
	position: absolute; right: 8px; bottom: 6px; z-index: 61; pointer-events: none;
	padding: 1px 6px; border-radius: 6px; font-size: 10px; line-height: 16px;
	color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-3);
	font-variant-numeric: tabular-nums;
}
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
		// 拖动手柄：两列小圆点（⋮⋮），只有它能把供应商行拖起来。
		const IconGrip = () => h('svg', {
			width: 8, height: 12, viewBox: '0 0 8 12', fill: 'currentColor', 'aria-hidden': 'true',
		}, [2, 6, 10].flatMap((cy) => [2, 6].map((cx) => h('circle', { key: `${cx}-${cy}`, cx, cy, r: 1 }))));

		const effortIndexOf = (efforts, id) => {
			if (id === undefined) return -1;
			return efforts.findIndex((effort) => effort.id === id);
		};
		// ---- 偏好状态（供应商顺序 + 按模型记住的思考档位） -------------------
		// #region 偏好状态辅助（纯函数；test/client-prefs.test.mjs 取这一段直接测）
		// 面板可缩放：所有边界值集中在这里，纯函数与组件共用同一套数字。
		const PANEL_LIMITS = {
			railMin: 120, railMax: 420,      // 供应商栏宽
			paneMin: 220, paneMax: 760,      // 模型栏宽
			heightMin: 180, heightMax: 660,  // 两栏共用的高度（硬约束：只有一个 height）
			margin: 8,                       // 面板与视口边缘的最小间隙
			hitWidth: 5,                     // 边框热区厚度
			corner: 12,                      // 左上角热区的横向宽度
			hoverDelayMs: 140,               // 指针在热区静止多久才切光标/提示
			hoverMoveTolerance: 4,           // 静止判定允许的抖动
			dragThreshold: 3,                // 按下后移动多少像素才真正开始缩放
		};
		// 存储里的 efforts 是 [{provider, model, effort}]；客户端只用两个小工具
		// 读写它，不假设顺序，也不依赖存储里一定有某条记录。
		const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
		const findRememberedEffort = (state, provider, model) => {
			if (state === undefined || state === null) return undefined;
			const record = state.efforts.find((item) => item.provider === provider && item.model === model);
			return record === undefined ? undefined : record.effort;
		};
		// 只有这张模型自己声明的档位才可用：换供应商、模型升级、目录变化
		// 都可能让记忆里的档位失效，这时回落到目录默认值。
		const supportsEffort = (model, effortId) => {
			if (effortId === undefined || model === undefined) return false;
			const efforts = model.reasoning?.efforts;
			if (!Array.isArray(efforts)) return false;
			return efforts.some((effort) => effort.id === effortId);
		};
		// 尺寸布局（v3 新增字段）：缺失/非法一律 null，表示沿用默认值或内容自适应。
		const normalizeLayout = (value) => {
			if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
			const num = (raw) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null);
			const layout = { railWidth: num(value.railWidth), paneWidth: num(value.paneWidth), height: num(value.height) };
			return layout.railWidth === null && layout.paneWidth === null && layout.height === null ? null : layout;
		};
		const normalizePickerState = (value) => ({
			layout: normalizeLayout(value?.layout ?? value?.panel ?? value?.size),
			providerOrder: Array.isArray(value?.providerOrder)
				? value.providerOrder.filter((id) => typeof id === 'string')
				: [],
			efforts: Array.isArray(value?.efforts)
				? value.efforts.filter((item) => item !== null && typeof item === 'object'
					&& typeof item.provider === 'string' && typeof item.model === 'string' && typeof item.effort === 'string')
					.map((item) => ({ provider: item.provider, model: item.model, effort: item.effort }))
				: [],
		});
		const rememberEffortIn = (state, provider, model, effort) => {
			const rest = state.efforts.filter((item) => !(item.provider === provider && item.model === model));
			return { ...state, efforts: [...rest, { provider, model, effort }] };
		};
		// 滑条显示哪一档、宿主当前实际用哪一档：
		//   host    = 投影里的档位（若该模型支持）否则目录默认档；
		//   display = 记忆里的档位（若该模型支持）否则 host。
		// 两者分开是必要的：重启后投影可能丢档位，而记忆仍在；显示跟记忆走，
		// “是否需要再提交一次”跟 host 比。
		const resolveEffortSelection = (selection, model, remembered) => {
			const defaultEffort = model?.reasoning?.defaultEffort;
			const host = selection !== null && supportsEffort(model, selection.reasoningEffort)
				? selection.reasoningEffort
				: defaultEffort;
			const display = supportsEffort(model, remembered) ? remembered : host;
			return { host, display };
		};
		// 点某个模型时要提交的档位：同一条路由沿用当前档位；换了模型则优先回填
		// 这个模型上次记住的档位，没有记忆（或记忆档位失效）才用目录默认值。
		const resolveSwitchEffort = (selection, providerId, model, remembered) => {
			const onSameRoute = selection !== null
				&& selection.provider === providerId && selection.model === model.id;
			if (onSameRoute) return { onSameRoute, effort: selection.reasoningEffort };
			return { onSameRoute, effort: supportsEffort(model, remembered) ? remembered : model.reasoning?.defaultEffort };
		};
		// 拖动排序的落点：把 dragId 移到 target 之前的目标位置。
		// target 用“行下标”语义（0..行数），行数表示拖到末尾。
		const moveProviderId = (order, dragId, target) => {
			const from = order.indexOf(dragId);
			if (from === -1) return order;
			const without = order.filter((id) => id !== dragId);
			const insertAt = Math.max(0, Math.min(without.length, target > from ? target - 1 : target));
			if (insertAt === from) return order;
			return [...without.slice(0, insertAt), dragId, ...without.slice(insertAt)];
		};
		// ---- 面板缩放（全部纯函数，组件只负责把结果搬到 DOM 上） ----------------
		// 热区判定：输入指针与两张卡片的矩形，输出命中的热区名。
		// 上边框两块卡片共用同一条 y 位置；左上角优先于左边框与上边框。
		//   角   = [左, 左+corner] × [上, 上+hitWidth]
		//   上边 = 任一卡片 [上, 上+hitWidth]
		//   左边 = 卡片 [左, 左+hitWidth]（整条竖直边）
		const resolveHitZone = (point, boxes, limits = PANEL_LIMITS) => {
			const { rail, pane } = boxes;
			const { x, y } = point;
			if (rail === undefined || pane === undefined) return null;
			const pad = 0.5; // 容差：边框本身有 1px 描边
			const nearTop = y >= rail.top - pad && y <= rail.top + limits.hitWidth;
			if (nearTop && x >= rail.left - pad && x <= rail.left + limits.corner) return 'corner';
			const insideX = (box) => x >= box.left - pad && x <= box.left + box.width + pad;
			if (nearTop && (insideX(rail) || insideX(pane))) return 'top';
			const insideY = (box) => y >= box.top - pad && y <= box.top + box.height + pad;
			if (insideY(rail) && x >= rail.left - pad && x <= rail.left + limits.hitWidth) return 'rail-w';
			if (insideY(pane) && x >= pane.left - pad && x <= pane.left + limits.hitWidth) return 'pane-w';
			return null;
		};
		// 各热区的光标形态；拖动中被 document.body 固定住，松手才恢复。
		const panelCursor = (zone) => {
			if (zone === null || zone === undefined) return undefined;
			if (zone === 'corner') return 'nwse-resize';
			if (zone === 'rail-w' || zone === 'pane-w') return 'col-resize';
			if (zone === 'top') return 'row-resize';
			return undefined;
		};
		// 悬停武装：指针在热区内静止到超过延迟阈值，才允许切光标/提示。
		// state = { zone, since, x, y }；快速扫过（还没到时间就离开）不会命中。
		const shouldArmHover = (state, now, limits = PANEL_LIMITS) => state !== null
			&& state !== undefined
			&& now - state.since >= limits.hoverDelayMs;
		// 指针在等待期间移动超过容差：重新计时，避免“边扫边亮”。
		const hoverNeedsRestart = (state, point, limits = PANEL_LIMITS) => state !== null
			&& state !== undefined
			&& Math.max(Math.abs(point.x - state.x), Math.abs(point.y - state.y)) > limits.hoverMoveTolerance;
		// 按下后是否够格进入拖动：没超过阈值只算一次普通点击，不改尺寸。
		const exceedsDragThreshold = (dx, dy, limits = PANEL_LIMITS) => Math.hypot(dx, dy) >= limits.dragThreshold;
		// 当前该“武装”哪个热区（显示光标 + 提示线）。
		// 优先级：按下中 > 拖动中 > 悬停武装。按下时由 pressingZone 直接接管，
		// 不从悬停态先清空再重建，所以“进入热区 → 按下 → 拖动 → 松手”全程连续。
		const resolveArmedZone = (pressingZone, resizingZone, hoverZone) => pressingZone
			?? resizingZone
			?? hoverZone
			?? null;
		// 拖动量先收敛到“边框还能跟手”的范围：被拖的边框到达上下限时，
		// 多余位移直接丢掉，而不是让尺寸继续变、边框却停在原处。
		const clampDragDelta = (zone, base, dx, dy) => {
			const limits = PANEL_LIMITS;
			let nextDx = dx;
			let nextDy = dy;
			if (zone === 'rail-w' || zone === 'corner') {
				// 左边缘不能越过视口左边界；供应商栏宽度的上下限
				nextDx = clampNumber(dx, Math.max(limits.margin - (base.left ?? 0), base.railWidth - limits.railMax),
					base.railWidth - limits.railMin);
			} else if (zone === 'pane-w') {
				// 分栏：供应商栏与模型栏都不能越过各自上下限
				const lower = Math.max(limits.railMin - base.railWidth, base.paneWidth - limits.paneMax);
				const upper = Math.min(limits.railMax - base.railWidth, base.paneWidth - limits.paneMin);
				nextDx = clampNumber(dx, Math.min(lower, upper), Math.max(lower, upper));
			}
			if (zone === 'top' || zone === 'corner') {
				// 高度上下限（展开侧可用空间由 resolvePanelBox 再兜一次底）
				const lower = limits.heightMin - base.height;
				const upper = limits.heightMax - base.height;
				nextDy = clampNumber(dy, Math.min(lower, upper), Math.max(lower, upper));
			}
			return { dx: nextDx, dy: nextDy };
		};
		// 拖动量换算：dx/dy 是相对按下点的位移，向左/向上为负。
		//   - 供应商栏左边框 / 左上角：面板左边缘跟着指针走（left += dx），
		//     供应商栏宽度反向变化，右侧内容原地不动——被拖的边框始终在指针下。
		//   - 模型栏左边框（分栏边界）：总宽不变，供应商栏宽度补偿 dx，
		//     模型栏宽度反向变化，于是边界跟着指针、两侧外边缘都不动。
		//   - 上边框 / 左上角：只有 height 变化；四种手势写的是同一个 height，
		//     两栏高度因此永远一致（不存在“只改一栏高度”的入口）。
		const applyResizeDelta = (zone, base, dx, dy) => {
			const left = base.left ?? 0;
			const railWidth = zone === 'rail-w' || zone === 'corner'
				? base.railWidth - dx
				: zone === 'pane-w'
					? base.railWidth + dx
					: base.railWidth;
			const paneWidth = zone === 'pane-w' ? base.paneWidth - dx : base.paneWidth;
			return {
				left: zone === 'rail-w' || zone === 'corner' ? left + dx : left,
				railWidth,
				paneWidth,
				height: zone === 'top' || zone === 'corner' ? base.height - dy : base.height,
			};
		};
		// 边界钳制 + 定位：把期望尺寸收敛成实际可用的尺寸与坐标。
		// 返回的 height 只有一个：两栏由 flex stretch 共享同一高度，这是硬约束的结构保证。
		const resolvePanelBox = (input) => {
			const limits = PANEL_LIMITS;
			const gap = input.gap ?? GAP;
			const margin = limits.margin;
			const viewportWidth = Math.max(320, input.viewportWidth);
			const viewportHeight = Math.max(240, input.viewportHeight);
			const maxTotalWidth = Math.max(limits.railMin + gap + limits.paneMin, viewportWidth - margin * 2);
			let rail = clampNumber(Number(input.railWidth) || RAIL_WIDTH, limits.railMin, limits.railMax);
			let pane = clampNumber(Number(input.paneWidth) || PANE_WIDTH, limits.paneMin, limits.paneMax);
			// 总宽超出视口时先收模型栏（内容更容易压缩），仍不够再收供应商栏。
			if (rail + gap + pane > maxTotalWidth) {
				pane = Math.max(limits.paneMin, maxTotalWidth - gap - rail);
				if (rail + gap + pane > maxTotalWidth) rail = Math.max(limits.railMin, maxTotalWidth - gap - pane);
			}
			const width = rail + gap + pane;
			const left = clampNumber(
				input.triggerLeft ?? margin,
				margin,
				Math.max(margin, viewportWidth - width - margin),
			);
			// 上下可用空间：空间不足时改用另一侧，任何一侧都放不下就取较大的一侧。
			// 下方展开时上边缘是可以被拖动的（triggerBottom 里已经带上拖动偏移），
			// 可用高度按“上边缘到视口底部”算，面板才不会从下面溢出去。
			const spaceAbove = Math.max(0, (input.triggerTop ?? viewportHeight) - margin);
			const preferAbove = input.preferAbove ?? ((input.triggerTop ?? viewportHeight) >= viewportHeight / 2);
			const top = preferAbove ? null : Math.max(margin, (input.triggerBottom ?? 0) + margin);
			const spaceBelow = Math.max(0, viewportHeight - margin - (top ?? viewportHeight));
			const space = preferAbove ? spaceAbove : spaceBelow;
			const maxHeight = Math.max(120, Math.min(limits.heightMax, space));
			const height = input.height === null || input.height === undefined
				? null
				: clampNumber(input.height, Math.min(limits.heightMin, maxHeight), maxHeight);
			return {
				railWidth: rail,
				paneWidth: pane,
				width,
				left,
				height,
				maxHeight,
				// 上方展开时底边钉住触发按钮上沿（高度增加只向上长）；下方展开时顶边钉住
				// （drag 偏移由 triggerBottom 带入，从而上边框也能跟手，底边位置保持不变）。
				top,
				bottom: preferAbove ? viewportHeight - (input.triggerTop ?? viewportHeight) + margin : null,
			};
		};
		// 目录顺序 + 记忆顺序 = 左侧实际顺序：记忆里还存在的供应商按记忆排序，
		// 目录里新出现的（或记忆里已删除的）按目录顺序接在后面。
		const orderedGroupsOf = (groups, state) => {
			const byId = new Map(groups.map((group) => [group.id, group]));
			const ordered = [];
			for (const id of state.providerOrder) {
				const group = byId.get(id);
				if (group === undefined) continue;
				ordered.push(group);
				byId.delete(id);
			}
			for (const group of groups) {
				if (byId.has(group.id)) ordered.push(group);
			}
			return ordered;
		};
		// 读回来的尺寸和本地缓存二选一：Host 有记录就以 Host 为准（它才是跨重启的
		// 权威来源），Host 说“没有记录”时才退回本页缓存——这样 Host 半边暂时不可用
		// 时，宽高也不会在切换会话或刷新页面后被打回默认值。
		const preferLayout = (cached, loaded) => (loaded === null || loaded === undefined ? cached ?? null : loaded);
		// #endregion
		// 尺寸缓存：Host 的 state.json 是唯一的跨重启来源，但读它是异步的。
		// 组件重挂载（切换会话）时先用内存缓存同步渲染，避免“先跳回默认尺寸再
		// 跳回来”；Host 暂时不可用时（路由缺失、请求被拒），本地缓存还能让宽高
		// 在刷新页面、切换会话后保持原样。
		const LAYOUT_CACHE_KEY = 'dsh-model-picker/layout';
		let cachedLayout;
		let cachedLayoutRead = false;
		const readLayoutCache = () => {
			if (cachedLayoutRead) return cachedLayout;
			cachedLayoutRead = true;
			try {
				const raw = window.localStorage.getItem(LAYOUT_CACHE_KEY);
				cachedLayout = raw === null ? null : normalizeLayout(JSON.parse(raw));
			} catch {
				cachedLayout = null;
			}
			return cachedLayout;
		};
		const writeLayoutCache = (layout) => {
			const value = normalizeLayout(layout ?? null);
			cachedLayout = value;
			cachedLayoutRead = true;
			try {
				if (value === null) window.localStorage.removeItem(LAYOUT_CACHE_KEY);
				else window.localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(value));
			} catch {
				/* 本地缓存不可用时只失去“Host 缺席期间”的记忆 */
			}
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
						'handle.title': '拖动调整供应商顺序',
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
						'handle.title': 'Drag to reorder providers',
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
				// 偏好存储走 Host 半边注册的同源回环路由。存储不可用（例如 Host 半边
				// 还是旧版本、路由没注册）时静默降级为“不记忆”：选择模型本身不受影响。
				// Host 刚重启、插件半边还在注册路由时，第一次请求可能落空；
				// 轻量重试一次即可，不做无限退避（存储不可用要静默降级，不能拖慢选择）。
				const withRetry = async (run, attempts = 2, delayMs = 300) => {
					let lastError;
					for (let attempt = 0; attempt < attempts; attempt += 1) {
						try {
							return await run();
						} catch (error) {
							lastError = error;
							if (attempt < attempts - 1) {
								await new Promise((resolve) => { setTimeout(resolve, delayMs * (attempt + 1)); });
							}
						}
					}
					throw lastError;
				};
				const readPickerState = async () => {
					const body = await withRetry(async () => {
						const response = await fetch(STATE_URL, {
							headers: { accept: 'application/json' },
							credentials: 'same-origin',
						});
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return await response.json();
					});
					return normalizePickerState(body?.state);
				};
				const savePickerState = async (patch) => {
					const body = await withRetry(async () => {
						const response = await fetch(STATE_SAVE_URL, {
							method: 'PUT',
							headers: { 'content-type': 'application/json', accept: 'application/json' },
							credentials: 'same-origin',
							body: JSON.stringify(patch),
						});
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return await response.json();
					});
					return normalizePickerState(body?.state);
				};
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
					// 面板锚点：只记触发按钮的位置与展开方向；尺寸与坐标由 resolvePanelBox 现算。
					const [anchor, setAnchor] = useState(null);
					const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
					// size = 用户拖出来的尺寸；某一维为 null 表示还没拖过
					// （宽走 RAIL_WIDTH/PANE_WIDTH 默认值，高走内容自适应）。
					// 初值直接取缓存：切换会话会重新挂载组件，这一帧就要按上次的宽高渲染，
					// 否则会先闪一下默认尺寸。Host 的权威值稍后异步覆盖。
					const [size, setSize] = useState(() => ({
						left: null, railWidth: null, paneWidth: null, height: null, shift: 0, ...(readLayoutCache() ?? {}),
					}));
					// hoverZone = 悬停武装的热区（光标与提示线已出现）；pressingZone = 鼠标按住的
					// 热区（按下即接管提示，未到拖动阈值也算）；resizingZone = 真正在拖的热区。
					// 三者合成一个“当前武装态”，避免按下瞬间把提示清空又重建（会闪一下）。
					const [hoverZone, setHoverZone] = useState(null);
					const [pressingZone, setPressingZone] = useState(null);
					const [resizingZone, setResizingZone] = useState(null);
					// dragIndex = 拖动中的预览档位；dragging = 指针真的在滑条上移动过。
					// 二者分开：只点一下（没移动）时拖拽态不成立，颜色条才能平滑地
					// 过渡一次；真的拖动时关掉过渡，指针到哪画到哪。
					const [dragIndex, setDragIndex] = useState(null);
					const [dragging, setDragging] = useState(false);
					// 偏好：从 Host 侧存储读入（供应商顺序 + 按模型记的档位）。
					const [pickerState, setPickerState] = useState({ layout: null, providerOrder: [], efforts: [] });
					// 供应商拖动排序：dragId = 正在拖的那一家；liveOrder = 拖动中的
					// 临时顺序（松手才落盘，中途取消就丢弃预览）。
					const [dragId, setDragId] = useState(null);
					const [liveOrder, setLiveOrder] = useState(null);

					const rootRef = useRef(null);
					const triggerRef = useRef(null);
					const layerRef = useRef(null);
					const trackRef = useRef(null);
					const railRef = useRef(null);
					const paneRef = useRef(null);
					// 本页是否已经拖过尺寸：拖过之后，重新打开时读回来的旧布局不再覆盖当前值。
					const sizeTouchedRef = useRef(false);
					// 缩放的按下候选：{ zone, startX, startY, base, active }；未超阈值时只是普通点击。
					const resizeRef = useRef(null);
					// 悬停候选：{ zone, since, x, y }；用于“静止够久才武装”的判定。
					const hoverRef = useRef(null);
					const hoverTimerRef = useRef(null);
					// 拖动排序时记录指针 id 与拖动中的顺序快照；松手时用它判断是否有变化。
					const dragRef = useRef({ pointerId: null, order: null, start: null });

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
					// 左侧实际顺序：记忆顺序在前，目录里新出现的按目录顺序接在后面。
					const orderedGroups = orderedGroupsOf(groups, pickerState);
					// 拖动过程中显示预览顺序；松手或取消后回到已保存的顺序。
					const railGroups = liveOrder === null
						? orderedGroups
						: liveOrder
							.map((id) => groups.find((group) => group.id === id))
							.filter((group) => group !== undefined);

					// 右侧展示的供应商：悬停项优先，否则是当前选中模型所属的供应商，
					// 再否则是第一个。全部派生自 state，不额外写一份，所以悬停切换时
					// 左行高亮与右侧列表在同一次渲染里一起变。
					const hoveredValid = hovered !== null && groups.some((group) => group.id === hovered);
					const activeId = hoveredValid
						? hovered
						: (current !== null && groups.some((group) => group.id === current.provider))
							? current.provider
							: orderedGroups[0]?.id;
					const activeGroup = groups.find((group) => group.id === activeId);

					const currentGroup = current === null ? undefined : groups.find((group) => group.id === current.provider);
					const currentModel = currentGroup === undefined || current === null
						? undefined
						: currentGroup.models.find((model) => model.id === current.model);

					// 思考强度属于“当前选中的模型”，不属于悬停的供应商：所以触发按钮上的
					// 思考强度只跟 current 走，鼠标在左边一列上移动时它不会跟着变。
					const currentEfforts = currentModel?.reasoning?.efforts ?? [];
					// 宿主投影只记录“当前这一次选择”的档位，换模型后不保留旧模型的；
					// 插件按「供应商 + 模型」自己记住用户上次显式选的档位（pickerState），
					// 从没选过的模型才回落到目录默认值。
					const rememberedEffortId = current === null
						? undefined
						: findRememberedEffort(pickerState, current.provider, current.model);
					const effortSelection = resolveEffortSelection(current, currentModel, rememberedEffortId);
					const hostEffortId = effortSelection.host;
					const currentEffortId = effortSelection.display;

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
					// 读回来的偏好里也带着尺寸：只有本页还没拖过尺寸时才套用。
					const applyLoadedState = useCallback((value) => {
						setPickerState(value);
						// Host 给的就是权威值；Host 说“没有记录”时才退回本页缓存。
						const layout = preferLayout(readLayoutCache(), value.layout);
						if (layout === null) return;
						if (layout !== value.layout) writeLayoutCache(layout);
						if (sizeTouchedRef.current) return;
						// 只套用宽高；水平偏移是本次会话里被拖出来的，不持久化。
						setSize((previous) => ({
							...previous,
							railWidth: layout.railWidth,
							paneWidth: layout.paneWidth,
							height: layout.height,
						}));
					}, []);

					useEffect(() => { loadCatalog(); }, [loadCatalog]);
					useEffect(() => { if (open) loadCatalog(); }, [open, loadCatalog]);

					// 偏好（供应商顺序 + 档位记忆）挂载即读一次，之后每次打开面板再读，
					// 这样别的窗口刚写进去的顺序/档位也能及时反映到这边。
					useEffect(() => {
						let alive = true;
						readPickerState()
							.then((value) => { if (alive) applyLoadedState(value); })
							.catch(() => { /* 存储不可用时保持刚打开时的空偏好 */ });
						return () => { alive = false; };
					}, [applyLoadedState]);

					useEffect(() => {
						if (!open) return;
						readPickerState()
							.then((value) => applyLoadedState(value))
							.catch(() => { /* 同上 */ });
					}, [open, applyLoadedState]);

					// 宿主投影追上来之后丢掉本地乐观值，避免它盖住之后的外部切换。
					useEffect(() => {
						if (optimistic !== null && sameRoute(projected, optimistic)) setOptimistic(null);
					}, [projected, optimistic]);

					// 定位：优先在触发按钮上方展开，上方放不下最小高度时翻到下方。
					// 这里只记锚点；尺寸变化时坐标由 resolvePanelBox 现算，面板不会被拖出视口。
					useLayoutEffect(() => {
						if (!open) { setAnchor(null); return; }
						const measure = () => {
							const trigger = triggerRef.current;
							if (trigger === null) return;
							const rect = trigger.getBoundingClientRect();
							setViewport({ width: window.innerWidth, height: window.innerHeight });
							setAnchor({
								left: rect.left,
								triggerTop: rect.top,
								triggerBottom: rect.bottom,
								preferAbove: rect.top - PANEL_LIMITS.margin >= PANEL_LIMITS.heightMin,
							});
						};
						measure();
						window.addEventListener('resize', measure);
						window.addEventListener('scroll', measure, true);
						return () => {
							window.removeEventListener('resize', measure);
							window.removeEventListener('scroll', measure, true);
						};
					}, [open]);

					// 实际尺寸与坐标：用户尺寸先过钳制、再按锚点落位。渲染与拖动共用这一个真值。
					const box = anchor === null ? null : resolvePanelBox({
						railWidth: size.railWidth ?? RAIL_WIDTH,
						paneWidth: size.paneWidth ?? PANE_WIDTH,
						height: size.height,
						gap: GAP,
						viewportWidth: viewport.width,
						viewportHeight: viewport.height,
						// 供应商栏左边框被拖过后，面板整体跟着平移；否则仍钉在触发按钮左侧。
						triggerLeft: size.left ?? anchor.left,
						triggerTop: anchor.triggerTop,
						// 下方展开时上边缘可被拖动：偏移只影响“上边缘到视口底部”的可用高度。
						triggerBottom: anchor.triggerBottom + (anchor.preferAbove ? 0 : size.shift),
						preferAbove: anchor.preferAbove,
					});

					// 缩放热区判定以真实 DOM 矩形为准（纯函数 resolveHitZone 负责具体判定）。
					const zoneAt = useCallback((event) => {
						const rail = railRef.current;
						const pane = paneRef.current;
						if (rail === null || pane === null) return null;
						const railRect = rail.getBoundingClientRect();
						const paneRect = pane.getBoundingClientRect();
						return resolveHitZone(
							{ x: event.clientX, y: event.clientY },
							{
								rail: { left: railRect.left, top: railRect.top, width: railRect.width, height: railRect.height },
								pane: { left: paneRect.left, top: paneRect.top, width: paneRect.width, height: paneRect.height },
							},
						);
					}, []);

					const clearHoverTimer = useCallback(() => {
						if (hoverTimerRef.current !== null) {
							window.clearTimeout(hoverTimerRef.current);
							hoverTimerRef.current = null;
						}
					}, []);
					const disarmHover = useCallback(() => {
						clearHoverTimer();
						hoverRef.current = null;
						// 值没变时 React 会跳过更新，所以指针在面板里移动不会每帧重渲染。
						setHoverZone((previous) => (previous === null ? previous : null));
					}, [clearHoverTimer]);

					// 悬停武装：指针在热区内“静止”够 hoverDelayMs 才切光标。
					// 移动超过 hoverMoveTolerance 会重新计时，所以快速划过边框既不改光标，也不进入拖动。
					const scheduleArm = useCallback(() => {
						clearHoverTimer();
						const arm = () => {
							hoverTimerRef.current = null;
							const state = hoverRef.current;
							if (state === null) return;
							const now = Date.now();
							if (shouldArmHover(state, now)) {
								setHoverZone(state.zone);
								return;
							}
							// 计时器到点时指针刚微调过（窗口被重置）：补一次剩余等待，别让热区“卡死”。
							hoverTimerRef.current = window.setTimeout(
								arm,
								Math.max(16, state.since + PANEL_LIMITS.hoverDelayMs - now),
							);
						};
						hoverTimerRef.current = window.setTimeout(arm, PANEL_LIMITS.hoverDelayMs);
					}, [clearHoverTimer]);
					const trackHover = useCallback((event) => {
						if (resizeRef.current !== null) return; // 拖动中由拖动态自己管光标
						const zone = zoneAt(event);
						if (zone === null) { disarmHover(); return; }
						const candidate = hoverRef.current;
						if (candidate === null || candidate.zone !== zone) {
							hoverRef.current = { zone, since: Date.now(), x: event.clientX, y: event.clientY };
							setHoverZone((previous) => (previous === null ? previous : null));
							scheduleArm();
							return;
						}
						if (hoverNeedsRestart(candidate, { x: event.clientX, y: event.clientY })) {
							candidate.since = Date.now();
							candidate.x = event.clientX;
							candidate.y = event.clientY;
							setHoverZone((previous) => (previous === null ? previous : null));
							scheduleArm();
						}
					}, [disarmHover, zoneAt, scheduleArm]);

					// 按在热区上：只记一个候选，指针移动超过阈值才真正开始缩放；
					// 没移动的单击不改变任何尺寸（也不会把面板关掉）。
					const beginResize = useCallback((event) => {
						if (event.button !== undefined && event.button !== 0) return;
						// 保险：排序手柄所在的左上角永远不参与缩放判定，排序手势不受影响。
						if (event.target instanceof Element && event.target.closest('.dsh-mp-handle') !== null) return;
						const zone = zoneAt(event);
						if (zone === null) return;
						const rail = railRef.current;
						const pane = paneRef.current;
						if (rail === null || pane === null) return;
						const railRect = rail.getBoundingClientRect();
						const paneRect = pane.getBoundingClientRect();
						const layerRect = layerRef.current === null ? null : layerRef.current.getBoundingClientRect();
						event.preventDefault();
						event.stopPropagation();
						// 提示不在这里清：按下态直接接管武装态（clearHoverTimer 只停掉尚未到点的计时器，
						// hoverZone 留着，等松手时再按指针是否还在热区里决定收回还是保持）。
						clearHoverTimer();
						setPressingZone(zone);
						resizeRef.current = {
							zone,
							pointerId: event.pointerId,
							startX: event.clientX,
							startY: event.clientY,
							base: {
								left: box === null ? 0 : box.left,
								railWidth: railRect.width,
								paneWidth: paneRect.width,
								// 高度取当前实际高度：内容自适应的面板也能从“现在这么高”开始拖。
								height: layerRect === null ? PANEL_LIMITS.heightMin : layerRect.height,
							},
							// 用户已保存的高度（null = 还没定高）；只拖宽度的手势要原样带回去。
							storedHeight: size.height,
							// 下方展开时上边缘的既有偏移：拖动量要在这个基础上累加。
							shift0: size.shift,
							active: false,
						};
					}, [clearHoverTimer, zoneAt, size.height, box]);

					// 拖动：候选/拖动都在窗口级监听，指针移出面板也继续跟手；松手才落地并保存。
					useEffect(() => {
						// 松手：把“按下态”交回悬停态。指针还在热区里就保持武装（不闪一下），
						// 已经离开才按既有规则收回；之后才判断这次是否真的拖动过。
						const settleArmedZone = (event) => {
							setPressingZone(null);
							const inside = event !== undefined
								&& event !== null
								&& typeof event.clientX === 'number'
								&& typeof event.clientY === 'number';
							if (!inside) { disarmHover(); return; }
							const zone = zoneAt(event);
							if (zone === null) { disarmHover(); return; }
							// 指针原地不动：把候选重置成“刚进入”，后续若再移动仍按 140ms 规则重新武装。
							hoverRef.current = { zone, since: Date.now(), x: event.clientX, y: event.clientY };
							setHoverZone((previous) => (previous === zone ? previous : zone));
						};
						const finishResize = (event) => {
							const drag = resizeRef.current;
							resizeRef.current = null;
							settleArmedZone(event);
							if (drag === null || !drag.active) return;
							setResizingZone(null);
							const delta = clampDragDelta(drag.zone, drag.base, drag.lastDx ?? 0, drag.lastDy ?? 0);
							const desired = applyResizeDelta(drag.zone, drag.base, delta.dx, delta.dy);
							const changesHeight = drag.zone === 'top' || drag.zone === 'corner';
							const shift = changesHeight && anchor?.preferAbove === false ? drag.shift0 + delta.dy : 0;
							const settled = resolvePanelBox({
								...desired,
								gap: GAP,
								viewportWidth: window.innerWidth,
								viewportHeight: window.innerHeight,
								triggerLeft: desired.left,
								triggerTop: anchor?.triggerTop,
								triggerBottom: (anchor?.triggerBottom ?? 0) + shift,
								preferAbove: anchor?.preferAbove,
							});
							const layout = {
								railWidth: settled.railWidth,
								paneWidth: settled.paneWidth,
								// 只拖宽度的手势不写高度：保留“未定高/已定高”的原状。
								height: changesHeight ? settled.height : drag.storedHeight,
							};
							setSize((previous) => ({
								left: settled.left,
								railWidth: layout.railWidth,
								paneWidth: layout.paneWidth,
								height: changesHeight ? settled.height : previous.height,
								shift,
							}));
							// 先写本页缓存（同步、不依赖 Host）：切会话/刷新立刻就能拿到，
							// 再把同一份布局交给 Host 落盘，才是跨重启的那一层。
							writeLayoutCache(layout);
							// 尺寸落盘失败只影响“重启后还记不记得”，不影响这次拖动本身。
							void savePickerState({ layout })
								.then((value) => setPickerState(value))
								.catch(() => { /* 静默降级为不记忆尺寸（本页缓存仍然有效） */ });
						};
						const move = (event) => {
							const drag = resizeRef.current;
							if (drag === null) return;
							const rawDx = event.clientX - drag.startX;
							const rawDy = event.clientY - drag.startY;
							if (!drag.active) {
								if (!exceedsDragThreshold(rawDx, rawDy)) return;
								drag.active = true;
								sizeTouchedRef.current = true;
								setResizingZone(drag.zone);
							}
							const delta = clampDragDelta(drag.zone, drag.base, rawDx, rawDy);
							drag.lastDx = delta.dx;
							drag.lastDy = delta.dy;
							const desired = applyResizeDelta(drag.zone, drag.base, delta.dx, delta.dy);
							const changesHeight = drag.zone === 'top' || drag.zone === 'corner';
							// 下方展开时，上边框跟手的做法是“上边缘下移 dy、高度少 dy”，底边不动；
							// 上方展开时上边缘本来就是高度变化的自然结果，偏移恒为 0。
							const shift = changesHeight && anchor?.preferAbove === false ? drag.shift0 + delta.dy : 0;
							const next = resolvePanelBox({
								...desired,
								gap: GAP,
								viewportWidth: window.innerWidth,
								viewportHeight: window.innerHeight,
								triggerLeft: desired.left,
								triggerTop: anchor?.triggerTop,
								triggerBottom: (anchor?.triggerBottom ?? 0) + shift,
								preferAbove: anchor?.preferAbove,
							});
							setSize((previous) => ({
								// 左边缘被视口夹住时以夹紧后的坐标为准，边框不会越界。
								left: next.left,
								railWidth: next.railWidth,
								paneWidth: next.paneWidth,
								// 只拖宽度时保持“还没定高”的状态，不把内容自适应变成固定高度。
								height: changesHeight ? next.height : previous.height,
								shift,
							}));
						};
						window.addEventListener('pointermove', move, true);
						window.addEventListener('pointerup', finishResize, true);
						window.addEventListener('pointercancel', finishResize, true);
						// 指针在浏览器窗口外松开（拿不到 pointerup）时，失焦也要把这次拖动收尾。
						window.addEventListener('blur', finishResize);
						return () => {
							window.removeEventListener('pointermove', move, true);
							window.removeEventListener('pointerup', finishResize, true);
							window.removeEventListener('pointercancel', finishResize, true);
							window.removeEventListener('blur', finishResize);
						};
					}, [anchor, zoneAt, disarmHover]);

					// 拖动中把光标钉在 body 上：经过任意按钮/文本都不变形，松手恢复。
					useEffect(() => {
						if (resizingZone === null) return;
						const cursor = panelCursor(resizingZone);
						if (cursor === undefined) return;
						const previous = document.body.style.cursor;
						document.body.style.cursor = cursor;
						return () => { document.body.style.cursor = previous; };
					}, [resizingZone]);

					// 每次打开都把展示的供应商对齐到当前选中项，而不是上次悬停的位置。
					useEffect(() => {
						if (!open) return;
						setHovered(null);
						setError(null);
						// 面板（重新）打开时不残留上一次的悬停高亮。
						setLitProvider(null);
						setLitModel(null);
						// 上边缘被拖出来的偏移只是本次预览的位置，重新打开回到锚点。
						setSize((previous) => (previous.shift === 0 ? previous : { ...previous, shift: 0 }));
					}, [open]);

					// 面板关闭时清掉缩放/悬停的临时态（例如拖动中按 Esc 关掉面板）。
					useEffect(() => {
						if (open) return;
						resizeRef.current = null;
						clearHoverTimer();
						hoverRef.current = null;
						setHoverZone((previous) => (previous === null ? previous : null));
						setPressingZone((previous) => (previous === null ? previous : null));
						setResizingZone((previous) => (previous === null ? previous : null));
					}, [open, clearHoverTimer]);

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

					// 记忆写入：先在内存里更新（本页立刻生效），再异步落盘 Host 存储。
					// 落盘失败只影响“重开之后还记不记得”，不影响这次选择本身。
					const persistPickerPatch = useCallback((patch) => {
						void savePickerState(patch)
							.then((value) => setPickerState(value))
							.catch(() => { /* 存储不可用：保留内存里的记忆 */ });
					}, []);
					const rememberEffort = useCallback((provider, model, effortId) => {
						setPickerState((previous) => rememberEffortIn(previous, provider, model, effortId));
						persistPickerPatch({ effort: { provider, model, effort: effortId } });
					}, [persistPickerPatch]);
					const persistOrder = useCallback((ids) => {
						setPickerState((previous) => ({ ...previous, providerOrder: ids }));
						persistPickerPatch({ providerOrder: ids });
					}, [persistPickerPatch]);

					const chooseModel = useCallback(async (group, model) => {
						// 换了模型时优先回填“这个模型上次记住的档位”；没有记忆才用目录默认值。
						// 同一条路由下保留当前档位不变（见 resolveSwitchEffort）。
						const remembered = findRememberedEffort(pickerState, group.id, model.id);
						const { onSameRoute, effort } = resolveSwitchEffort(current, group.id, model, remembered);
						if (onSameRoute && effort === current.reasoningEffort) { setOpen(false); return; }
						const ok = await submit({
							provider: group.id,
							model: model.id,
							...(effort === undefined ? {} : { reasoningEffort: effort }),
						});
						if (ok) setOpen(false);
					}, [current, pickerState, submit]);

					const chooseEffort = useCallback(async (nextEffortId) => {
						if (current === null) return;
						const provider = current.provider;
						const model = current.model;
						// 宿主已经生效的档位不必再发一次；但记忆里若是别的档位（例如
						// 上次重启后宿主投影丢了档位），仍然要把它写进记忆。
						if (nextEffortId === hostEffortId) {
							if (findRememberedEffort(pickerState, provider, model) !== nextEffortId) {
								rememberEffort(provider, model, nextEffortId);
							}
							return;
						}
						// 先提交，成功后再记忆：失败时记忆不该领先于实际生效值。
						const ok = await submit({ provider, model, reasoningEffort: nextEffortId });
						if (ok) rememberEffort(provider, model, nextEffortId);
					}, [current, hostEffortId, pickerState, submit, rememberEffort]);

					// 供应商拖动排序：只有按在手柄上才开始拖。移动中按指针位置算插入点、
					// 更新预览顺序；松手才写盘；Escape 取消（不写盘）。
					const beginProviderDrag = (event, groupId) => {
						if (event.button !== undefined && event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						const order = orderedGroups.map((group) => group.id);
						dragRef.current = { pointerId: event.pointerId, order, start: order };
						setDragId(groupId);
						setLiveOrder(order);
						setHovered(null);
						setLitProvider(null);
						setLitModel(null);
						event.currentTarget.setPointerCapture?.(event.pointerId);
					};
					const moveProviderDrag = (event) => {
						const drag = dragRef.current;
						if (dragId === null || drag.pointerId !== event.pointerId) return;
						const rail = railRef.current;
						if (rail === null) return;
						const rows = Array.from(rail.querySelectorAll('[data-provider-row]'));
						if (rows.length === 0) return;
						// 指针越过某一行中点，就插到那一行的位置（最后一行之下则落到末尾）。
						let target = rows.length;
						for (let index = 0; index < rows.length; index += 1) {
							const rect = rows[index].getBoundingClientRect();
							if (event.clientY < rect.top + rect.height / 2) { target = index; break; }
						}
						setLiveOrder((previous) => {
							if (previous === null) return previous;
							const next = moveProviderId(previous, dragId, target);
							if (next === previous) return previous;
							drag.order = next;
							return next;
						});
					};
					const finishProviderDrag = (event) => {
						const drag = dragRef.current;
						if (dragId === null || drag.pointerId !== event.pointerId) return;
						const finalOrder = drag.order;
						const startOrder = drag.start;
						dragRef.current = { pointerId: null, order: null, start: null };
						setDragId(null);
						setLiveOrder(null);
						if (finalOrder === null) return;
						// 只按了一下手柄、没有实际挪动：不写盘。
						if (startOrder !== null && startOrder !== undefined
							&& startOrder.join('\u0000') === finalOrder.join('\u0000')) return;
						// 只比较当前在场的供应商：目录里已消失的 id 不该让一次“没动”的
						// 拖动也变成一次写入。
						const storedOrder = pickerState.providerOrder.filter((id) => finalOrder.includes(id));
						const changed = storedOrder.length !== finalOrder.length
							|| finalOrder.some((id, index) => id !== storedOrder[index]);
						if (changed) persistOrder(finalOrder);
					};
					const cancelProviderDrag = () => {
						dragRef.current = { pointerId: null, order: null };
						setDragId(null);
						setLiveOrder(null);
					};
					// 拖动中按 Esc 取消这次排序，不落盘。窗口级指针监听作为兜底：
					// 手柄用 setPointerCapture 接管指针，个别环境（或测试里）不支持时仍能拖动。
					useEffect(() => {
						if (dragId === null) return;
						const onKeyDown = (event) => {
							if (event.key !== 'Escape') return;
							event.stopPropagation();
							cancelProviderDrag();
						};
						const onPointerMove = (event) => moveProviderDrag(event);
						const onPointerUp = (event) => finishProviderDrag(event);
						document.addEventListener('keydown', onKeyDown, true);
						window.addEventListener('pointermove', onPointerMove, true);
						window.addEventListener('pointerup', onPointerUp, true);
						window.addEventListener('pointercancel', onPointerUp, true);
						return () => {
							document.removeEventListener('keydown', onKeyDown, true);
							window.removeEventListener('pointermove', onPointerMove, true);
							window.removeEventListener('pointerup', onPointerUp, true);
							window.removeEventListener('pointercancel', onPointerUp, true);
						};
					}, [dragId]);

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
						// 点不存在的档位（目录刷新导致圆点变少）时直接撤预览；其余都交给
						// chooseEffort——它自己会跳过“宿主已在该档”的重复提交，同时把
						// 档位记忆对齐（显示值可能来自记忆、与宿主不同）。
						if (target === undefined) {
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

					// 缩放的四个热区：透明薄片，未武装时 pointer-events:none，
					// 所以“划过边框”不会改光标、也不会抢走内容的点击。
					const armedZone = resolveArmedZone(pressingZone, resizingZone, hoverZone);
					const resizeGrips = box === null ? [] : [
						h('div', {
							key: 'rail-w', className: 'dsh-mp-grip', 'data-zone': 'rail-w',
							'data-armed': armedZone === 'rail-w' ? 'true' : 'false',
							style: { left: 0, top: 0, bottom: 0, width: PANEL_LIMITS.hitWidth },
						}),
						h('div', {
							key: 'pane-w', className: 'dsh-mp-grip', 'data-zone': 'pane-w',
							'data-armed': armedZone === 'pane-w' ? 'true' : 'false',
							style: { left: box.railWidth + GAP, top: 0, bottom: 0, width: PANEL_LIMITS.hitWidth },
						}),
						h('div', {
							key: 'top', className: 'dsh-mp-grip', 'data-zone': 'top',
							'data-armed': armedZone === 'top' ? 'true' : 'false',
							style: { left: 0, right: 0, top: 0, height: PANEL_LIMITS.hitWidth },
						}),
						h('div', {
							key: 'corner', className: 'dsh-mp-grip', 'data-zone': 'corner',
							'data-armed': armedZone === 'corner' ? 'true' : 'false',
							style: { left: 0, top: 0, width: PANEL_LIMITS.corner, height: PANEL_LIMITS.hitWidth },
						}),
					];

					const layer = open && anchor !== null && box !== null
						? ReactDOM.createPortal(
							h('div', {
								ref: layerRef,
								className: 'dsh-mp-layer',
								'data-sized': box.height === null ? 'false' : 'true',
								'data-resizing': resizingZone === null ? 'false' : 'true',
								style: {
									left: box.left,
									width: box.width,
									// 武装/拖动时整层用同一个缩放光标，指针在热区边缘的亚像素位置也不会丢光标。
									cursor: armedZone === null ? undefined : panelCursor(armedZone),
									...(box.height === null ? { maxHeight: box.maxHeight } : { height: box.height }),
									...(box.top === null ? { bottom: box.bottom } : { top: box.top }),
								},
								role: 'dialog',
								'aria-label': t('label.select'),
								onPointerMove: trackHover,
								onPointerDown: beginResize,
								onPointerLeave: disarmHover,
								// 指针离开整个面板（含两张卡片与中间缝隙）时才熄灭所有
								// 悬停高亮；在两列之间移动不会触发这里的 mouseleave，
								// 因为缝隙也在面板内。
								onMouseLeave: clearLit,
							},
								// 一级菜单：供应商。悬停即切换右侧内容。
								h('div', {
									ref: railRef,
									className: 'dsh-mp-card dsh-mp-rail',
									// 宽度走同一套钳制结果；高度由 flex stretch 与右侧共享，没有独立高度可设。
									style: { width: box.railWidth },
								},
									groups.length === 0
										? h('div', { className: 'dsh-mp-note' },
											catalog.status === 'error'
												? catalog.message
												: catalog.status === 'ready' ? t('emptyCatalog') : t('loading'))
										: railGroups.map((group) => h('div', {
											key: group.id,
											className: 'dsh-mp-rail-row',
											'data-provider-row': group.id,
											'data-dragging': dragId === group.id ? 'true' : 'false',
										}, [
												h('button', {
													key: 'handle',
													type: 'button',
													className: 'dsh-mp-handle',
													title: t('handle.title'),
													'aria-label': t('handle.title'),
													tabIndex: -1,
													onPointerDown: (event) => beginProviderDrag(event, group.id),
													onPointerMove: moveProviderDrag,
													onPointerUp: finishProviderDrag,
													onPointerCancel: finishProviderDrag,
													onClick: (event) => event.stopPropagation(),
												}, h(IconGrip)),
												h('button', {
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
														if (dragId !== null) return;
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
											),
										])),
								),
								// 二级区域：该供应商的模型列表 + 思考强度。
								h('div', {
									ref: paneRef,
									className: 'dsh-mp-card dsh-mp-pane',
									style: { width: box.paneWidth },
								},
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
															onMouseEnter: () => { if (dragId === null) setLitModel(model.id); },
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
								// 热区与尺寸读数（只在拖动中显示）作为层的最后两个子节点。
								...resizeGrips,
								resizingZone === null ? null : h('div', { className: 'dsh-mp-size-badge' },
									`${Math.round(box.railWidth)} × ${Math.round(box.paneWidth)} × ${Math.round(box.height ?? box.maxHeight)}`),
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
