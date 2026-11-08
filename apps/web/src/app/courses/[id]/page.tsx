import Link from 'next/link'
import { notFound } from 'next/navigation'
import AppShell from '@/components/AppShell'
import CourseWorkspace from '@/components/CourseWorkspace'
import { q } from '@/server/db'
import { courseMeta, getCourse, listChapters, listSlots } from '@/server/services/courses'
import { listFiles } from '@/server/services/materials'
import {
  listDrafts,
  listKnowledgePoints,
  listPreferences,
  notExamChapterIds,
} from '@/server/services/knowledge'
import { computeChapterMasteries } from '@/server/services/review'
import { engineLabel } from '@/server/ai'
import { fmtDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ chapter?: string }>
}) {
  const { id } = await params
  const { chapter } = await searchParams
  const course = await getCourse(id)
  if (!course) notFound()

  const [chapters, slots, files, preferences, off, mastery, draftCounts] = await Promise.all([
    listChapters(id),
    listSlots(id),
    listFiles(id),
    listPreferences(id),
    notExamChapterIds(id),
    computeChapterMasteries(id),
    q<{ chapter_id: string; count: string }>(
      `SELECT chapter_id, count(*)::text AS count FROM ai_drafts
       WHERE course_id = $1 AND status = 'draft' GROUP BY chapter_id`,
      [id],
    ),
  ])

  const meta = courseMeta(course, slots)
  const bands = new Map(mastery.chapters.map((item) => [item.chapterId, item.band]))
  const pending = new Map(draftCounts.map((item) => [item.chapter_id, Number(item.count)]))
  const withDrafts = chapters.find((item) => (pending.get(item.id) ?? 0) > 0)
  const withFiles = chapters.find((item) => files.some((file) => file.chapter_id === item.id))
  const selectedId =
    chapter && chapters.some((item) => item.id === chapter)
      ? chapter
      : (withDrafts ?? withFiles ?? chapters[0])?.id ?? null

  const selectedChapter = chapters.find((item) => item.id === selectedId) ?? null
  const [drafts, kps] = selectedId
    ? await Promise.all([listDrafts(selectedId), listKnowledgePoints(selectedId)])
    : [[], []]
  const engine = engineLabel()

  return (
    <AppShell
      active="courses"
      crumb={
        <>
          <Link href="/courses">课程</Link>
          <i>/</i>
          <b>{course.name}</b>
        </>
      }
    >
      <div className="course-head">
        <div>
          <div className="kicker">
            {course.semester ?? '本学期'} · {meta.nextClass}
          </div>
          <h1 className="h1" style={{ fontSize: 30 }}>
            {course.name}
          </h1>
          <div className="course-meta">
            {course.code ? <span>代码 <b>{course.code}</b></span> : null}
            {course.teacher ? <span>教师 <b>{course.teacher}</b></span> : null}
            <span>上课 <b>{meta.slotText}</b></span>
            <span>教室 <b>{course.room ?? '—'}</b></span>
            <span>期末 <b>{fmtDate(course.exam_date)}</b></span>
          </div>
        </div>
        <div className="row">
          <Link className="btn ghost" href={`/courses/${id}/plan`}>
            计划
          </Link>
          <Link className="btn ghost" href={`/courses/${id}/review`}>
            复盘
          </Link>
          <Link className="btn primary" href={`/courses/${id}/practice`}>
            开始练习
          </Link>
        </div>
      </div>

      {engine.kind === 'local' ? (
        <div className="notice">
          <span>引擎</span>
          <span>
            未配置大模型 API Key，当前由本地规则引擎依据原文抽取、出题与评判。结果同样进入草稿，必须由你确认；
            配置 `LLM_BASE_URL` / `LLM_API_KEY` 后自动切换为真实模型。
          </span>
        </div>
      ) : null}

      {chapters.length > 0 ? (
        <div className="chapters">
          {chapters.map((item) => {
            const band = bands.get(item.id)
            return (
              <Link
                key={item.id}
                href={`/courses/${id}?chapter=${item.id}`}
                className={`chap ${item.id === selectedId ? 'active' : ''}`}
                scroll={false}
              >
                {item.title}
                <span className="st">
                  {off.has(item.id) ? '本章不考' : item.status}
                  {band ? ` · ${band}` : ''}
                </span>
              </Link>
            )
          })}
        </div>
      ) : null}

      <CourseWorkspace
        courseId={id}
        courseName={course.name}
        chapters={chapters.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          notExam: off.has(item.id),
          band: bands.get(item.id) ?? null,
        }))}
        selectedChapter={selectedChapter ? { id: selectedChapter.id, title: selectedChapter.title } : null}
        files={files.map((file) => ({
          id: file.id,
          chapter_id: file.chapter_id,
          chapter_title: file.chapter_title,
          filename: file.filename,
          parse_status: file.parse_status,
          parse_note: file.parse_note,
          size: file.size,
          created_at: String(file.created_at),
        }))}
        drafts={drafts.map((draft) => ({
          id: draft.id,
          status: draft.status,
          payload: draft.payload,
          original_payload: draft.original_payload,
          created_at: String(draft.created_at),
          updated_at: String(draft.updated_at),
        }))}
        kps={kps.map((kp) => ({
          id: kp.id,
          name: kp.name,
          importance: kp.importance,
          source_refs: kp.source_refs,
          status: kp.status,
        }))}
        preferences={preferences.map((pref) => ({
          id: pref.id,
          kind: pref.kind,
          note: pref.note,
        }))}
        engineLocal={engine.kind === 'local'}
      />
    </AppShell>
  )
}
