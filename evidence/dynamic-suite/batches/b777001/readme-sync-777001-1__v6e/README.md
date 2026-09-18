# tool

## Usage

```
tool.mjs [--dry-run] [--json] [--quiet] [--force] <file>
```

`<file>` defaults to `input.txt` when no file argument is given.

## Options

- `--json` — print a JSON object `{"file":"<file>","lines":<n>}` instead of the file text.
- `--dry-run` — after printing, print the line `(dry run)`.
- `--quiet` — suppress the file text (the `(dry run)` line still prints).
- `--force` — accepted, no effect.
- `--help` — print the usage line above and exit.

The file text is printed with surrounding whitespace trimmed.

## Examples

Read the default `input.txt`:

```
node tool.mjs
```

```
hello
world
```

Print `input.txt` as JSON:

```
node tool.mjs --json input.txt
```

```
{"file":"input.txt","lines":3}
```

Print without the file text, then the dry-run marker:

```
node tool.mjs --quiet --dry-run input.txt
```

```
(dry run)
```
