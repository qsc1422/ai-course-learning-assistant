'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, errorText, toast, waitForJob } from '@/lib/client'
import { importanceClass } from '@/lib/format'
import SourceButton from '@/components/SourceButton'

interface QuestionOption {
  key: string
  text: string
}

interface QuestionView {
  id: string
  type: string
  difficulty: string
  stem: string
  options: QuestionOption[] | null
  sourceRefs: string[]
  hintLevels: number
  hints: { level: number; text: string }[]
  solutionViewed: boolean
  lastResult: string | null
}

interface AttemptResult {
  result: 'correct' | 'partial' | 'wrong'
  independence: string
  correctAnswer: string | null
  explanation: string | null
}

interface Solution {
  answer: string
  summary: string
  quote: string
  page: number
  chunkId: string | null
}

interface NarrationResult {
  needsMore: boolean
  narrationId: string | null
  status: string | null
  covered: string[]
  missing: string[]
  wrong: { claim: string; correction: string; source_refs: string[] }[]
  followups: string[]
}

export default function PracticeClient({
  course,
  chapter,
  kp,
  questions,
  done,
  empty,
  answeredCount,
  total,
}: {
  course: { id: string; name: string }
  chapter: { id: string; title: string }
  kp: { id: string; name: string; summary: string; importance: string; sourceRefs: string[] }
  questions: QuestionView[]
  done: boolean
  empty: boolean
  answeredCount: number
  total: number
}) {
  const router = useRouter()
  const ids = questions.map((question) => question.id).join('|')

  const [index, setIndex] = useState(() => firstIndex(questions))
  const [answeredIds, setAnsweredIds] = useState<string[]>(() => answeredOf(questions))
  const [selectedKey, setSelectedKey] = useState('')
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [hints, setHints] = useState<{ level: number; text: string }[]>([])
  const [hintBusy, setHintBusy] = useState(false)
  const [solution, setSolution] = useState<Solution | null>(null)
  const [solutionBusy, setSolutionBusy] = useState(false)
  const [narrText, setNarrText] = useState('')
  const [narrBusy, setNarrBusy] = useState(false)
  const [narrResult, setNarrResult] = useState<NarrationResult | null>(null)
  const [narrDisagreed, setNarrDisagreed] = useState(false)
  const [finished, setFinished] = useState(done)
  const [generating, setGenerating] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [feedbackTaken, setFeedbackTaken] = useState('')

  const question = questions[index] ?? null
  const currentAnswered =
    question != null &&
    (answeredIds.includes(question.id) || question.solutionViewed)

  useEffect(() => {
    const nextAnswered = answeredOf(questions)
    setAnsweredIds(nextAnswered)
    const nextIndex = firstIndex(questions)
    setIndex(nextIndex)
    setFinished(questions.length > 0 && nextAnswered.length >= questions.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  useEffect(() => {
    const target = questions[index]
    setHints(target?.hints ?? [])
    setSelectedKey('')
    setAnswer('')
    setResult(null)
    setSolution(null)
    setNarrText('')
    setNarrResult(null)
    setNarrDisagreed(false)
    setFeedbackTaken('')
    setStartedAt(Date.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ids])

  async function generate() {
    setGenerating(true)
    try {
      const { jobId } = await api<{ jobId: string }>('/api/practice/questions', { kpId: kp.id })
      await waitForJob(jobId)
      toast('题目已生成')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setGenerating(false)
    }
  }

  async function submit() {
    if (!question || submitting) return
    const payload = question.type === '选择' ? selectedKey : answer
    if (!payload.trim()) {
      toast(question.type === '选择' ? '先选择一个选项' : '先写下你的答案')
      return
    }
    setSubmitting(true)
    try {
      const data = await api<AttemptResult>(`/api/questions/${question.id}`, {
        action: 'attempt',
        answer: payload,
        durationMs: Date.now() - startedAt,
      })
      setResult(data)
      if (data.result === 'correct') {
        setAnsweredIds((current) =>
          current.includes(question.id) ? current : [...current, question.id],
        )
      } else {
        toast('这次还不对。可以按顺序要提示，别急着看答案。')
      }
    } catch (error) {
      toast(errorText(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function getHint() {
    if (!question || hintBusy) return
    const level = Math.min(2, (hints[hints.length - 1]?.level ?? 0) + 1) as 1 | 2
    if (hints.some((hint) => hint.level === level)) return
    setHintBusy(true)
    try {
      const data = await api<{ level: number; text: string; degraded: boolean }>(
        `/api/questions/${question.id}`,
        {
          action: 'hint',
          level,
          wrongAnswer: question.type === '选择' ? selectedKey : answer,
        },
      )
      setHints((current) => [...current, { level: data.level, text: data.text }])
      if (data.degraded) toast('提示生成失败，已降级为原文片段')
    } catch (error) {
      toast(errorText(error))
    } finally {
      setHintBusy(false)
    }
  }

  async function showSolution() {
    if (!question || solutionBusy) return
    setSolutionBusy(true)
    try {
      const data = await api<Solution>(`/api/questions/${question.id}`, { action: 'solution' })
      setSolution(data)
      setAnsweredIds((current) =>
        current.includes(question.id) ? current : [...current, question.id],
      )
    } catch (error) {
      toast(errorText(error))
    } finally {
      setSolutionBusy(false)
    }
  }

  async function sendNarration() {
    if (narrBusy) return
    setNarrBusy(true)
    try {
      const data = await api<NarrationResult>(`/api/kps/${kp.id}/narration`, { text: narrText })
      if (data.needsMore) {
        toast('再多说两句：至少给出一句完整的表述')
        return
      }
      setNarrResult(data)
      toast(data.status === '已讲清' ? '复述已讲清' : '复述有缺口，已进入下次复习')
    } catch (error) {
      toast(errorText(error))
    } finally {
      setNarrBusy(false)
    }
  }

  async function disagree() {
    if (!narrResult?.narrationId || narrDisagreed) return
    try {
      await api(`/api/narrations/${narrResult.narrationId}`, { action: 'disagree' })
      setNarrDisagreed(true)
      toast('已排除这条判断，不计入掌握度')
    } catch (error) {
      toast(errorText(error))
    }
  }

  async function feedback(kind: 'too-easy' | 'reject') {
    if (!question) return
    if (kind === 'reject' && !window.confirm('驳回这道题？驳回后不再出现，并写入课程偏好。')) return
    try {
      await api(`/api/questions/${question.id}`, { action: 'feedback', kind })
      setFeedbackTaken(kind)
      toast(kind === 'too-easy' ? '已记为题型过易，后续会提高难度' : '已驳回，这道题不再出现')
      if (kind === 'reject') {
        setAnsweredIds((current) =>
          current.includes(question.id) ? current : [...current, question.id],
        )
      }
    } catch (error) {
      toast(errorText(error))
    }
  }

  function next() {
    if (!question) return
    const answered = new Set(answeredIds)
    let target = -1
    for (let cursor = index + 1; cursor < questions.length; cursor += 1) {
      if (!answered.has(questions[cursor].id)) {
        target = cursor
        break
      }
    }
    if (target === -1) {
      setFinished(true)
      return
    }
    setIndex(target)
  }

  if (empty) {
    return (
      <>
        <div className="kicker">练习 · {course.name}</div>
        <h1 className="h1" style={{ fontSize: 30 }}>
          这个知识点还没有题目。
        </h1>
        <p className="lede" style={{ marginTop: 12 }}>
          题目从已采纳的知识点与原文出处生成。生成失败不会扣减任务，也不会留下占位题目。
        </p>
        <div className="card pad" style={{ marginTop: 24 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 9 }}>
                <h2 className="h2">{kp.name}</h2>
                <span className={`imp ${importanceClass(kp.importance)}`}>{kp.importance}</span>
              </div>
              <p className="small" style={{ marginTop: 6 }}>
                {kp.summary}
              </p>
              {kp.sourceRefs.length > 0 ? (
                <div className="src">
                  <span>出处</span>
                  {kp.sourceRefs.slice(0, 3).map((ref, sourceIndex) => (
                    <SourceButton key={ref} chunkId={ref} label={`原文 ${sourceIndex + 1}`} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary" onClick={generate} disabled={generating}>
              {generating ? '生成中…' : '生成本轮题目'}
            </button>
            <Link className="btn ghost" href={`/courses/${course.id}`}>
              返回课程
            </Link>
          </div>
        </div>
      </>
    )
  }

  if (finished) {
    return (
      <>
        <div className="steps">
          <Step n="01" label="作答" state="done" />
          <div className="step-line" />
          <Step n="02" label="提示" state="done" />
          <div className="step-line" />
          <Step n="03" label="复述" state="done" />
          <div className="step-line" />
          <Step n="04" label="复盘" state="on" />
        </div>
        <div className="kicker">本轮完成</div>
        <h1 className="h1" style={{ fontSize: 30 }}>
          这一轮练完了，{kp.name}的记录已经更新。
        </h1>
        <p className="lede" style={{ marginTop: 12 }}>
          作答、提示使用与复述都已写入掌握度。是否进入下一轮，由明天的任务决定，不需要现在刷完。
        </p>
        <div className="hero-stat" style={{ marginTop: 26, borderTop: '2px solid var(--ink)' }}>
          <div>
            <span className="n">
              {answeredIds.length}/{total || questions.length}
            </span>
            <span className="t">本轮完成</span>
          </div>
          <div>
            <span className="n">{hints.length}</span>
            <span className="t">使用提示</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{kp.importance}</span>
            <span className="t">重要度</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{narrResult?.status ?? '—'}</span>
            <span className="t">复述状态</span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 24 }}>
          <Link className="btn primary" href={`/courses/${course.id}/review`}>
            去看复盘
          </Link>
          <Link className="btn ghost" href={`/courses/${course.id}/plan`}>
            查看明日计划
          </Link>
          <Link className="btn ghost" href={`/courses/${course.id}`}>
            返回课程
          </Link>
        </div>
      </>
    )
  }

  if (!question) {
    return (
      <div className="empty">
        当前没有可作答的题目。
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <Link className="btn primary" href={`/courses/${course.id}`}>
            返回课程
          </Link>
        </div>
      </div>
    )
  }

  const canSolution = hints.length >= 2 && !solution
  const solved = result?.result === 'correct' || Boolean(solution)
  const wrong = result != null && result.result !== 'correct'
  const phaseNarration = solved || currentAnswered

  return (
    <>
      <div className="steps">
        <Step n="01" label="作答" state={result || solution ? 'done' : 'current'} />
        <div className="step-line" />
        <Step n="02" label="提示" state={solution ? 'done' : hints.length > 0 ? 'current' : ''} />
        <div className="step-line" />
        <Step n="03" label="复述" state={narrResult ? 'done' : phaseNarration ? 'current' : ''} />
        <div className="step-line" />
        <Step n="04" label="复盘" state="" />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="kicker">
          练习 · {course.name} · {chapter.title} · {kp.name}
        </div>
        <div className="mono" style={{ color: 'var(--muted)' }}>
          第 {index + 1} / {questions.length} 题 · 已完成 {answeredIds.length}
        </div>
      </div>

      <div className="q-card">
        <div className="q-top">
          <div className="q-tags">
            <span className={`imp ${importanceClass(kp.importance)}`}>{kp.importance}</span>
            <span className="type">{question.type}</span>
            <span className="type">{question.difficulty}</span>
          </div>
          <div className="src" style={{ marginTop: 0 }}>
            {question.sourceRefs.slice(0, 2).map((ref, sourceIndex) => (
              <SourceButton key={ref} chunkId={ref} label={`出处 ${sourceIndex + 1}`} />
            ))}
          </div>
        </div>

        <div className="q-stem">{question.stem}</div>

        {question.options && question.options.length > 0 ? (
          <div className="opts">
            {question.options.map((option) => {
              const isSelected = selectedKey === option.key
              let className = 'opt'
              if (isSelected) className += ' sel'
              if (result?.result === 'correct' && isSelected) className += ' right'
              if (wrong && isSelected) className += ' wrong'
              return (
                <button
                  key={option.key}
                  className={className}
                  onClick={() => {
                    if (solved) return
                    setSelectedKey(option.key)
                  }}
                  disabled={solved}
                >
                  <span className="key">{option.key}</span>
                  {option.text}
                </button>
              )
            })}
          </div>
        ) : (
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={question.type === '填空' ? '填写答案…' : '用自己的话回答，尽量写全要点…'}
            disabled={solved}
            style={{ minHeight: 110 }}
          />
        )}

        {!solved ? (
          <div className="q-actions">
            <button className="btn primary" onClick={submit} disabled={submitting}>
              {submitting ? '判定中…' : result ? '重新提交答案' : '提交答案'}
            </button>
            {question.type === '选择' ? (
              <span className="small">选定后提交；答错不会直接显示正确选项。</span>
            ) : (
              <span className="small">简答题按要点匹配，会给出部分正确。</span>
            )}
          </div>
        ) : null}

        {result ? (
          <div className={`result ${result.result === 'correct' ? '' : 'bad'}`}>
            {result.result === 'correct'
              ? `答对了 · ${result.independence}${result.explanation ? ` · ${result.explanation}` : ''}`
              : result.result === 'partial'
                ? '部分正确：要点覆盖还不够，看看提示再补一次。'
                : '这次还不对。按顺序要提示，不要直接跳到答案。'}
          </div>
        ) : null}

        {wrong && result ? (
          <div className="q-actions" style={{ marginTop: 12 }}>
            {feedbackTaken ? (
              <span className="small">已记录你的判断：{feedbackTaken === 'too-easy' ? '题型过易' : '题目有误'}</span>
            ) : (
              <>
                <button className="link mute" onClick={() => feedback('too-easy')}>
                  这题过易
                </button>
                <button className="link mute" onClick={() => feedback('reject')}>
                  题目有误
                </button>
              </>
            )}
          </div>
        ) : null}

        {hints.length > 0 ? (
          <div className="hint-box">
            <div className="hint-head">
              <h4>提示阶梯</h4>
              <div className="hint-levels">
                {[1, 2].map((level) => (
                  <span key={level} className={`hint-dot ${hints.some((hint) => hint.level === level) ? 'on' : ''}`} />
                ))}
              </div>
            </div>
            {hints.map((hint) => (
              <div className="hint-text" key={hint.level}>
                <span className="lv">L{hint.level}</span>
                {hint.text}
              </div>
            ))}
          </div>
        ) : null}

        {(wrong || hints.length > 0) && !solved ? (
          <div className="q-actions">
            {hints.length < 2 ? (
              <button className="btn clay" onClick={getHint} disabled={hintBusy}>
                {hintBusy ? '生成中…' : `看第 ${hints.length + 1} 级提示`}
              </button>
            ) : null}
            {canSolution ? (
              <button className="btn ghost" onClick={showSolution} disabled={solutionBusy}>
                {solutionBusy ? '读取中…' : '看完整解答（标记依赖提示）'}
              </button>
            ) : null}
            <span className="small">
              {hints.length === 0
                ? '一级提示只指出相关概念与原文位置，不给答案。'
                : hints.length === 1
                  ? '二级提示给思路和关键步骤；两级都看完仍未答对，才能看完整解答。'
                  : '两级提示已用完，仍未答对才可查看完整解答。'}
            </span>
          </div>
        ) : null}

        {solution ? (
          <div className="solution">
            <span className="tag-mini">依赖提示通过</span>
            {solution.summary}
            <div style={{ marginTop: 10 }}>
              <b style={{ fontWeight: 600 }}>参考答案：</b>
              {solution.answer}
            </div>
            <div style={{ marginTop: 8, fontSize: 12.5, color: '#7a5c1c' }}>
              原文（第 {solution.page} 页）：{solution.quote}
              {solution.chunkId ? ' · ' : null}
              {solution.chunkId ? <SourceButton chunkId={solution.chunkId} label="核对原文" /> : null}
            </div>
          </div>
        ) : null}

        {phaseNarration ? (
          <div className="recite">
            <h3>现在，用自己的话讲一遍「{kp.name}」</h3>
            <p>
              AI 会指出遗漏与表述错误，并针对缺口追问。少于一句完整表述不作评判；也可以跳过，跳过不计入掌握度。
            </p>
            {!narrResult ? (
              <>
                <textarea
                  value={narrText}
                  onChange={(event) => setNarrText(event.target.value)}
                  placeholder="不看上面的题，用自己的话讲清这个概念，以及它为什么成立…"
                />
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn primary" onClick={sendNarration} disabled={narrBusy}>
                    {narrBusy ? '评判中…' : '提交复述'}
                  </button>
                  <button className="btn ghost" onClick={next}>
                    跳过复述
                  </button>
                  <span className="small">复述有缺口会进入次日复习项。</span>
                </div>
              </>
            ) : null}

            {narrResult ? (
              <>
                <textarea value={narrText} readOnly />
                <div className="bubble">
                  <span className="who">AI · 复述评判</span>
                  <div>
                    状态：{narrResult.status}
                    {narrDisagreed ? '（你已不认同此判断，本条不计入掌握度）' : ''}
                  </div>
                  {narrResult.covered.length > 0 ? (
                    <div className="narr-block">
                      <b>已讲清</b>
                      {narrResult.covered.join('；')}
                    </div>
                  ) : null}
                  {narrResult.missing.length > 0 ? (
                    <div className="narr-block">
                      <b>遗漏</b>
                      {narrResult.missing.join('；')}
                    </div>
                  ) : null}
                  {narrResult.wrong.length > 0 ? (
                    <div className="narr-block">
                      <b>需要纠正</b>
                      {narrResult.wrong.map((item, wrongIndex) => (
                        <div key={wrongIndex} style={{ marginTop: 5 }}>
                          你说：{item.claim}
                          <br />
                          更准确：{item.correction}
                          {item.source_refs.length > 0 ? (
                            <span>
                              {' '}
                              <SourceButton chunkId={item.source_refs[0]} label="核对原文" />
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {narrResult.followups.length > 0 ? (
                    <div className="narr-block">
                      <b>追问</b>
                      {narrResult.followups.map((item, followIndex) => (
                        <div key={followIndex}>· {item}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  {!narrDisagreed ? (
                    <button className="link mute" onClick={disagree}>
                      不认同这个判断
                    </button>
                  ) : (
                    <span className="small">已记录：这条判断作为参考，不降低掌握度。</span>
                  )}
                  <span className="spacer" />
                  <button className="btn primary" onClick={next}>
                    {answeredIds.length >= questions.length ? '完成本轮' : '下一题'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {!phaseNarration ? (
          <div className="q-actions" style={{ marginTop: 22, borderTop: '1px solid var(--line-2)', paddingTop: 18 }}>
            <span className="small">答对后可进入复述；答错可继续作答或按顺序取提示。</span>
            <span className="spacer" />
            <Link className="link mute" href={`/courses/${course.id}`}>
              返回课程
            </Link>
          </div>
        ) : null}
      </div>

      {(solution || solved) && !narrResult ? (
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="link mute" onClick={next}>
            跳过复述并继续
          </button>
        </div>
      ) : null}
    </>
  )
}

function answeredOf(questions: QuestionView[]): string[] {
  return questions
    .filter((question) => question.solutionViewed || question.lastResult === 'correct')
    .map((question) => question.id)
}

function firstIndex(questions: QuestionView[]): number {
  const answered = answeredOf(questions)
  const index = questions.findIndex((question) => !answered.includes(question.id))
  return index === -1 ? 0 : index
}

function Step({ n, label, state }: { n: string; label: string; state: '' | 'current' | 'on' | 'done' }) {
  const className = `step ${state === 'on' || state === 'done' ? 'on' : ''} ${state === 'current' ? 'current' : ''}`
  return (
    <div className={className}>
      <span className="num">{n}</span>
      {label}
    </div>
  )
}
