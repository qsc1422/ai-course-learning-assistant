import type { AiProvider } from './types'
import { createLocalProvider } from './local'
import { createLlmProvider } from './llm'

let cached: AiProvider | null = null

export function getProvider(): AiProvider {
  if (!cached) {
    cached = process.env.LLM_API_KEY ? createLlmProvider() : createLocalProvider()
  }
  return cached
}

export function engineLabel(): { label: string; kind: 'local' | 'llm' } {
  const provider = getProvider()
  return { label: provider.label, kind: provider.kind }
}
