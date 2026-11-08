import { z } from 'zod'
import type { AiProvider, GeneratedQuestion, NarrationResult } from './types'
import {
  extractionSchema,
  generatedQuestionSchema,
  hintSchema,
  questionListSchema,
  narrationSchema,
} from './schemas'
import { normalizeText, truncate } from './text'

const SYSTEM = `你是一门大学课程的学习助手。你只依据用户提供的课程资料原文工作，不补充资料之外的知识。
所有输出必须是严格 JSON，不要输出 Markdown 或解释文字。宁可少输出，也不要编造。`

async function chatJSON<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const baseUrl = (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/$/, '')
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) throw new Error('未配置 LLM_API_KEY')
  const model = process.env.LLM_MODEL ?? 'deepseek-chat'

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${SYSTEM}${lastError ? `\n上一次输出未通过校验：${lastError}。请修正后重新输出完整 JSON。` : ''}` },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      lastError = `HTTP ${response.status}: ${truncate(await response.text(), 200)}`
      continue
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content ?? ''
    try {
      const parsed = JSON.parse(content)
      const result = schema.safeParse(parsed)
      if (result.success) return result.data
      lastError = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'JSON 解析失败'
    }
  }
  throw new Error(`模型输出未通过校验：${lastError}`)
}

export function createLlmProvider(): AiProvider {
  return {
    id: process.env.LLM_MODEL ?? 'deepseek-chat',
    label: process.env.LLM_MODEL ?? 'DeepSeek',
    kind: 'llm',

    async extractKnowledgePoints({ chapterTitle, chunks }) {
      const plain = chunks
        .map((chunk) => `【chunk_id=${chunk.id}｜第${chunk.page_no}页】${truncate(chunk.content, 600)}`)
        .join('\n')
        .slice(0, 12_000)

      const data = await chatJSON(
        SYSTEM,
        `章节：${chapterTitle}
请从下面的资料中提取知识点，输出 JSON：{"points":[{"name":"","summary":"","importance":"必背|理解|了解","evidence":[{"chunk_id":"","quote":""}],"confidence":0.0}]}
规则：
1. 每条必须有至少一个 evidence，chunk_id 必须来自下方资料，quote 必须是原文片段。
2. importance 只能根据资料中的强调方式、篇幅、习题密度判断，不允许凭空推测。
3. name 不超过 24 字，summary 一句话说明。
资料：
${plain}`,
        extractionSchema,
      )

      const allowed = new Set(chunks.map((chunk) => chunk.id))
      return data.points
        .filter((point) => point.evidence.some((item) => allowed.has(item.chunk_id)))
        .filter((point) => point.evidence.every((item) => item.quote.trim().length > 0))
        .map((point) => ({
          ...point,
          evidence: point.evidence.filter((item) => allowed.has(item.chunk_id)),
        }))
    },

    async generateQuestions({ kp, preferences }) {
      const evidence = kp.evidence
        .map((item) => `【chunk_id=${item.chunk_id}】${item.quote}`)
        .join('\n')
      const constraints = [
        preferences.tooEasyTypes.length
          ? `题型 ${preferences.tooEasyTypes.join('、')} 已被标记为过易，不要出现在基础档。`
          : '',
        preferences.hintIneffective ? '提示曾被认为无效，题目表述要更具体。' : '',
      ]
        .filter(Boolean)
        .join('\n')

      const data = await chatJSON(
        SYSTEM,
        `请为一个已采纳的知识点出 3 道题，输出 JSON：{"questions":[{"type":"选择|填空|简答","difficulty":"基础|变式|综合","stem":"","options":[{"key":"A","text":""}]|null,"answer":"","rubric":[""]|null,"source_refs":["chunk_id"]}]}
要求：
1. 选择题 4 个选项，只有一个正确；填空题答案是原文中的关键术语；简答题必须给出 rubric 要点。
2. 基础题只考概念本身；变式题改变条件或表述；综合题联系本章其他内容。
3. 每道题 source_refs 非空，只能使用给定的 chunk_id。
4. 不得出现与题干重复的答案。
${constraints}
知识点：${kp.name}
说明：${kp.summary}
重要度：${kp.importance}
出处：
${evidence}`,
        questionListSchema,
      )

      const allowed = new Set(kp.evidence.map((item) => item.chunk_id))
      return data.questions
        .map((question) => {
          const parsed = generatedQuestionSchema.safeParse(question)
          return parsed.success ? parsed.data : null
        })
        .filter((question): question is NonNullable<typeof question> => Boolean(question))
        .filter((question) => question.options == null || new Set(question.options.map((option) => normalizeText(option.text))).size === question.options.length)
        .filter((question) => question.type === '简答' ? (question.rubric?.length ?? 0) > 0 : true)
        .map((question) => ({
          ...question,
          source_refs: question.source_refs.filter((ref) => allowed.has(ref)),
        }))
        .filter((question) => question.source_refs.length > 0) as GeneratedQuestion[]
    },

    async hint({ level, kp, wrongAnswer, previousHints }) {
      const data = await chatJSON(
        SYSTEM,
        `请为一道尚未答对的题给出第 ${level} 级提示，输出 JSON：{"text":""}。
知识点：${kp.name}
说明：${kp.summary}
原文：${kp.evidence.map((item) => item.quote).join(' / ')}
学生的错误答案：${wrongAnswer || '未提供'}
已给出的提示：${previousHints.join(' | ') || '无'}
约束：L1 只指向相关概念和原文位置，不给解释；L2 给出解题思路或关键步骤，不出现最终答案；L3 给出接近答案的结构化提示，仍不直接写出完整答案。`,
        hintSchema,
      )
      return data.text
    },

    async evaluateNarration({ kp, text, chunks }) {
      const plain = chunks
        .map((chunk) => `【chunk_id=${chunk.id}】${truncate(chunk.content, 300)}`)
        .join('\n')
        .slice(0, 8000)
      const data = await chatJSON(
        SYSTEM,
        `请评判学生对知识点的复述，输出 JSON：{"covered":[],"missing":[],"wrong":[{"claim":"","correction":"","source_refs":[]}],"followups":[]}
规则：
1. 只依据给定资料判断，不补充资料外的知识。
2. wrong 中每条都要带 source_refs，且 chunk_id 来自资料。
3. followups 必须针对 missing 或 wrong 的具体缺口，不要泛泛鼓励，最多两条。
知识点：${kp.name}
说明：${kp.summary}
资料：
${plain}
学生复述：${text}`,
        narrationSchema,
      )

      const allowed = new Set(chunks.map((chunk) => chunk.id))
      const result: NarrationResult = {
        covered: data.covered ?? [],
        missing: data.missing ?? [],
        wrong: (data.wrong ?? [])
          .map((item) => ({
            ...item,
            source_refs: (item.source_refs ?? []).filter((ref) => allowed.has(ref)),
          }))
          .filter((item) => item.source_refs.length > 0),
        followups: data.followups ?? [],
      }
      const gaps = [...result.missing, ...result.wrong.map((item) => item.claim)]
      result.followups = result.followups.filter((followup) =>
        gaps.some((gap) => followup.includes(gap.slice(0, 4))),
      )
      return result
    },
  }
}
