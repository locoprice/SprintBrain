function evaluateFormula(str) {
  try {
    if (!str.includes("{{=")) return true;

    const formula = str.match(/{{=(.*?)}}/);
    if (!formula) return true;

    Function(`"use strict"; return (${formula[1]})`)();
    return true;
  } catch (e) {
    console.error("❌ Error in:", str);
    return false;
  }
}

// test base
const tests = [
  "{{= 1 + 1 }}",
  "{{= 10 * 2 }}",
  "{{= broken + 2 }}"
];

let ok = true;

tests.forEach(t => {
  if (!evaluateFormula(t)) ok = false;
});

if (!ok) {
  console.error("❌ Snippet engine failed");
  process.exit(1);
}

console.log("✅ Snippet engine OK");