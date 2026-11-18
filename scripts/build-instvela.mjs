import { access, copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const siteRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.resolve(process.argv[2] || path.join(siteRoot, "../instrument-vela-models-onnx"));
const demoRoot = path.join(sourceRoot, "demo");
const output = path.join(siteRoot, "instvela");
const base = "/instvela/";
const requireDemo = createRequire(path.join(demoRoot, "package.json"));
const mainFile = path.join(demoRoot, "src/main.js");
const ortRoot = path.resolve(path.dirname(requireDemo.resolve("onnxruntime-web")), "..");

// These are the runtime files loaded by ort.all.min.mjs for WebGPU and WASM.
const runtimeFiles = [
  "ort.all.min.mjs",
  "ort.all.min.mjs.map",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

// Check inputs before Vite empties the output directory.
for (const file of runtimeFiles) await access(path.join(ortRoot, "dist", file));

const viteRoot = path.dirname(requireDemo.resolve("vite/package.json"));
const { build } = await import(pathToFileURL(path.join(viteRoot, "dist/node/index.js")).href);
await build({
  configFile: false,
  root: demoRoot,
  base,
  resolve: { alias: {
    "@instvela-models": path.join(siteRoot, "homepage/instvela-models.js"),
    "@instvela-songs": path.join(demoRoot, "songs"),
    "@instvela": path.join(demoRoot, "src"),
  } },
  plugins: [{
    name: "instvela-static-paths",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0] !== mainFile) return;
      const replacements = [
        ['const MODELS_URL = `/models/${MODEL_SET}`;',
          'const MODELS_URL = getInstvelaModelUrl(MODEL_SET);'],
        ['new URL("/ort/ort.all.min.mjs", location.origin)',
          'new URL("ort/ort.all.min.mjs", publicUrl)'],
      ];
      for (const [from, to] of replacements) {
        if (!code.includes(from)) throw new Error(`The demo's URL setup changed: missing ${from}`);
        code = code.replace(from, to);
      }
      return {
        code: 'import { getInstvelaModelUrl } from "@instvela-models";\n' + code,
        map: null,
      };
    },
  }],
  build: {
    outDir: output,
    emptyOutDir: true,
    // Keep MIDI examples as files instead of embedding them in JavaScript.
    assetsInlineLimit: 0,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        app: path.join(demoRoot, "index.html"),
        "homepage-demo": path.join(siteRoot, "homepage/instvela-demo.js"),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "homepage-demo" ? "homepage-demo.js" : "assets/[name]-[hash].js",
      },
    },
  },
  worker: { format: "es" },
});

await mkdir(path.join(output, "ort"), { recursive: true });
for (const file of runtimeFiles) {
  await copyFile(path.join(ortRoot, "dist", file), path.join(output, "ort", file));
}
for (const file of ["LICENSE", "LICENSE-APACHE-2.0", "NOTICE"]) {
  await copyFile(path.join(sourceRoot, file), path.join(output, file));
}
await copyFile(path.join(sourceRoot, "assets/vela-logo.png"), path.join(output, "logo.png"));
await copyFile(path.join(demoRoot, "node_modules/@breezystack/lamejs/LICENSE"), path.join(output, "LICENSE-lamejs"));
console.log(`Built InstVELA at ${output} (served from ${base}).`);
