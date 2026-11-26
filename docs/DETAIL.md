# 模型选择器

在输入框的模型座位上换成 zcode 风格的两级选择器：左边一列供应商，鼠标移到哪一行，
右边就换成那家供应商的模型列表；点模型即选中并回填，思考强度用一条渐变滑条调节。

## 交互

1. 点输入框工具行里的模型按钮（显示当前模型名 + 徽标 + 思考强度），面板在按钮上方展开；
   上方空间不足时自动翻到下方。
2. 左侧卡片是供应商一级菜单。鼠标移到某一行，右侧卡片同时换成它的模型列表——
   左行高亮与右侧内容读的是同一个派生值，一次渲染一起变，所以不会闪烁或错位。
3. 右侧卡片自上而下：供应商名 / 「模型」小标题 / 模型行 / 思考强度 / 渐变滑条。
   已选中的模型打勾并保持高亮，徽标（如「视觉」）紧跟在模型名右侧。
4. 点某个模型即提交并收起；点滑条或按左右方向键调整思考强度，松开/按键时提交一次。
5. 点面板外面或按 Esc 收起。

## 思考强度滑条

档位数量与取值完全以模型目录声明的 `reasoning.efforts` 为准，插件里没有任何硬编码档位：
模型给几档就画几个圆点，标签直接用宿主返回的 `name`（Off / Low / Medium / High …），
最左一档若是宿主声明的 `off`，就是「关闭思考」。

视觉与交互与 zcode 一致：

- 一条 12px 高的渐变色条，右端是一个 **22px 的白色大圆滑柄**，圆心即当前档位落点；
- 每个档位在色条上画一个 **8px 白色实心小圆点**，恒定大小、不放大不提亮；
- 大滑柄与所有小圆点的坐标都经过「两端各内缩 11px（滑柄半径）」的换算
  （`tierLeft`，`calc(% + px)` 形式），所以**任何一档都不会探出色条两端**，
  修掉了此前左右两档圆点露出渐变框的问题；
- 圆点悬停有轻微的 `transform: scale(1.3)` 反馈——只用 transform，不占布局，
  不会推动相邻圆点，也不会撑动滑条；整行依然没有悬停底色；
- 颜色条只做一次过渡：`.dsh-mp-rest` / `.dsh-mp-knob` 上有 120ms 的 `left` 过渡，
  点击一次就是一记平滑的位移；拖动时给轨道加 `data-drag="true"` 关掉过渡，
  大滑柄严格跟手。提交时先等 `selectModel` 落地再清掉预览值，中间不会出现
  「先回退到旧档、再跳到新档」的两段式重渲染。

## 悬停与选中

悬停高亮由组件状态驱动（`data-lit`），而不是只靠 CSS 的 `:hover`：

- 指针移入左侧某家供应商行，该行**文字立刻高亮**。
- 指针接着移到右侧模型列表去挑模型时，左侧那家供应商**保持高亮**，右侧指针所在的模型行
  也亮着——同一时刻左右各有一行高亮。原因是供应商行的 `:hover` 虽然失效了，但状态里的
  `data-lit` 仍然成立。
- 指针离开整个面板（含两列之间的缝隙）时，所有悬停高亮一起熄灭，不留残留。

高亮只改背景色与文字色，行高、内外边距和边框宽度一律不动，所以悬停时列表不会跳动或错位；
供应商行与模型行共用同一条规则，样式完全一致，都保持手型指针。思考强度那一行不是可点选项，
没有悬停高亮。

悬停和选中用**两套不同族的令牌**，一眼可分：

| 状态 | 令牌 | 明暗主题下的取值 | 说明 |
| --- | --- | --- | --- |
| 悬停 | 底色 `--dsw-alias-state-business-tertiary` + 文字 `--dsw-alias-state-business-primary` | 浅色：淡蓝底 deepseek-100 + 蓝字 deepseek-500；深色：深蓝底 deepseek-800 + 亮蓝字 deepseek-400 | 临时提示，指针离开面板即消失 |
| 选中 | 底色 `--dsw-alias-interactive-bg-active`（中性） | 浅色 `rgba(38,49,72,.1)`；深色 `rgba(255,255,255,.14)` | 常亮，模型行与供应商行另带 ✓ |

没沿用参考图里那种中性灰：黑色系的半透明灰跟选中态的灰是同一族，只能靠深浅区分，而悬停用
业务蓝一族后，跟选中灰底和面板底色 `--dsw-alias-bg-overlay` 是两个色系，明暗主题下都分得开。
两个令牌都是宿主提供的、均带明暗两套值，因此不需要新增变量。

悬停规则显式排除已选中的行（供应商行与模型行都看 `data-active`），所以悬停与选中同时成立时
一定是选中态胜出，不会分不清当前选的是谁。

悬停只影响视觉，不改变右侧模型列表的内容——换供应商仍按 `activeId` 派生，悬停行就是
右侧正在展示的那一家，一次渲染同时更新，不闪烁、不错位。指针离开面板只清高亮、不清 `hovered`，
所以右侧列表不会被切走。

当前选的是哪家供应商，除了左行的 ✓ 和常亮灰底，触发按钮上也一直写着供应商与模型名，
收起面板后同样看得到。

## 数据来源

供应商与模型来自宿主现有的模型目录（`ctx.remote.session.modelCatalog()`），
不在插件里硬编码任何名字；选中回填走 `ctx.remote.session.selectModel()`。
因此新增供应商、增删模型、改徽标都只需在 DSH 的模型/凭据设置里操作，插件不用改。

## 思考档位记忆

宿主的会话投影只保存「当前这一次选择」（provider / model / reasoningEffort 一个组合），
不按模型分别记录档位；本插件因此自己持久化一份记忆：

- 在某个模型上把档位调到「高」，切到别的模型再切回来，档位仍是「高」；
- 记忆的键是「供应商 + 模型」：同名模型在不同供应商下互不影响；
- 从未显式选过档位的模型沿用模型目录里的 `reasoning.defaultEffort`；
- 记忆里的档位若已不在该模型声明的档位集合里（模型升级、目录变化），
  自动回落到默认值，不会把无效档位提交给宿主；
- 记忆存在宿主进程侧，页面刷新、插件重载、App 重启后都还在。

### 全局记忆

档位记忆在所有会话间共享：任何一个会话里设的档位，在其他会话里同样回填。
`resolveEffortSelection` 和 `resolveSwitchEffort` 不区分会话新旧——显示档位始终跟记忆走
（若该模型支持），换模型时优先回填记忆档位，没有记忆才用目录默认值。

## 供应商顺序

- 每个供应商行左侧有一个小圆点手柄（⋮⋮）。按住手柄上下拖动即可调整顺序，
  松手才落盘；拖动中按 Esc 取消，不改变已保存的顺序。
- 只有手柄能拖动：点供应商行本身仍是原来的行为（切换右侧展示的供应商），
  拖动不会误触发选择。
- 目录里新出现的供应商排在已记住顺序的后面，已删除的供应商自动跳过。

## 面板缩放

四个热区（`rail-w` / `pane-w` / `top` / `corner`）判定全部抽成纯函数：

- `resolveHitZone(point, boxes)`：以两栏的真实 `getBoundingClientRect()` 为输入，先判左上角
  （横向 12px 内、上边缘 5px 内），再判上边框（横跨两栏），再判两条左竖边（宽 5px、限卡片
  高度内）；间隙、栏内内容一律返回 `null`，所以点选、排序手柄、模型行点击都不会被热区抢走。
  供应商排序手柄还额外在 `beginResize` 里被 `closest('.dsh-mp-handle')` 排除。
- `shouldArmHover` / `hoverNeedsRestart`：指针在热区内静止满 `hoverDelayMs = 140ms`
  才武装（`data-armed` → 光标 + 提示线）；等待期间位移超过 `hoverMoveTolerance = 4px`
  就重新计时，所以“扫过边框”不会亮。热区薄片默认 `pointer-events: none`，未武装时对指针
  完全透明。
- `resolveArmedZone(pressingZone, resizingZone, hoverZone)`：当前该亮哪个热区，优先级
  “按下中 > 拖动中 > 悬停武装”。按下时 `pressingZone` 直接接管，**不从悬停态先清空再重建**，
  所以“进入热区 → 按下 → 拖动 → 松手”全程不会闪断；松手时 `settleArmedZone` 先清
  `pressingZone`，再按 `zoneAt(event)` 判断指针是否还在热区内——在就保持武装（点击边框、
  拖完边框后指针停在边上都不会闪），不在就 `disarmHover()` 按既有规则收回。
- `exceedsDragThreshold`：按下后位移超过 `dragThreshold = 3px` 才真正进入拖动；没超过只是
  一次普通点击，不改尺寸。拖动在 `window` 的 capture 阶段监听 `pointermove/pointerup`，
  指针拖出面板也继续跟手，松手才 `applyResizeDelta` → `resolvePanelBox` → 写入并保存。
- `applyResizeDelta(zone, base, dx, dy)`：`railW/corner` 让 `left += dx`（面板左边缘跟手）
  且供应商栏宽度反向变化；`paneW` 让供应商栏宽度补偿 `dx`、模型栏宽度反向变化（总宽不变，
  分栏边界跟手）；`top/corner` 只改唯一的 `height`。**高度只有这一个入口**，两栏由
  `.dsh-mp-layer` 的 flex `stretch` 共享高度，结构上不可能一栏高、一栏低。
- `resolvePanelBox(input)`：把期望尺寸收敛成实际渲染值。下方展开时上边缘还能被拖动：组件把
  “上边缘偏移”加到 `triggerBottom` 上传进来，于是 `top = triggerBottom + margin` 跟着走、可用
  高度按到视口底部的距离算，底边保持原地；这个偏移只是本次预览的位置（不落盘），重新打开面板
  会回到贴住输入框的锚点。供应商栏 120–420、模型栏 220–760、
  高度 180–660；总宽超过 `viewportWidth - 16` 时先收模型栏、仍不够再收供应商栏；左边缘夹在
  `8 .. viewportWidth - width - 8`；展开侧可用高度决定 `maxHeight`（下限 120），面板上下
  都不会越出视口。

尺寸持久化（`state.json` v3）：

```json
{
  "version": 3,
  "providerOrder": ["provider-a", "provider-b"],
  "efforts": [{ "provider": "provider-a", "model": "model-x", "effort": "high" }],
  "layout": { "railWidth": 220, "paneWidth": 380, "height": 320 }
}
```

- `layout` 三个字段都可为 `null`（该项沿用默认/自适应），整体为 `null` 表示没拖过；
- Host 侧 `sanitizeLayout` 逐字段校验并夹到同一套边界内，三个字段都非法时归 `null`，
  不会让坏值落盘；
- 兼容更早的格式：`layout` 缺失 → `null`；也接受 `panel` / `size` 两种别名；`providerOrder`
  与 `efforts` 的旧格式迁移逻辑不变，新增字段不会导致原有配置被丢弃；
- `PUT /state/save` 携带 `{ layout }` 合并写入；客户端保存失败只影响“重启后还记不记得尺寸”，
  不影响这次拖动与选择模型。

尺寸的读取 / 回填 / 保存链路（切换会话、刷新页面、重启 App 都要保持）：

- **传输层**：Host 半边同时挂两条通道。其一把接口注册到组合层 `connection` 服务的 Fetch
  路由表（`connection.fetch.register({ path, methods, requestBody: 'buffered', fetch })`，
  路径按框架要求落在 `/api/` 下）：框架自己挂的 `/api` 前缀路由先做 Host/Origin 围栏与浏览器
  cookie 鉴权，再按路径把 `Request` 转给插件的 `fetch`，插件不再自己判鉴权。`connection` 比
  插件晚就绪时用 `ctx.inject(['connection'], …)` 等它——晚到不会卡住 `apply()`，早到则立即回调。
  其二始终挂一套 `webServer.register` 的 exact 路由（node `req/res` 风格 + `requestRejection`）
  兜底，单条失败只记警告。两条通道的注册结果（成功条数、失败原因）落在
  `$DSH_HOME/model-picker/last-apply.json`，`~/.dsh/model-picker/state.json` 出现即代表 Host
  半边确实跑起来了。
- **本页缓存**：`writeLayoutCache` / `readLayoutCache`（`localStorage` 键
  `dsh-model-picker/layout`，值经 `normalizeLayout` 归一；桌面版窗口源为 `dsh-app://app`，
  不随 GUI 端口变化，重启 App 后仍有效）。松手时先同步写缓存再发 `PUT`，
  于是切换会话重新挂载组件时，`useState` 初值就是上次的宽高（首帧不闪默认尺寸）；Host 不可用
  时刷新页面也还在。
- **优先级**：`preferLayout(cached, loaded)`——Host 返回了 `layout` 就用 Host，返回 `null`
  才用缓存；`applyLoadedState` 在 `sizeTouchedRef` 为假时才写回 `setSize`（本页已经拖过就不
  让迟到的响应覆盖）。尺寸是全局偏好，所有会话共用一份，不按 `sessionId` 分开存。
- **重试**：读写都经过 `withRetry`（2 次、间隔 300ms），覆盖 Host 刚重启、路由还没注册完的
  空窗；仍失败则静默降级，选择模型不受影响。

## 偏好存储

偏好写在 `$DSH_HOME/model-picker/state.json`（默认 `~/.dsh/model-picker/state.json`），
由 Host 半边通过同源回环路由读写：

```json
{
  "version": 3,
  "providerOrder": ["provider-a", "provider-b"],
  "efforts": [{ "provider": "provider-a", "model": "model-x", "effort": "high" }],
  "layout": { "railWidth": 220, "paneWidth": 380, "height": 320 }
}
```

- 原子写入（临时文件 + rename），写入串行化；
- 旧格式（`reasoningEfforts` 的 `"provider::model"` 映射、`order` 别名等）读取时自动归一成
  上面的结构并写回，不丢已有选择；
- 文件损坏时先改名留档为 `state.json.bad-<时间戳>`，再从空状态开始，不会把坏文件当空数据覆盖；
- 存储不可用（Host 半边未加载等）时客户端静默降级为「不记忆」，选择模型本身不受影响。

## 覆盖关系

插件注册在 `conversation.input.model` 座位，priority `-200`（宿主自带实现是 `0`，
single 座位只渲染 priority 最低的一个）。停用插件后宿主自带的选择器自动回来。

## 已知边界

- 被寻址的子会话（subagent）里不渲染，与宿主自带选择器一致。
- 思考强度只在当前模型声明了 `reasoning.efforts` 时出现；换供应商悬停时它不跟着变，
  因为它描述的是当前选中的模型。
- 面板宽度固定为 196 + 6 + 340 = 542px（窄屏时收窄到视口内），与参考图的两栏比例一致。
