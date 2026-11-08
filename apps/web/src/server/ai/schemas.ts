import { z } from 'zod'

export const evidenceSchema = z.object({
  chunk_id: z.string().min(1),
  quote: z.string().min(1),
})

export const kpPointSchema = z.object({
  name: z.string().min(2).max(40),
  summary: z.string().min(4).max(200),
  importance: z.enum(['必背', '理解', '了解']),
  evidence: z.array(evidenceSchema).min(1),
  confidence: z.number().min(0).max(1),
})

export const extractionSchema = z.object({
  points: z.array(kpPointSchema).max(24),
})

export const questionOptionSchema = z.object({
  key: z.string().min(1).max(2),
  text: z.string().min(1),
})

export const generatedQuestionSchema = z.object({
  type: z.enum(['选择', '填空', '简答']),
  difficulty: z.enum(['基础', '变式', '综合']),
  stem: z.string().min(4),
  options: z.array(questionOptionSchema).min(2).max(6).nullable(),
  answer: z.string().min(1),
  rubric: z.array(z.string()).nullable(),
  source_refs: z.array(z.string()).min(1),
})

export const questionListSchema = z.object({
  questions: z.array(generatedQuestionSchema).min(1),
})

export const narrationSchema = z.object({
  covered: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
  wrong: z
    .array(
      z.object({
        claim: z.string().min(1),
        correction: z.string().min(1),
        source_refs: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  followups: z.array(z.string()).default([]),
})

export const hintSchema = z.object({
  text: z.string().min(4).max(400),
})

export type ExtractedPoint = z.infer<typeof kpPointSchema>
export type GeneratedQuestionPayload = z.infer<typeof generatedQuestionSchema>
