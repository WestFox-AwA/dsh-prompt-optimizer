# 历史版本归档（old/）

> **这里不是最新版。** 最新版就在仓库根，见 [../README.md](../README.md)。

本目录存放 **0.1 ~ 0.6** 各代的历史产物，仅供查阅与回溯。
当前维护中的版本是 **0.7.x**（`@dsh-external/dsh-po06`），源码在仓库根的 [`po06/`](../po06)。

## 目录结构

```
old/
├── README.md         ← 本文件
├── 0.5/              ← 0.5 时代的源码（host 半 + 旧 bundle 配置 + 当时的 README）
│   ├── lib/
│   ├── cordis.patch.yml
│   ├── README.md     ← 0.5 当时的说明原文
│   └── README.en.md
└── tgz/              ← 各代已构建的安装包（可直接下载安装）
    ├── 0.1/  0.2/  0.3/  0.4/  0.5/
```

## 各代简介

| 代次 | 包名 | 形态 | 说明 |
|---|---|---|---|
| **0.1 – 0.3** | `@dsh-external/dsh-prompt-optimizer` | host + client 探针 | 骨架期：验证「回车/按钮拦截」这条通道本身可行，产物是一批 `-beta.N` 迭代包 |
| **0.4** | 同上 | 同上 | 拦截通道成型，开始出现稳定形状的设置项 |
| **0.5** | 同上 | 完整插件包（根目录 `lib/` + `cordis.patch.yml`） | 第一次做成能用的东西：依据搬运 + 五类缺口补齐器；源码已归入 [`0.5/`](0.5) |
| **0.6** | `@dsh-external/dsh-po06` | 完整插件包（`po06/`） | 架构重做（P1–P11）；未单独发布，直接演进成 0.7 |
| **0.7.x** | `@dsh-external/dsh-po06` | 当前版本 | 见仓库根 [README](../README.md) |

## 下载与安装历史版本

**方式一：直接下载本目录里的 tgz（推荐）**

各代构建产物在 [`tgz/`](tgz) 下按主次版本分组，例如 0.5 的那份：

```
old/tgz/0.5/dsh-external-dsh-prompt-optimizer-0.5.2-beta.1.tgz
```

在 GitHub 上点开该文件，用右上角 Download raw file 保存；或克隆仓库后本地取用。
然后在 DSH 里从本地路径安装：插件 → 添加插件 → 本地插件目录，指向解包后的目录；
也可以直接 `npm i <本地 tgz 路径>`。

**方式二：按 git tag 检出源码**

每一代都有对应 tag（`v0.5.0-beta.1`、`v0.4.6-beta.6` 等）：

```bash
git clone https://github.com/WestFox-AwA/dsh-prompt-optimizer
cd dsh-prompt-optimizer
git checkout v0.5.0-beta.1     # 换成你要的 tag
git tag | sort -V               # 列出全部可用 tag
```

**方式三：GitHub Release 页面**

历次发布的附件保留在：https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases

## 注意事项

- **历史版本不再维护**，其中的缺陷（包括 issue #15 那个硬编码路径问题）只在后代修复，不回溯修补；
- **不要用历史版本覆盖当前版本**：0.5 与 0.7 的**包名不同**（`dsh-prompt-optimizer` 对 `dsh-po06`）、装配配置不同，
  同时装上会触发双重拦截守卫 `DOUBLE_INTERCEPT` 而拒绝启用；
- 想装最新版，请回到 [仓库根 README](../README.md)。
