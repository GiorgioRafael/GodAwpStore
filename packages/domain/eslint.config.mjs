import { defineConfig } from "eslint/config";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextTs,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
]);
