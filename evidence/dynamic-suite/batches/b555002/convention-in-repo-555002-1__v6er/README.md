# tool

读取文本文件并把内容打印到标准输出。

## 用法

```sh
node tool.mjs <file>
```

`<file>` 省略时读取 `input.txt`。

## 参数

- `--reverse`：把输出逐行倒序后写出——最先输出的那行最后输出，每行内容本身不变；`--reverse` 只影响写出顺序，文件读取与 `.trim()` 处理与不带该参数时完全一致。
- `--trim`：去除输出首尾空白。
- `--help`：打印用法并以退出码 0 结束。

参数以 `--` 开头，可任意顺序出现在文件参数之前或之后。

不带 `--reverse` 时，输出与之前完全一致。

## 示例

```sh
node tool.mjs --reverse input.txt
```
