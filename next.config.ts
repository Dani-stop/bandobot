import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedding model runs server-side with ONNX Runtime: keep these out of the bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  // Vercel functions are capped at 250 MB: ship only the Linux x64 ONNX binary and leave out the
  // local model cache (downloaded to /tmp on first use instead) and the browser builds.
  // transformers.js requires onnxruntime-node dynamically, so file tracing misses it: include it explicitly.
  outputFileTracingIncludes: {
    "/api/**": [
      "node_modules/onnxruntime-node/package.json",
      "node_modules/onnxruntime-node/dist/**",
      "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "node_modules/onnxruntime-common/**",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      "node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**",
      "node_modules/onnxruntime-web/**",
      "node_modules/@huggingface/transformers/.cache/**",
      "node_modules/@huggingface/transformers/dist/*.web*",
      "node_modules/@huggingface/transformers/dist/transformers.js",
      "node_modules/@huggingface/transformers/dist/transformers.min.js",
      "node_modules/@huggingface/transformers/dist/ort-wasm*",
      "docs/**",
      "scripts/**",
    ],
  },
};

export default nextConfig;
