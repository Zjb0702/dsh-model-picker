# dsh-model-picker

zcode 风格的两级模型选择器，替换输入框工具行里的模型选择座位。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包清单：声明 `dsh.bundle.patch` 与 `dsh.client`（浏览器半边入口）。 |
| `cordis.patch.yml` | 组合补丁：把本包挂进 Web 组合。 |
| `index.js` | Host 半边：只提供偏好存储（按模型记档位、供应商顺序）的同源回环路由。 |
| `client.js` | 浏览器半边：选择器组件、样式、文案、座位注册、拖动排序。 |
| `test/` | 偏好存储与纯函数测试（`node --test test/host-state.test.mjs test/client-prefs.test.mjs`）。 |
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

## 偏好记忆与供应商排序

- **档位记忆**：思考强度按「供应商 + 模型」记住你上次显式选中的档位。在某个模型上选「高」，
  切到别的模型再切回来，仍然是「高」；没被选过档位的模型沿用目录默认值。档位若已不在该
  模型声明的档位集合里，自动回落到默认值。
- **全局记忆**：这条记忆在所有会话间共享——任何一个会话里设的档位，切换模型、
  新建会话、切到其他会话时都同样生效。
- **供应商顺序**：每个供应商行左侧有一个小圆点手柄（⋮⋮），按住手柄拖动即可调整顺序；
  松手才落盘，拖动中按 Esc 取消。只允许通过手柄拖动，点供应商行本身仍是原来的选择行为。
- **持久化位置**：`$DSH_HOME/model-picker/state.json`（默认 `~/.dsh/model-picker/state.json`），
  由 Host 半边通过同源回环路由读写，原子写入。页面刷新、插件重载、App 重启后都有效；
  旧格式文件读取时会自动迁移，损坏的文件会先留档再重建。存储不可用时静默降级为「不记忆」，
  不影响选择模型本身。

## 面板缩放

面板的两栏都可以拖边框调整大小，松手才落地（拖动中显示实时读数）：

- 拖供应商栏**左边框**：改供应商栏宽度，面板左边缘跟着指针走；
- 拖模型栏**左边框**（两栏之间的分界）：总宽不变，改两栏的分栏宽度，边界跟着指针；
- 拖任意一栏的**上边框**：两栏同时变高，被拖的上边缘跟着指针走（对侧边缘不动）；
- 拖供应商栏**左上角**：宽度和高度一起变。

两栏高度永远是同一个值（只有一个 `height` 入口，由 flex stretch 渲染），不存在一栏高一栏低。
指针要在边框的 5px 热带内静止约 140ms 才会出现缩放光标与提示线；快速划过不会改光标、
不会误触拖动。按下后移动超过 3px 才算拖动，单纯点击不改变任何尺寸。按下时提示不会断开：
按下态直接接管武装态，拖动全程光标与提示线连续显示，松手后指针仍在热区里就继续亮着，
离开热区或关闭面板才收回。尺寸有上下限
（供应商栏 120–420px、模型栏 220–760px、高度 180–660px），面板也不会被拖出视口。
手动定高后模型列表会吃掉剩余高度，不会留下大片空白。

上方展开时面板底边贴着输入框、往上长；下方展开时会临时盖住一点输入框区域（松手后位置保留，
重新打开面板会回到贴住输入框的位置）。

尺寸随其他偏好一起存在 `state.json` 的 `layout` 字段里（旧文件读取时自动补 null，原有顺序
与档位记忆一条不丢）；存储不可用时静默降级为不记忆尺寸。

尺寸是**全局偏好**（所有会话共用一份），不按会话分开存。读写链路有三层：

1. **Host 状态文件**（权威、跨重启）：Host 半边把 `GET /api/dsh-model-picker/state` 与
   `PUT .../state/save` 注册到组合层 `connection` 服务的 Fetch 路由表（`/api` 前缀路由由框架
   挂载，负责鉴权与请求体，再按路径转给插件），同时保留一套 `webServer.register` 的 exact
   路由兜底；`connection` 可能比插件晚就绪，所以用 `ctx.inject(['connection'])` 等它，晚到也
   不会把 Host 半边卡住。哪条通道真的挂上了，看 `~/.dsh/model-picker/last-apply.json`。
2. **本页缓存**（`localStorage` 键 `dsh-model-picker/layout`）：松手瞬间就写，组件重新挂载
   （切换会话）时首帧直接按它渲染，不会先闪一下默认尺寸；Host 暂时不可用时刷新也还在。
   桌面版窗口的源是 `dsh-app://app`（不随端口变化），所以这份缓存在重启 App 之后同样有效。
3. **读取优先级**：Host 有记录用 Host，Host 说“没有记录”才退回本页缓存；Host 读请求失败会
   轻量重试一次，仍失败就静默降级。

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
