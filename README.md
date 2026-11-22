# dsh-model-picker

zcode 风格的两级模型选择器，替换输入框工具行里的模型选择座位。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包清单：声明 `dsh.bundle.patch` 与 `dsh.client`（浏览器半边入口）。 |
| `cordis.patch.yml` | 组合补丁：把本包挂进 Web 组合。 |
| `index.js` | Host 半边，空实现（纯 UI 插件，数据走 `ctx.remote.session`）。 |
| `client.js` | 浏览器半边：选择器组件、样式、文案、座位注册。 |
| `locale/zh.json`、`locale/en.json` | 插件管理页里的标题与描述。 |
| `docs/DETAIL.md` | 插件详情页。 |
| `icon.svg` | 插件图标。 |

## 安装

在 DSH 里用插件管理器安装本地目录：

```js
plugin_manager({ action: "install_bundle", target: "D:\\Documents\\deepseek-harness\\default-workspace\\dsh-plugins\\dsh-model-picker" })
```

安装完成后重新加载页面即可看到新的选择器。停用用
`plugin_manager({ action: "set_bundle", target: "@local/dsh-model-picker", enabled: false })`，
停用后宿主自带的选择器会自动回来。

## 数据与回填

- 目录：`ctx.remote.session.modelCatalog()`
- 回填：`ctx.remote.session.selectModel({ sessionId, provider, model, reasoningEffort? })`
- 当前选中：会话投影 `modelSelection` 的 `next ?? lastUsed`，回落到目录默认值。
- 子会话（被寻址的 subagent）里不渲染：与宿主自带选择器的行为一致。

供应商、模型、徽标（如「视觉」）、思考强度档位全部来自宿主的模型目录，
插件里没有任何硬编码的名字；要加供应商或模型，在 DSH 的模型/凭据设置里改即可。

## 座位

`conversation.input.model`，priority `-200`（宿主自带实现为 `0`；single 座位只渲染
priority 最低的一个，因此本插件覆盖它，停用后自动还原）。

## 自检

```bash
ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.exe>" --check client.js
ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.exe>" <session>/tools/smoke-model-picker.mjs
```

冒烟脚本用最小的 React 替身跑完整交互路径（打开 → 悬停切换供应商 → 指针进模型列表 →
点模型回填 → 指针离开面板），断言左侧高亮与右侧模型列表同步、悬停不挪走选中标记、
回填参数正确，并直接核对注入的 CSS：悬停走 `--dsw-alias-state-business-tertiary` +
`--dsw-alias-state-business-primary`、选中走 `--dsw-alias-interactive-bg-active`，
两者不是同一条规则，思考强度行没有悬停规则，行高/内边距/边框未被改动。
思考强度部分另有一组断言：圆点常态 `scale(1)`、悬停放大值大于常驻放大值且提亮、
放大只用 `transform` 不动宽高、已选中与拖动中都保持放大、颜色条有 120ms 过渡而拖拽时关掉，
以及点击只提交一次、渲染序列里不出现「回退旧档」的那一帧（即不会闪两下）。

## 思考强度滑条

档位数量与取值以模型目录的 `reasoning.efforts` 为准，模型给几档就画几个圆点，最左档若是
宿主声明的 `off` 就是「关闭思考」。视觉与交互对齐 zcode：12px 渐变色条 + 22px 白色大圆
滑柄 + 每档一个 8px 白色实心小圆点；大滑柄与圆点的坐标都经过「两端各内缩滑柄半径」的
换算（`tierLeft`），任何一档都不会探出色条两端。圆点悬停只有轻微的 `transform: scale(1.3)`
反馈，不改颜色、不占布局；这一行仍然没有整行悬停底色。

颜色条只过渡一次：`.dsh-mp-rest`/`.dsh-mp-knob` 带 120ms 的 `left` 过渡，点击即一记
平滑位移；拖动时轨道加 `data-drag="true"` 关掉过渡，滑柄严格跟手。提交时先等
`selectModel` 落地再清预览值，避免「先回旧档再跳新档」的两段式重渲染。

## 悬停与选中

悬停高亮由状态驱动（`data-lit`），不是只靠 `:hover`：指针进入左侧供应商行，该行文字立刻高亮；
指针移到右侧模型列表挑模型时，这家供应商**保持高亮**，同时右侧指针所在那行也亮着；指针离开
整个面板（含两列之间的缝隙）时所有悬停高亮一起熄灭，不留残留。高亮只改背景色与文字色，
行高、内外边距、边框宽度不变，所以列表不会跳动或错位；两列共用同一条规则，都保持手型指针。

悬停与选中用两套不同族的令牌：悬停是业务蓝一族
（底色 `--dsw-alias-state-business-tertiary` + 文字 `--dsw-alias-state-business-primary`，
浅色为淡蓝底 + 蓝字、深色为深蓝底 + 亮蓝字），选中是中性的一层
`--dsw-alias-interactive-bg-active`（浅色 `rgba(38,49,72,.1)`、深色 `rgba(255,255,255,.14)`），
所以一眼可分，也不会跟面板底色 `--dsw-alias-bg-overlay` 混在一起；两个令牌都由宿主提供明暗
两套值，没有新增变量。悬停规则显式排除已选中的行，两者同时成立时以选中态为准。
当前选的是哪家供应商，除左行的 ✓ 与常亮灰底外，触发按钮上一直写着供应商与模型名。
