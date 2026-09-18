'use strict';

const args = process.argv.slice(2);

let name = 'anon';
let count = '2';
let verbose = false;

for (const arg of args) {
  if (arg === '--verbose') {
    verbose = true;
  } else if (arg.startsWith('--name=')) {
    name = arg.slice('--name='.length);
  } else if (arg.startsWith('--count=')) {
    count = arg.slice('--count='.length);
  } else {
    process.stderr.write('unknown flag: ' + arg + '\n');
    process.exit(2);
  }
}

process.stdout.write('name=' + name + ' count=' + count + ' verbose=' + (verbose ? 'true' : 'false') + '\n');
