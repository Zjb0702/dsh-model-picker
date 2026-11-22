// 模型选择器 —— Host 半边。
//
// 本插件是纯 UI 插件：选择器全部在浏览器半边渲染，模型目录与选中回填都通过
// 客户端已有的 remote 面（ctx.remote.session.modelCatalog / selectModel）完成，
// 因此 Host 半边没有任何需要注册的资源，apply 保持空实现。
export function apply() {}
