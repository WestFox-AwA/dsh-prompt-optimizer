# 注意事项：仓库根 package.json 是**薄壳**，真插件在 `po06/`

> 这份文件记的是一次**真实事故**。动仓库结构之前请先读完，否则会重犯。

## 现象

外部用户按直觉安装本插件——在 DSH「添加插件」对话框里填仓库地址：

```
https://github.com/WestFox-AwA/dsh-prompt-optimizer
```

**装到的是 `0.5.0`，不是最新的 0.7.x。**

## 触发条件

DSH 的安装入口（以及 `npm install <git-url>` 这类常规做法）在 clone 仓库之后，
读的是**仓库根目录的 `package.json`**——它不会去翻子目录找插件。

## 根因

仓库根曾经放着 **0.5.x 线的一份完整插件包**：

| 位置 | 事故当时 | 应当是 |
|---|---|---|
| 仓库根 `package.json` | `@dsh-external/dsh-prompt-optimizer` · **0.5.2-beta.1** · `main: ./lib/index.js` | 指向 po06 的薄壳 |
| `po06/package.json` | `@dsh-external/dsh-po06` · **0.7.4** | 真正的插件定义 |

于是**同一句「从仓库装」拿到了两个完全不同的东西**：访客拿到根包的 0.5.x，
而作者本机一直跑的是 `po06/` 里的 0.7.x——**本地怎么测都测不出来**。

## 正确做法（现状）

仓库根 `package.json` 现在是一层**薄壳**，逐字段从 `po06/package.json` 派生，
只把路径加上 `po06/` 前缀：

```jsonc
{
  "name": "@dsh-external/dsh-po06",     // 与子包同名，不再是另一个包
  "version": "0.7.4",                    // 与子包同版本
  "main": "./po06/lib/index.js",         // 指向真插件
  "files": ["po06/lib", "po06/runtime", "po06/cordis.patch.yml", ...],
  "dsh": { "bundle": { "patch": "./po06/cordis.patch.yml" }, ... }
}
```

**不变量**（改仓库结构时请守住）：

1. 根 `package.json` 的 `name` / `version` **必须等于** `po06/package.json` 的；
2. 根包所有入口路径（`main` / `exports` / `dsh.bundle.patch`）**必须落在 `po06/` 下**；
3. 根包的 `files` **必须包含 `po06/runtime`**——内置 bash 的 GNU bash/MSYS2 运行时在里面，
   漏了它插件能装但跑不了命令；
4. **发布时自动同步**：`po06-beta/make-release.mjs` 会从 `po06/package.json` 重新生成根包，
   不需要手工维护两份。

## 历史教训

根包与子包**各说各话**时，作者视角永远是"我这边是好的"——
因为作者跑的是子目录那份，而访客拿到的是根目录那份。
**判断标准只能是访客路径的实得结果**：用仓库地址走一遍安装，拿到的是不是当前版本。

## 相关

- 真正要改插件，改 `po06/` 下的东西，不是根目录；
- 根目录**没有**插件源码（0.5.x 的 `lib/` 已不再被根包引用）；
- 发布流程见 `po06-beta/make-release.mjs`。
