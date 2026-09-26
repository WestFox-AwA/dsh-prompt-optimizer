# 发布与更新工作流（RELEASING）

> 本文是**唯一**的发布操作规程。每次推送新版本，按本文从上到下逐项执行，不要跳步。
> 每一步都写了「怎么核对」——**做没做以核对结果为准，不以印象为准**。

## 一、仓库结构与规矩（先讲清楚，避免下次又乱）

```
dsh-prompt-optimizer/
├── README.md           ← 面向使用者的唯一入口：安装方法、当前版本号
├── RELEASING.md        ← 本文件（发布规程）
├── PACKAGING-NOTICE.md ← 打包避坑记录（根 package.json 为什么是薄壳）
├── package.json        ← 薄壳，自动从 po06/ 派生，不手工编辑
├── po06/               ← 当前版本的全部源码与包定义（唯一真源）
├── old/                ← 0.1~0.6 历史归档（含各代 tgz 与下载说明）
└── evidence/           ← 开发期证据留档
```

**四条不变量**（改结构时守住，违反任意一条就会重演「装到 0.5」那种事故）：

1. **版本号只有一个真源**：`po06/package.json` 的 `version`。根 `package.json` 由脚本派生，**手改无效**；
2. **根 `package.json` 必须等于 po06 的薄壳**：同名、同版本、所有路径带 `po06/` 前缀、`files` 含 `po06/runtime`；
3. **历史版本只进 `old/`**，仓库根不放任何 `.tgz`、不放旧源码；
4. **README 里的安装指向 = Release 的最新版**，两者必须同一版本号。

## 二、日常开发（不发布）

```bash
cd po06
node --test test/            # 或逐套跑：node test/xxx.test.mjs
```

**核对**：全部用例通过（当前基线 **49 套**）。有任何一套红，先修再谈发布。

改源码只改 `po06/` 下的东西。`old/` 只读，不修历史版本。

## 三、发布流程（逐项执行）

### 步骤 1 · 定版本号

编辑 `po06/package.json` 的 `version`，例如 `0.7.5`。

- 有后缀（`-beta.1`）⇒ 脚本会自动把 Release 标为 prerelease；
- 无后缀 ⇒ 正式版。

**核对**：`node -e "console.log(require('./po06/package.json').version)"` 打出的是你要发的号。

### 步骤 2 · 更新 CHANGELOG

在 `CHANGELOG.md` 顶部按既有格式加一节，写清：这一版**改了什么**、**为什么**、**影响谁**。

**核对**：最新一节的版本号与步骤 1 一致。

### 步骤 3 · 更新 README 的版本与安装指向

`README.md` 里凡是出现版本号、安装命令、Release 链接的地方，全部指向**本次要发的版本**。

**核对**：在 README 里搜旧版本号，应当**搜不到**（除历史说明章节外）。

### 步骤 4 · 跑全量回归

```bash
cd po06 && for f in test/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```

**核对**：无任何 FAIL 输出。

### 步骤 5 · 本地安装验证（真机，不可省）

发布前先在本机把它装上跑一次，确认**装得上、跑得起来**：

```bash
cd /path/to/dsh-prompt-optimizer
npm pack --pack-destination /tmp
```

然后检查产物（这一步防的是「包发出去了但内容不对」）：

ⓐ 解包看 `package.json` 的 `name` / `version` / `main` 是否指向本次版本；
ⓑ 确认 `po06/runtime/usr/bin/bash.exe` 与 `po06/cordis.patch.yml` **都在包内**（漏了 runtime 会出现「装上但跑不了命令」）。

### 步骤 6 · 提交并推送

```bash
git add -A
git commit -m "release: v0.7.5 —— <一句话说清这版做了什么>"
git push origin HEAD:main        # 一律推 main，不用 dev 分支承载最新版
```

**核对**：`git log --oneline -1` 是本次提交；`git status --porcelain` 为空。

> ⚠️ **当前仓库可能还在 `dev/0.6` 分支上**。发布前先确认：`git branch --show-current`。
> 若不是 `main`，先 `git checkout main && git merge dev/0.6`（或按需 cherry-pick）再推。

### 步骤 7 · 打 tag 并推

```bash
git tag v0.7.5
git push origin v0.7.5
```

**核对**：`git tag --list "v0.7.5"` 有输出；`git ls-remote --tags origin | grep v0.7.5` 远程也有。

### 步骤 8 · 生成 Release 并上传附件

用仓库里的发布脚本一步完成（它会：同步根包 → 校验 tag → 推送 → `npm pack` → 算 sha256 → 建 Release → 传附件 → 复查）：

```bash
node po06-beta/make-release.mjs
```

**核对（三项都要看）**：

- `releases/latest` 指向本次版本；
- **Release 的附件非空**（曾经出现过附件为空的 Release，肉眼不看就发不出去）；
- 附件的 sha256 与本地算出来的一致。

### 步骤 9 · 事后核对「访客路径」

**这一步是最后的防线**：模拟一个陌生访客，用**仓库地址**安装，确认拿到的是本次版本。

**核对**：从 GitHub 页面按 README 的方法走一遍，看到的版本号 = 步骤 1 定的号。

## 四、发布前检查清单（可直接照抄执行）

```
[ ] 1  po06/package.json 的 version 已改
[ ] 2  CHANGELOG.md 顶部有对应一节
[ ] 3  README 里旧版本号已全部替换（搜过）
[ ] 4  49 套测试全绿
[ ] 5  npm pack 产物里 name/version/main 正确、runtime 与 patch 都在
[ ] 6  已提交，工作树干净，且**推的是 main**
[ ] 7  tag 已打并推到远程
[ ] 8  Release 已建、**附件非空**、sha256 一致
[ ] 9  用仓库地址走一遍访客路径，拿到的是本次版本
```

## 五、出问题时的排查顺序

| 症状 | 先看这里 |
|---|---|
| 访客装到的是旧版本 | 根 `package.json` 是否还是薄壳（`name`/`version`/`main` 是否指向 po06） |
| 装上了但命令跑不了 | 包里有没有 `po06/runtime/` |
| Release 没有附件 | 重跑步骤 8；脚本会重建 Release |
| 推送被拒 | 当前分支是否是 main；先 `git pull --rebase origin main` |
| 测试红了 | 先修测试再发布；**不要**为了发版跳过红用例 |

## 六、为什么这样设计（一句话版）

- **真源唯一**（`po06/`）：避免"两个 package.json 各说各话"——那正是外部用户装到 0.5 的原因；
- **历史进 `old/`**：主线永远只有最新版，读者不需要猜哪个是最新；
- **访客路径必须复核**：作者本机的成功不代表访客的成功，两者读的可能是不同的文件。
