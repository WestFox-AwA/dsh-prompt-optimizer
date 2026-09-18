# tool

## Usage

```
node tool.mjs [--dry-run] [--json] [--quiet] [--force] <file>
```

`<file>` defaults to `input.txt` when omitted.

## Options

- `--help` — print the usage line and exit.
- `--json` — print `{"file": "<file>", "lines": <n>}` and exit.
- `--quiet` — do not print the file contents.
- `--dry-run` — print `(dry run)`.
- `--force` — accepted; no additional effect.

## Output

Prints the file contents with leading and trailing whitespace trimmed. With
`--json` it prints the file name and line count instead; with `--quiet` it
prints nothing unless `--dry-run` is also given.
