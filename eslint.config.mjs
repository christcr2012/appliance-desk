import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(^|\\s)(dark:)?(bg|text|border|ring|divide|outline|placeholder)-(slate|gray|neutral|zinc)-\\d/]",
          message:
            "Use Evergreen semantic color tokens instead of hard-coded neutral Tailwind colors.",
        },
        {
          selector:
            "TemplateElement[value.raw=/(^|\\s)(dark:)?(bg|text|border|ring|divide|outline|placeholder)-(slate|gray|neutral|zinc)-\\d/]",
          message:
            "Use Evergreen semantic color tokens instead of hard-coded neutral Tailwind colors.",
        },
      ],
    },
  },
  // Evergreen tokens are mandatory in TSX so later work cannot reintroduce
  // the neutral Tailwind palette after Batch E9 removes it.
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
