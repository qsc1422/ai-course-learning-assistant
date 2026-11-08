export const IMPORTANCE_VALUES = ['必背', '理解', '了解'] as const
export type Importance = (typeof IMPORTANCE_VALUES)[number]

export const DRAFT_STATUS = ['draft', 'adopted', 'modified', 'rejected'] as const
export type DraftStatus = (typeof DRAFT_STATUS)[number]

export const PARSE_STATUS = ['未解析', '解析中', '已解析', '解析失败', '未归类'] as const
export type ParseStatus = (typeof PARSE_STATUS)[number]

export const CHAPTER_STATUS = ['待整理', '可练习'] as const
export type ChapterStatus = (typeof CHAPTER_STATUS)[number]

export const QUESTION_TYPE = ['选择', '填空', '简答'] as const
export type QuestionType = (typeof QUESTION_TYPE)[number]

export const DIFFICULTY = ['基础', '变式', '综合'] as const
export type Difficulty = (typeof DIFFICULTY)[number]

export const INDEPENDENCE = ['独立答对', '提示后答对', '未答对', '依赖提示通过'] as const
export type Independence = (typeof INDEPENDENCE)[number]

export const NARRATION_STATUS = ['已讲清', '有缺口', '未复述'] as const
export type NarrationStatus = (typeof NARRATION_STATUS)[number]

export const MISTAKE_STATUS = ['未通过', '已通过'] as const
export type MistakeStatus = (typeof MISTAKE_STATUS)[number]

export const PREFERENCE_KIND = ['本章不考', '题型过易', '提示无效', '判断不认同', '题目有误'] as const
export type PreferenceKind = (typeof PREFERENCE_KIND)[number]

export const MASTERY_BAND = ['稳固', '一般', '薄弱', '样本不足'] as const
export type MasteryBand = (typeof MASTERY_BAND)[number]

export const JOB_STATUS = ['pending', 'running', 'done', 'failed'] as const
export type JobStatus = (typeof JOB_STATUS)[number]

export const TASK_KIND = ['知识点练习', '错题重做', '复述检验', '课前预习'] as const
export type TaskKind = (typeof TASK_KIND)[number]

export interface Course {
  id: string
  owner_id: string
  name: string
  code: string | null
  teacher: string | null
  semester: string | null
  exam_date: string | null
  next_class_at: string | null
  room: string | null
  created_at: string
}

export interface ClassSlot {
  id: string
  course_id: string
  weekday: number
  start_time: string
  end_time: string
  week_range: string | null
  room: string | null
  confidence: number
}

export interface Chapter {
  id: string
  course_id: string
  title: string
  seq: number
  status: ChapterStatus
}

export interface SourceFile {
  id: string
  course_id: string
  chapter_id: string | null
  storage_key: string
  filename: string
  mime: string
  size: number
  sha256: string
  parse_status: ParseStatus
  parse_note: string | null
  char_count: number
  page_count: number
  created_at: string
}

export interface Chunk {
  id: string
  file_id: string
  chapter_id: string | null
  page_no: number
  seq: number
  content: string
  source_type: string
  ocr_conf: number | null
}

export interface Evidence {
  chunk_id: string
  quote: string
}

export interface KpPayload {
  name: string
  summary: string
  importance: Importance
  evidence: Evidence[]
  confidence: number
}

export interface AiDraft {
  id: string
  course_id: string
  chapter_id: string | null
  type: string
  payload: unknown
  original_payload: unknown | null
  status: DraftStatus
  source_refs: string[] | null
  prompt_version: string | null
  model: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface KnowledgePoint {
  id: string
  course_id: string
  chapter_id: string
  draft_id: string | null
  name: string
  summary: string
  importance: Importance
  source_refs: string[]
  status: 'adopted' | 'modified'
  created_at: string
}

export interface QuestionOption {
  key: string
  text: string
}

export interface Question {
  id: string
  course_id: string
  chapter_id: string
  kp_id: string
  draft_id: string | null
  type: QuestionType
  difficulty: Difficulty
  stem: string
  options: QuestionOption[] | null
  answer: string
  rubric: string[] | null
  source_refs: string[]
  status: 'draft' | 'adopted' | 'rejected'
  created_at: string
}

export interface Attempt {
  id: string
  question_id: string
  kp_id: string
  answer: string
  result: 'correct' | 'partial' | 'wrong'
  independence: Independence
  hint_levels: number
  solution_shown: boolean
  duration_ms: number
  created_at: string
}

export interface Narration {
  id: string
  kp_id: string
  text: string
  status: NarrationStatus
  covered: string[]
  missing: string[]
  wrong: { claim: string; correction: string; source_refs: string[] }[]
  followups: string[]
  disagreed: boolean
  created_at: string
}

export interface Mistake {
  id: string
  course_id: string
  kp_id: string
  question_id: string
  wrong_count: number
  status: MistakeStatus
  last_attempt_at: string
}

export interface Preference {
  id: string
  course_id: string
  kind: PreferenceKind
  target_id: string | null
  note: string | null
  active: boolean
  created_at: string
}

export interface DailyTask {
  id: string
  course_id: string
  task_date: string
  kp_id: string | null
  kind: TaskKind
  title: string
  note: string
  done: boolean
  created_at: string
}

export interface MasterySnapshot {
  id: string
  course_id: string
  chapter_id: string
  score: number | null
  band: MasteryBand
  sample_size: number
  snap_date: string
  computed_at: string
}

export interface ActivityEntry {
  id: string
  course_id: string
  actor: 'ai' | 'me'
  text: string
  created_at: string
}

export interface JobRecord {
  id: string
  type: string
  payload: unknown
  status: JobStatus
  attempts: number
  locked_at: string | null
  error: string | null
  result?: unknown
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

export interface ChapterMastery {
  chapterId: string
  title: string
  score: number | null
  band: MasteryBand
  sampleSize: number
  kpCount: number
  weakKps: { id: string; name: string; score: number }[]
}
