---
name: drawio-operation
description: Read, inspect, create, and semantically edit Draw.io diagrams and architecture flows, collaborate with the native offline canvas, and guide export workflows.
---

# Draw.io operation

The `dsh-drawio` plugin integrates a 100% local, offline Draw.io diagram editor into DeepSeek Harness (DSH) right sidebar and equips the model with structured diagram editing tools.

When the user asks about Draw.io capabilities or diagram tools, describe the available tools and features directly without scanning or probing the workspace.

## Core Model Tools

1. **`drawio_inspect`**:
   - Reads an existing `.drawio` file into structured pages, nodes, edges, labels, and geometry bounds.
   - Always call this before modifying an existing diagram to understand existing cell IDs, hierarchy, and connection points.
   - Set `include_xml: true` only when raw XML attributes or specific unparsed mxCell metadata are needed.

2. **`drawio_edit`**:
   - Applies targeted semantic operations to an existing `.drawio` file.
   - Supported batch operations:
     - `add_node`: Add a new vertex with `id`, `label`, `style`, `x`, `y`, `width`, `height`.
     - `add_edge`: Connect vertices with `id`, `source`, `target`, `label`, and routing `style`.
     - `update`: Modify existing node or edge properties without disturbing unchanged geometry.
     - `delete`: Safely remove a cell and automatically cascade clean-up of connected edges.
   - Maintain stable, unique, descriptive cell IDs (e.g. `client`, `api_gateway`, `db_cluster`).

3. **`drawio_write`**:
   - Validates and writes a complete Draw.io `mxfile` or `mxGraphModel` XML document.
   - Automatically normalizes the XML to uncompressed, human-readable format for reliable Git diffs and future AI edits.
   - Prefer `drawio_write` when creating a brand-new diagram from scratch, and prefer `drawio_edit` for incremental revisions.

## Canvas & Offline Export Capabilities

- **Interactive Right-Sidebar Canvas**:
  - Double-clicking any `.drawio` file in the DSH workspace opens the full-featured Draw.io canvas.
  - Changes made by the model via `drawio_edit` or `drawio_write` are polled and synchronized into the canvas automatically without overwriting active user dragging.
- **Pure Local Image Export**:
  - The canvas includes a built-in offline export engine in the top-right toolbar:
    - **PNG (2x Ultra HD)**: High-resolution rasterization with optional transparent background.
    - **SVG (Vector)**: Infinite resolution vector diagram.
    - **XML-PNG**: Dual-mode image embedding editable diagram XML metadata.
  - Supports saving directly back into the current workspace (e.g. `architecture.png`), copying directly to the system clipboard, or downloading to local disk.

## Recommended Workflows

- **Creating a new diagram**:
  - Propose clear architecture/flowchart structure.
  - Call `drawio_write` with a clean `mxfile` XML document at a workspace path ending in `.drawio`.
  - Inform the user that the diagram is immediately viewable and editable in the right sidebar tab and can be exported to PNG/SVG from the canvas toolbar.
- **Updating an existing diagram**:
  - Call `drawio_inspect` first.
  - Formulate precise `operations` and call `drawio_edit`.
