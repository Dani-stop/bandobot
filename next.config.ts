import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedding model runs server-side with ONNX Runtime: keep these out of the bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
