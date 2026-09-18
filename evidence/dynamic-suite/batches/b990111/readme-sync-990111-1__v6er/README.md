# tool

读取一个文本文件，默认把内容（去掉首尾空白）打印到标准输出。

## Usage（调用方式）

```
node tool.mjs [--dry-run] [--json] [--quiet] [--force] [<file>]
```

参数可以写在 `<file>` 前面或后面，脚本只把以 `--` 开头的参数当作选项，其余参数里**第一个**作为文件名。

## 参数与选项

| 参数／选项 | 必填 | 默认值 | 行为（依据 tool.mjs 实际行为） |
| --- | --- | --- | --- |
| `<file>`（位置参数） | 否 | `input.txt` | 要读取的文件路径，直接交给 `readFileSync(file, 'utf8')`。省略时读 `input.txt`。不是 `--` 开头的参数都参与该判断，取其中第一个。文件不存在时脚本抛 `ENOENT` 且以退出码 1 结束。 |
| `--help` | 否 | — | 打印 `usage: tool.mjs --dry-run --json --quiet --force <file>` 并立即以退出码 0 结束；优先于其他所有选项和读文件动作，`--help` 一旦出现就不会读取任何文件。 |
| `--dry-run` | 否 | 关 | 内容打印完之后，再打印一行 `(dry run)`。 |
| `--json` | 否 | 关 | 打印 `{"file":"<file>","lines":<行数>}` 并立即结束。`<file>` 是解析出的文件名原值（用户没给就是 `input.txt`），`<行数>` = 文件内容按 `\n` 切分后的数组长度，因此以换行结尾的文件会比可见行数多 1。 |
| `--quiet` | 否 | 关 | 抑制内容输出（不打内容）。与 `--dry-run` 同用时仍然打印 `(dry run)`。 |
| `--force` | 否 | 关 | 仅出现在脚本的 `--help` 文案里，实际不被读取，对行为没有任何影响。 |

选项优先级：`--help` > `--json` > （内容输出，受 `--quiet` 控制） > （`--dry-run` 提示）。命中 `--help` 或 `--json` 时脚本直接 `process.exit(0)`，后面的分支不再执行。

## 示例

仓库内自带 `input.txt`，内容为：

```
hello
world
```

按 tool.mjs 原样跑通的实际输出：

```console
$ node tool.mjs input.txt
hello
world
```

```console
$ node tool.mjs
hello
world
```

（省略文件名时读默认的 `input.txt`，所以在该目录下输出同上。）

```console
$ node tool.mjs --json input.txt
{"file":"input.txt","lines":3}
```

（`input.txt` 以换行结尾，按 `\n` 切分为 3 段。）

```console
$ node tool.mjs --quiet input.txt
```

（`--quiet` 下无任何输出。）

```console
$ node tool.mjs --dry-run input.txt
hello
world
(dry run)
```

```console
$ node tool.mjs --dry-run --quiet input.txt
(dry run)
```

```console
$ node tool.mjs --json --dry-run --quiet --force input.txt
{"file":"input.txt","lines":3}
```

（`--json` 先命中并直接退出，`--dry-run`、`--quiet`、`--force` 都不起作用。）

```console
$ node tool.mjs --help
usage: tool.mjs --dry-run --json --quiet --force <file>
```

## 待确认

以下行为脚本里没有明确处理，不做臆测：

- `--force`：只写在 `--help` 文案中，脚本未读取该标志。它的预期用途（是否原本打算覆盖某些保护、是否只是占位）**待确认**。
- 多个位置参数时取第一个、其余被忽略（例如 `node tool.mjs a.txt b.txt` 只读 `a.txt`，b.txt 存在与否都不影响）：这属于实现细节，是否是设计意图**待确认**。
- `--json` 的 `lines` 使用按 `\n` 切分的长度，对以换行结尾的文件会比"可见行数"多 1：该计数口径是否为预期**待确认**。
- 读文件失败（文件不存在／不可读）时直接抛出 Node 的 `ENOENT` 堆栈、退出码 1，脚本没有自己的错误提示与退出码约定：失败时的提示形态**待确认**。
- 除上述几个 `--` 选项外的其他参数（如 `--verbose`）会被静默忽略、不报错：未知选项应当报错还是忽略**待确认**。
