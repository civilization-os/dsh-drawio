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
云盘、在线图库、模板库、VSDX/Gliffy 导入和服务端导出未包含。
