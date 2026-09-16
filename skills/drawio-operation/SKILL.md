---
name: drawio-operation
description: 读取、检查、创建和语义化编辑 Draw.io 架构图与流程图，协同原生离线画板，并指导导出与排版工作流。
---

# Draw.io 画板与图表协同指南

`dsh-drawio` 插件为 DeepSeek Harness (DSH) 提供 100% 本地离线的 Draw.io 画板，并向 Agent 注册结构化图表编辑工具。

当用户询问 Draw.io 功能或需要绘制图表时，直接说明支持的画板功能与工具，无需探测工作区无关文件。

## 核心模型工具

### 1. `drawio_inspect`
- **功能**：将现有 `.drawio` 文件解析为结构化的页面、节点、连线、文本内容及几何坐标。
- **最佳实践**：修改已有图表前必须先调用 `drawio_inspect`，获取已有 cell ID、父子层级关系及连线端点。
- **字段**：返回的 `plainText` 是已去除 HTML 格式的纯净标签；`children` 标识该容器节点包含的子节点 ID。
- 仅在需要查看原始底层 XML 属性时设置 `include_xml: true`。

### 2. `drawio_edit`
- **功能**：对现有 `.drawio` 文件应用批量语义化增量修改，支持多页面管理。
- **支持的批量操作类型**：
  - `add_node`：新增节点。属性：`id`, `label`, `style`, `parent`, `x`, `y`, `width`, `height`。
  - `add_edge`：新增连线。属性：`id`, `source`, `target`, `label`, `style`, `parent`。
  - `update`：更新已有节点或连线属性。
    - 推荐使用 `stylePatch: { fillColor: '#dae8fc', strokeColor: '#6c8ebf' }` 局部增量修改颜色或边框，避免冲掉节点的已有样式（如圆角、对齐等）。
    - 也支持整体更新 `label`, `style`, `x`, `y`, `width`, `height`。
  - `delete`：安全删除节点，并自动级联清理连接到该节点的孤立连线。
  - `add_page`：在当前文档中新增图表页面。属性：`id`, `name`（如 `部署拓扑`、`时序交互`）。
  - `rename_page`：重命名页面。属性：`page` (索引或ID), `name`。
  - `delete_page`：删除指定页面。属性：`page`。
- **规范**：节点 ID 应具备稳定且语义化的英文标识（例如 `client`, `api_gateway`, `auth_service`, `db_cluster`），严禁使用易冲突的纯数字 ID。

### 3. `drawio_write`
- **功能**：校验并写入完整的 Draw.io `mxfile` 或 `mxGraphModel` XML 文档。
- 自动格式化为未压缩的规范 XML，便于后续 AI 审查与 Git diff 跟踪。
- **建议**：从零构建新图表时首选 `drawio_write`；对现有图表进行局部修改或扩展时首选 `drawio_edit`。

---

## 架构图排版与设计规范

为了保证大模型生成的图表整洁、专业、无重叠，请遵循以下工业级排版规范：

### 1. 坐标与网格系统
- **基准网格**：Draw.io 默认 `gridSize=10`，所有坐标 `x`, `y`, `width`, `height` 请取 10 的整数倍。
- **标准节点尺寸**：
  - 常规服务/模块：`width: 140, height: 60`
  - 数据库/存储：`width: 120, height: 70`
  - 外部系统/客户端：`width: 130, height: 50`
  - 分组容器（Group/VPC）：根据内部节点数量自适应（如 `width: 600, height: 320`）
- **间距推荐**：
  - 横向流式布局：节点水平间距保持在 `80px ~ 120px`（如 `x1=40, x2=240, x3=440`）；
  - 纵向分层架构：分层垂直间距保持在 `90px ~ 130px`（如 Layer 1: `y=40`，Layer 2: `y=160`，Layer 3: `y=280`）。

### 2. 经典高质感现代配色方案（Flat Palette）

| 分类/层级 | 填充色 `fillColor` | 边框色 `strokeColor` | 字体色 `fontColor` | 推荐使用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **接入/网关** | `#dae8fc` (浅蓝) | `#6c8ebf` (深蓝) | `#000000` | Client, Nginx, API Gateway, CDN |
| **业务服务** | `#d5e8d4` (浅绿) | `#82b366` (深绿) | `#000000` | OrderService, UserService, K8s Pods |
| **存储/数据库** | `#ffe6cc` (暖橙) | `#d79b00` (深橙) | `#000000` | MySQL, Redis, MongoDB, S3 |
| **异步队列/通信** | `#e1d5e7` (浅紫) | `#9673a6` (深紫) | `#000000` | Kafka, RabbitMQ, EventBus |
| **告警/高风险** | `#f8cecc` (浅红) | `#b85450` (深红) | `#000000` | ErrorHandler, DeadLetter, Alert |
| **容器/分组边框** | `#f5f5f5` (极浅灰) | `#cccccc` (浅灰) | `#333333` | VPC, Kubernetes Cluster, Subnet |

### 3. 连线样式（Edge Styles）
- 统一使用正交折线：`edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;`
- 若要强调特定流向，可增加线宽 `strokeWidth=2;`，异步/订阅连线推荐增加虚线 `dashed=1;`。

---

## 离线画板协同与图片导出

- **右侧栏实时双向协同**：
  - 用户在 DSH 中打开任何 `.drawio` 文件即可在右侧栏全功能画板中直观交互；
  - 模型调用 `drawio_edit` 或 `drawio_write` 保存后，画板会自动轻量检测版本变化并同步刷新，且不会中断用户正在进行的画布拖拽。
- **纯本地离线图片导出**：
  - 画板右上角内置纯本地导出面板，支持导出为 **PNG (2x 超清)**、**SVG (矢量无损)** 和 **XML-PNG (双模可编辑图)**；
  - 支持一键**保存到工作区**（自动生成同名图片）、**写入系统剪贴板**（便于直接粘贴到文档或聊天窗口）或**下载到本地磁盘**。
