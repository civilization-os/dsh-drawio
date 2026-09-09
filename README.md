# @civilization/dsh-drawio

为 DeepSeek Harness 的现有文件工作台增加本地 `.drawio` 画板，并向 Agent
注册可读取和修改 Draw.io XML 的原生工具。

## 边界

- 不引入项目、目录或文件管理；继续使用 DSH 与 `dsh-better-sidebar`。
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

已在 DSH 0.1.2-rc.1 与 dsh-better-sidebar 0.18.0 上验证构建、XML 操作、
本地静态资源加载和 `.drawio` 画板打开；浏览器控制台无错误或警告。

当前内置的精简 Draw.io runtime 固定为 31.4.5。基础图形、常用图形库和中文资源可用；
云盘、在线图库、模板库、VSDX/Gliffy 导入和服务端导出未包含。
