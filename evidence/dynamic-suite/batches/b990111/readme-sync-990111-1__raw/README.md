# tool

## Usage

```
node tool.mjs [--dry-run] [--json] [--quiet] [--force] [file]
```

`file` defaults to `input.txt` when omitted.

## Flags

- `--help` — print the usage line and exit.
- `--json` — print `{"file": <file>, "lines": <line count>}` instead of the file text.
- `--quiet` — suppress printing the file text.
- `--dry-run` — after the normal output, print `(dry run)`.
- `--force` — accepted but currently has no effect.

## Behavior

Reads the given file and prints its trimmed contents, unless `--quiet` or `--json` is passed.
