import type { Difficulty, Evidence, Importance, QuestionOption, QuestionType } from '../domain'

export interface AiChunk {
  id: string
  content: string
  page_no: number
  filename?: string
}

export interface ExtractInput {
  chapterTitle: string
  chunks: AiChunk[]
}

export interface KpForQuestion {
  id: string
  name: string
  summary: string
  importance: Importance
  evidence: Evidence[]
  evidenceText: string
}

export interface QuestionPreferences {
  tooEasyTypes: QuestionType[]
  bunnyQuestions: string[]
  hintIneffective: boolean
}

export interface GeneratedQuestion {
  type: QuestionType
  difficulty: Difficulty
  stem: string
  options: QuestionOption[] | null
  answer: string
  rubric: string[] | null
  source_refs: string[]
}

export interface NarrationResult {
  needsMore?: boolean
  covered: string[]
  missing: string[]
  wrong: { claim: string; correction: string; source_refs: string[] }[]
  followups: string[]
}

export interface HintInput {
  level: 1 | 2 | 3
  kp: KpForQuestion
  wrongAnswer: string
  previousHints: string[]
}

export interface NarrationInput {
  kp: KpForQuestion
  text: string
  chunks: AiChunk[]
}

export interface AiProvider {
  id: string
  label: string
  kind: 'local' | 'llm'
  extractKnowledgePoints(input: ExtractInput): Promise<
    { name: string; summary: string; importance: Importance; evidence: Evidence[]; confidence: number }[]
  >
  generateQuestions(input: {
    kp: KpForQuestion
    siblings: { name: string; summary: string }[]
    preferences: QuestionPreferences
  }): Promise<GeneratedQuestion[]>
  hint(input: HintInput): Promise<string>
  evaluateNarration(input: NarrationInput): Promise<NarrationResult>
}
