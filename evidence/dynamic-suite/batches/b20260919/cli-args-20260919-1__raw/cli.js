'use strict';

let name = 'anon';
let count = 2;
let verbose = false;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--name=')) {
    name = arg.slice('--name='.length);
  } else if (arg.startsWith('--count=')) {
    count = Number(arg.slice('--count='.length));
  } else if (arg === '--verbose') {
    verbose = true;
  } else {
    process.stderr.write('unknown flag: ' + arg + '\n');
    process.exit(2);
  }
}

process.stdout.write('name=' + name + ' count=' + count + ' verbose=' + (verbose ? 'true' : 'false') + '\n');
