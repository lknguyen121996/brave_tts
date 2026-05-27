const { spawnSync } = require("child_process");
const path = require("path");

const tests = [
  { name: "ui", file: "run-ui-test.js" },
  { name: "edge", file: "run-edge-test.js" },
  { name: "docs", file: "run-docs-test.js" },
];

let failed = 0;

for (const test of tests) {
  console.log(`\n=== ${test.name} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, test.file)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\n${failed}/${tests.length} test suite(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} test suites passed`);
