<div align="center">

# ◌ pi-glance

**[Pi](https://github.com/earendil-works/pi) 的圆角编辑器与状态栏。**

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

- **圆角编辑器** — 保留 Pi 原有的编辑、历史、自动补全和快捷键。
- **自适应状态栏** — Git · 费用 · 模型速度 · 上下文 · Tokens · 模型，随终端宽度折叠。
- **输入暂存** — `alt+s` 暂存提示词，再按恢复；输入框已有新内容时，两份内容交换。
- **Working 扫光** — Pi 工作时，扫光绕输入框或沿顶部移动，速度可调。
- **22 套配色** — 分别选择亮色与暗色方案，实时预览。

无额外运行时依赖，不收集遥测数据。

## 设置

运行 `/glance`，设置 **Appearance（外观）**、**Status line（状态栏）**、**Working（工作动画）** 和 **Input（输入）**。`Tab` 切换分区，方向键调整，`S` 保存；暂存快捷键在 Input 中修改。

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png" alt="pi-glance 设置面板">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif" alt="pi-glance 主题预览">
</p>

## 说明

- 默认使用 Nerd Font 图标。使用普通字体时，可在 `/glance` → **Appearance** → **Icons** 中选择 `Plain`。
- Git 默认及旧配置升级均使用 **Summary**，显示变更文件数和已跟踪内容的增删行数。**Auto fetch** 每 5 分钟更新上游，可在 **Status line → Git** 关闭。
- 草稿按会话保存在本机，重载后可取回，恢复后删除；`--no-session` 仅使用内存。
- Pi 只提供一个自定义编辑器位置，最后加载的编辑器扩展会生效。
- 已在 Pi 0.84.4 和 0.85.1 上验证，需要 Node.js 22.19.0 或更高版本。

## 更新

```bash
pi update npm:pi-glance
```

## 参与贡献

欢迎提交 Issue 和 Pull Request。开发说明见 [CONTEXT.md](./CONTEXT.md)。

## 许可证

[MIT](LICENSE) © 2026 linys77
