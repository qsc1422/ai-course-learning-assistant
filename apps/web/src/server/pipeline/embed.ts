const DIM = 1024

function localEmbedding(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0)
  const cleaned = text.replace(/\s+/g, '')
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    for (let size = 2; size <= 3; size += 1) {
      const gram = cleaned.slice(i, i + size)
      if (gram.length < size) continue
      let hash = 2166136261
      for (let j = 0; j < gram.length; j += 1) {
        hash = Math.imul(hash ^ gram.charCodeAt(j), 16777619)
      }
      vector[(hash >>> 0) % DIM] += 1
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return norm > 0 ? vector.map((value) => value / norm) : vector
}

export async function embedText(text: string): Promise<number[]> {
  const ollama = process.env.OLLAMA_URL
  if (ollama) {
    try {
      const response = await fetch(`${ollama.replace(/\/$/, '')}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.EMBEDDING_MODEL ?? 'bge-m3', input: text }),
        signal: AbortSignal.timeout(20_000),
      })
      if (response.ok) {
        const data = (await response.json()) as { embeddings?: number[][] }
        const vector = data.embeddings?.[0]
        if (Array.isArray(vector) && vector.length > 0) {
          if (vector.length === DIM) return vector
          const resized = new Array<number>(DIM).fill(0)
          vector.slice(0, DIM).forEach((value, index) => {
            resized[index] = value
          })
          return resized
        }
      }
    } catch {
      // 向量化失败不影响解析主流程，回退到本地确定性向量
    }
  }
  return localEmbedding(text)
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value.toFixed(6) : '0')).join(',')}]`
}
