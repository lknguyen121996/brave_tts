const { spawnSync } = require("child_process");
const path = require("path");

const suites = [
  { name: "UI", file: "run-ui-test.js" },
  { name: "Popup", file: "run-popup-test.js" },
  { name: "Edge", file: "run-edge-test.js" },
  { name: "Reload", file: "run-reload-test.js" },
  { name: "Docs", file: "run-docs-test.js" },
];

let passed = 0;
let failed = 0;

for (const { name, file } of suites) {
  console.log(`\n--- ${name} ---`);
  const result = spawnSync("node", [path.join(__dirname, file)], {
    stdio: "inherit",
    timeout: 120000,
  });
  if (result.status === 0) {
    console.log(`✅ ${name} PASSED`);
    passed++;
  } else {
    console.log(`❌ ${name} FAILED`);
    failed++;
  }
}

console.log(`\n${passed}/${suites.length} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
