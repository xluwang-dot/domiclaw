import { pipeline, env } from "@xenova/transformers";
import { ragConfig } from "../../config.js";

(env as any).remoteHost = ragConfig.hfMirror;

let embedder: any = null;
let initializing: Promise<void> | null = null;

export function isEmbedderReady(): boolean {
  return embedder !== null;
}

export async function initEmbedder(
  modelName?: string,
): Promise<void> {
  if (embedder) return;
  if (initializing) return initializing;
  const name = modelName || ragConfig.embeddingModel;
  initializing = (async () => {
    embedder = await pipeline("feature-extraction", name);
  })();
  return initializing;
}

export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!embedder) throw new Error("模型未初始化");
  const result = await embedder(text, { pooling: "mean", normalize: true });
  return new Float32Array(result.data);
}

export function float32ToBlob(vector: Float32Array): Buffer {
  return Buffer.from(new Uint8Array(vector.buffer));
}

export function blobToFloat32(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}
