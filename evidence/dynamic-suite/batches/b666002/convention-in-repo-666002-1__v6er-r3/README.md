# tool.mjs

Print the contents of a text file to stdout.

## Usage

```
node tool.mjs [--trim] [--number] <file>
```

Flags:

- `--trim` — trim leading and trailing whitespace from the file contents.
- `--number` — prefix every output line with its 1-based line number, separated by a tab (the line text itself is left unchanged).

## Examples

```
node tool.mjs input.txt
node tool.mjs --number input.txt
```
