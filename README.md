# @civilization/dsh-drawio

为 DeepSeek Harness 的现有文件工作台增加本地 `.drawio` 画板，并向 Agent
注册可读取和修改 Draw.io XML 的原生工具。

## 边界

- 不引入项目、目录或文件管理；直接使用 DSH 官方右侧栏与文件工作台。
- 任意 `.drawio` 文件都由画板打开，可停靠、拆分或浮动。
- 编辑器资源由 DSH Host 从本机提供，不连接 diagrams.net。
- 用户保存和 Agent 工具修改的是同一份 XML 文件。
- 文件读取、写入、路径限制和审批继续经过 DSH 服务。

## Agent 工具

- `drawio_inspect`：把画板读取为页面、节点、连线和几何信息。
- `drawio_edit`：批量新增、更新、删除节点和连线。
- `drawio_write`：校验并写入完整的 Draw.io XML。

工具统一保存为未压缩 XML，便于 Agent 继续修改，也便于 Git 查看差异。画板会
自动保存，并轮询同步 Agent 对同一文件的修改。

## 本地离线图片导出 (Export)

由于 Draw.io 原版导出功能依赖云端渲染服务（`export.diagrams.net`），在离线及局域网环境下无法正常工作。本插件基于 Draw.io 离线内核的 Embed 消息通道与 Canvas / SVG 渲染协议，实现了**100% 纯本地离线图片导出引擎**：

- **支持格式**：
  - **PNG (超清 2x)**：采用高倍率抗锯齿光栅化渲染，支持透明背景切换，适合插入文档和交流汇报；
  - **SVG (矢量图)**：提取无损矢量图形，任意放大不失真；
  - **XML-PNG (可编辑图)**：在 PNG 图像中内嵌图表 XML 原数据，既能作为常规图片展示，又可随时拖回 Draw.io 继续二次编辑。
- **三大输出方式**：
  - **保存到工作区**：在当前画板文件同级目录下自动生成同名图片文件（如 `arch.drawio` -> `arch.png`），自动触发 DSH 文件系统感知；
  - **复制到剪贴板**：一键将 PNG 图片写入操作系统剪贴板（`navigator.clipboard`），方便在 Markdown、PRD 或聊天工具中直接 `Ctrl + V` 粘贴；
  - **下载图片文件**：触发浏览器原生下载弹窗保存到本地磁盘。

## 开发验证

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
dsh plugin --profile web add D:\project\dsh-drawio --registry=https://registry.npmjs.org/ --prefer-offline
dsh web --port 3082 --no-open
```

客户端只注入 DSH 官方的 `slots` 与 `sidebarRightTabs` 服务。文件工作台打开
`.drawio` 文件时，由官方资源路由选择本插件的画板；读取和自动保存通过插件自有的
`/dsh-drawio/api` 接口完成，并限制在当前会话工作区内。

已在 DSH 0.1.5-rc.2 上验证构建、XML 操作、本地静态资源加载和官方右侧栏注册。

当前内置的精简 Draw.io runtime 固定为 31.4.5。包含完整满血版内置图库（通用、流程图、UML、ER、BPMN、网络、Kubernetes、AWS、GCP、Cisco、电子、平面图等全部分类均可自由开启）以及 PlantUML 离线渲染模块；
云盘、在线图库、模板库、VSDX/Gliffy 导入未包含；已全面支持纯本地离线 Canvas + SVG 导出引擎。
