import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Multilingual model (Italian works well), 384 dimensions, runs locally: no API key, no cost.
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIM = 384;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
  return extractor;
}

// e5 models expect "query: " for searches and "passage: " for indexed text.
async function embed(texts: string[], prefix: "query" | "passage"): Promise<number[][]> {
  const model = await getExtractor();
  const output = await model(
    texts.map((t) => `${prefix}: ${t}`),
    { pooling: "mean", normalize: true },
  );
  return output.tolist() as number[][];
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embed([text], "query");
  return vector;
}

export async function embedPassages(texts: string[]): Promise<number[][]> {
  return embed(texts, "passage");
}

// pgvector literal: "[0.1,0.2,...]"
export function toPgVector(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(6)).join(",")}]`;
}
