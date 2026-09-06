<div align="center">

# ◌ pi-glance

**[Pi](https://github.com/earendil-works/pi) 的圆角编辑器与状态栏。**

显示 Git 状态、费用、模型速度、上下文用量、Tokens 和当前模型。

[English](./README.md) · 简体中文

[![npm](https://img.shields.io/npm/v/pi-glance?style=flat-square&color=blue)](https://www.npmjs.com/package/pi-glance)
[![CI](https://github.com/LinYS77/pi-glance/actions/workflows/ci.yml/badge.svg)](https://github.com/LinYS77/pi-glance/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)
[![pi](https://img.shields.io/badge/pi-package-7c3aed?style=flat-square)](https://pi.dev/packages/pi-glance)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/input-surface.png" alt="pi-glance 输入面板">
</p>

## 安装

```bash
# 仅在当前会话试用
pi -e npm:pi-glance

# 或长期安装
pi install npm:pi-glance
```

重启 Pi，或执行 `/reload`。

## 功能

- **圆角编辑器** — 保留 Pi 原有的编辑、历史、自动补全和快捷键行为。
- **自适应状态栏** — Git · 费用 · 模型速度 · 上下文 · Tokens · 模型。
- **运行提示** — 默认在路径和连接横线上显示扫光，右侧状态信息保持静止。
- **22 套配色** — 可分别选择亮色与暗色方案，并实时预览。
- **设置** — 在 `/glance` 中选择配色、开关状态项或调整顺序。

默认使用普通字符图标，没有额外的运行时依赖，也不收集遥测数据。

## 设置

执行：

```text
/glance
```

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png" alt="pi-glance 设置面板">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif" alt="pi-glance 主题预览">
</p>

修改会实时显示在预览中。按 `D` 可以查看状态栏在完整、紧凑和极简宽度下的折叠效果。

在 **General → Working animation** 中关闭扫光，可恢复 Pi 原生 Working 提示。选中该设置即可预览动画，按 `S` 保存后生效，不会重建编辑器或清空正在输入的内容。

## 说明

- 普通图标适用于常规终端字体；Nerd Font 图标可在 `/glance` → **General** → **Icons** 中开启。
- Pi 只提供一个自定义编辑器位置，因此最后加载的编辑器扩展会生效。
- 基于 Pi 0.84.4 开发，并在 0.84.4 和 0.85.1 上验证，需要 Node.js 22.19.0 或更高版本。
- Glance 会遵循 Pi 的终端真彩色能力，并在不可用时回退到 ANSI 256 色。
- Context 告警颜色依据 Pi 报告的百分比，包括仅显示 Tokens 的模式。
- Bash 输入（`!` / `!!`）保留 Pi 原生边框颜色，普通提示词继续使用所选 Glance 配色。
- 只使用 Pi 公开的扩展 API。

## 更新

```bash
pi update npm:pi-glance
```

## 参与贡献

欢迎提交 Issue 和 Pull Request。代码结构与实现说明见 [CONTEXT.md](./CONTEXT.md)。

源码位于 `src/`，测试位于 `tests/`，Pi 扩展入口为 `index.ts`。

```bash
npm ci
npm run check
npm test
npm run pack:dry
```

## 许可证

[MIT](LICENSE) © 2026 linys77
