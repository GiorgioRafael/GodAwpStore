import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Alguns testes de componente renderizam telas grandes e disparam dezenas de
    // eventos; o tempo deles depende da carga da maquina, nao do que esta sendo
    // verificado. O padrao de 5s ja deixava o editor de mensagens do bot a menos
    // de um segundo do limite, entao qualquer arquivo novo o derrubava.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["src/app/**", "src/proxy.ts"],
    },
  },
});
