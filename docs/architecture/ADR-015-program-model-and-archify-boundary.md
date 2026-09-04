# ADR-015: ProgramModel as canonical IR and Archify as embedded adapter

## Status

Accepted (0.27.0-dev / Phase 0).

## Context

嵌入式系统分析不仅需要文件维度的依赖拓扑，还需要深入到代码语法级甚至运行态因果级的拓扑结构（函数调用图 Call Graph、变量读写关系、条件分支等）。同时，社区中存在如 Archify 这样优秀的代码架构可视化与分析工具。

在整合程序图（Program Graph）与 Archify 时，存在明显的架构风险：
1. 若直接将 Archify 的私有 IR 数据结构作为 Vision 内部的领域模型，会导致 Vision 核心与外部库强绑定，外部变更将引发破坏性连锁反应；
2. 若在 WebUI 中通过 `<iframe>` 嵌入 Archify Preview Server 或独立前端 Shell，将严重破坏 Harness 原生一致的设计风格、主题响应、键盘导航与 Agent 交互闭环。

## Decision

1. **ProgramModel 作为内部唯一规范模型（Canonical IR）**：
   - Vision 核心领域维护独立的 `ProgramModel`（位于 `src/domain/program/program-model.mjs`），负责定义文件、符号、函数、变量、调用边、读写边、条件依赖的稳定抽象。
   - `ProgramModel` 独立演进，绝不依赖 Archify 或其他外部渲染库。
2. **复用现有 ProjectGraph UI 原生交互体系**：
   - 现有的 `src/ui/debug/project/`（SVG 原生渲染、平移、缩放、聚焦、键盘导航、视口适配等）继续作为产品核心能力保留。
   - 后续阶段将其中的通用交互能力抽取为共享图图元，为运行态叠加（Runtime Overlay）提供统一的渲染基座。
3. **Archify 严格限定为嵌入式适配器（Library Adapter）**：
   - Archify 仅作为纯库级适配器（`src/infrastructure/archify/archify-adapter.mjs`）引入，优先通过嵌入式 Node 模块/源码隔离使用。
   - 严禁启动 Archify 独立服务器，严禁在 WebUI 中嵌入 Archify iframe。
   - Archify 仅承担 3 项纯分析增益能力：复杂的上下游路径解释（Upstream / Downstream）、引导式调试故事线生成（Debug Story）以及修改前后的增量对比（Before / Delta / After）。

## Consequences

- 领域模型解耦：Archify 的升级、替换乃至禁用，完全不会波及 Vision 的程序模型和调试核心。
- 用户体验完全统一：所有视图均渲染在 Harness 原生 React 容器内，保持纯正的沉浸式操作体验。
