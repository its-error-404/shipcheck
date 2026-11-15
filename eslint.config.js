// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "artifacts/**", "runs/**", "**/dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Arrow functions for standalone functions; classes only for stateful services.
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // TypeScript `enum` is banned in favour of `as const` arrays/objects (see docs/coding-standards.md).
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use an `as const` array/object instead of enum." },
      ],
    },
  },
  {
    files: ["**/test/**/*.ts", "**/testing/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
  prettier,
);
