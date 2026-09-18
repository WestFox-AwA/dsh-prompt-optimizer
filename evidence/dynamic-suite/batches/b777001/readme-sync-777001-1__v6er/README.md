# tool

## Usage

```
node tool.mjs [--dry-run] [--json] [--quiet] [--force] [--help] [file]
```

Reads `file` and prints its contents with the leading and trailing whitespace trimmed.
`file` is optional and defaults to `input.txt`. Options and the file may appear in any
order; any argument starting with `--` is treated as an option, and the first argument
that does not start with `--` is used as the file.

### Options

| Option | Effect |
| --- | --- |
| `--help` | Prints the usage line below and exits with status 0. Takes precedence over every other option and does not read any file. |
| `--json` | Prints `{"file":"<file>","lines":<n>}` instead of the file contents, then exits. `<n>` counts the elements produced by splitting the file on `\n`. |
| `--quiet` | Suppresses the file contents. On its own it prints nothing; the `(dry run)` marker from `--dry-run` is still printed. |
| `--dry-run` | After the normal output, prints the line `(dry run)`. It reads the file and prints its contents, so it is a preview marker only, not a "do not touch anything" mode. |
| `--force` | Accepted by the argument parser but has no effect. It appears in the usage line printed by `--help`; the script does not implement it. |

Precedence: `--help` wins over everything else; `--json` wins over `--quiet` and
`--dry-run`; `--quiet` only hides the contents and never hides the `(dry run)` marker.

### Examples

Given an `input.txt` containing:

```
hello
world
```

Print the contents:

```
$ node tool.mjs input.txt
hello
world
```

The file argument is optional and defaults to `input.txt`:

```
$ node tool.mjs
hello
world
```

Count the lines as JSON:

```
$ node tool.mjs --json input.txt
{"file":"input.txt","lines":3}
```

Note that `input.txt` ends with a newline, so the line count is 3, not 2.

Print nothing except the dry-run marker:

```
$ node tool.mjs --quiet --dry-run input.txt
(dry run)
```

`--dry-run` on its own still prints the file contents, followed by the marker:

```
$ node tool.mjs --dry-run input.txt
hello
world
(dry run)
```

Show usage:

```
$ node tool.mjs --help
usage: tool.mjs [--dry-run] [--json] [--quiet] [--force] <file>
```

### Errors

Except when `--help` is given, the script reads the file before doing anything else. If
the file cannot be read (for example a missing `input.txt` when no file argument is
passed), Node.js throws an `ENOENT` error and the process exits with status 1; nothing is
printed to stdout.
