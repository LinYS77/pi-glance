<div align="center">

# ◌ pi-glance

**一个简洁、安静的 [Pi](https://github.com/earendil-works/pi) 输入面板。**

圆角多行编辑器，以及会随宽度自动折叠的<br>
Git、费用、模型速度、上下文、Tokens 与模型信息。

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

## 它带来了什么

- **圆角编辑器** — 保留 Pi 原有的编辑、历史、自动补全和快捷键行为。
- **自适应状态信息** — Git · 费用 · 模型速度 · 上下文 · Tokens · 模型。
- **22 套配色** — 可分别选择亮色与暗色方案，并实时预览。
- **一个设置面板** — 所有显示选项都集中在 `/glance`。
- **默认保持安静** — 使用普通字符图标，不收集遥测数据，也没有运行时依赖。

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

## 说明

- 普通图标适用于常规终端字体；Nerd Font 图标可在 `/glance` → **General** → **Icons** 中开启。
- Pi 只提供一个自定义编辑器位置，因此最后加载的编辑器扩展会生效。
- 基于 Pi 0.84.4 开发并测试，需要 Node.js 22.19.0 或更高版本。
- Glance 会遵循 Pi 的终端真彩色能力，并在不可用时回退到 ANSI 256 色。
- Context 告警颜色依据 Pi 报告的百分比，包括仅显示 Tokens 的模式。
- Bash 输入（`!` / `!!`）保留 Pi 原生边框颜色，普通提示词继续使用所选 Glance 配色。
- 只使用 Pi 公开的扩展 API。

## 更新

```bash
pi update npm:pi-glance
```

## 参与贡献

欢迎提交 Issue 和 Pull Request。[CONTEXT.md](./CONTEXT.md) 是持续维护的代码导览与设计说明。

生产代码位于 `src/`，行为测试与独立视觉快照位于 `tests/`。Pi 入口仍为 `index.ts`。

```bash
npm ci
npm run check
npm test
npm run pack:dry
```

## 许可证

[MIT](LICENSE) © 2026 linys77
