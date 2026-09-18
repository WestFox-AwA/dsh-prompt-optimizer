# tool.mjs

A tiny CLI that reads a text file, trims it, and prints the result.

## Usage

Run: `node tool.mjs [--trim] [--number] <file>`

Flags: `--trim` trims surrounding whitespace; `--number` prefixes every output line with its 1-based line number.

## Example

```sh
node tool.mjs --number input.txt
```

```txt
1 hello world
```

## Tests

```sh
node --test
```
