function evaluateFormula(str) {
  try {
    if (!str.includes("{{=")) return true;

    const formula = str.match(/{{=(.*?)}}/);
    if (!formula) return true;

    Function(`"use strict"; return (${formula[1]})`)();
    return true;
  } catch (e) {
    return false;
  }
}

// { input, expect: true = valid formula, false = should fail gracefully }
const tests = [
  { input: "{{= 1 + 1 }}",       expect: true  },
  { input: "{{= 10 * 2 }}",      expect: true  },
  { input: "{{= 'hello' }}",     expect: true  },
  { input: "{{= broken + 2 }}", expect: false }, // invalid ref — must fail gracefully, not crash
  { input: "no formula here",    expect: true  },
];

let ok = true;

tests.forEach(({ input, expect }) => {
  const result = evaluateFormula(input);
  if (result !== expect) {
    console.error("X Test failed for:", input, "| got:", result, "| expected:", expect);
    ok = false;
  }
});

if (!ok) {
  console.error("X Snippet engine check failed");
  process.exit(1);
}

console.log("OK Snippet engine passed all", tests.length, "tests");