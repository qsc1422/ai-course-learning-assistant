import Link from 'next/link'
import AppShell from '@/components/AppShell'
import { q, OWNER_ID } from '@/server/db'
import { courseMeta, listSlots } from '@/server/services/courses'
import type { Course } from '@/server/domain'
import { fmtDate } from '@/lib/format'
import { semesterInfo } from '@/server/ids'

export const dynamic = 'force-dynamic'

interface CourseCount extends Course {
  chapter_count: string
  kp_count: string
  draft_count: string
}

export default async function CoursesPage() {
  const rows = await q<CourseCount>(
    `SELECT c.*,
       (SELECT count(*)::text FROM chapters ch WHERE ch.course_id = c.id) AS chapter_count,
       (SELECT count(*)::text FROM knowledge_points kp WHERE kp.course_id = c.id) AS kp_count,
       (SELECT count(*)::text FROM ai_drafts d WHERE d.course_id = c.id AND d.status = 'draft') AS draft_count
     FROM courses c WHERE c.owner_id = $1 ORDER BY c.created_at`,
    [OWNER_ID],
  )
  const slotsByCourse = await Promise.all(rows.map((course) => listSlots(course.id)))
  const semester = semesterInfo()

  return (
    <AppShell
      active="courses"
      crumb={
        <>
          <b>课程</b>
          <i>/</i>第 {semester.week} 周
        </>
      }
    >
      <div className="course-head">
        <div>
          <div className="kicker">我的学期 · {semester.label}</div>
          <h1 className="h1" style={{ fontSize: 30 }}>
            课程是资料的归处，也是复盘的粒度。
          </h1>
          <p className="lede" style={{ marginTop: 10 }}>
            每门课都走同一条管线：资料 → 知识点草稿 → 确认 → 练习 → 复盘。未确认的内容不进入任何统计。
          </p>
        </div>
        <Link className="btn primary" href="/timetable">
          导入课表 / 新建课程
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <b>还没有课程。</b>
          <br />
          先导入教务课表，或手动新建一门课。
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link className="btn primary" href="/timetable">
              去建档
            </Link>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {rows.map((course, index) => {
            const meta = courseMeta(course, slotsByCourse[index])
            return (
              <div className="card pad" key={course.id}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div className="row" style={{ gap: 10 }}>
                      <h2 className="h2">{course.name}</h2>
                      {Number(course.draft_count) > 0 ? (
                        <span className="pill wait">{course.draft_count} 条草稿待确认</span>
                      ) : null}
                    </div>
                    <div className="course-meta">
                      {course.code ? <span>代码 <b>{course.code}</b></span> : null}
                      {course.teacher ? <span>教师 <b>{course.teacher}</b></span> : null}
                      <span>上课 <b>{meta.slotText}</b></span>
                      <span>下一次 <b>{meta.nextClass}</b></span>
                      <span>期末 <b>{fmtDate(course.exam_date)}</b></span>
                    </div>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <Link className="btn primary" href={`/courses/${course.id}`}>
                      进入课程
                    </Link>
                    <Link className="btn ghost" href={`/courses/${course.id}/practice`}>
                      练习
                    </Link>
                    <Link className="btn ghost" href={`/courses/${course.id}/review`}>
                      复盘
                    </Link>
                    <Link className="btn ghost" href={`/courses/${course.id}/plan`}>
                      计划
                    </Link>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 14, gap: 18 }}>
                  <span className="small">章节 {course.chapter_count}</span>
                  <span className="small">已采纳知识点 {course.kp_count}</span>
                  <span className="small">待确认草稿 {course.draft_count}</span>
                  {'exam_date' in course && !course.exam_date ? (
                    <span className="small">未设置考试日期：只推错题、复述与上课章节</span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
