import { Fragment } from 'react'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import TaskTick from '@/components/TaskTick'
import { getDashboard } from '@/server/services/dashboard'
import { semesterInfo } from '@/server/ids'
import { bandClass, fmtDate, fmtTime, taskTypeClass } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const data = await getDashboard()
  const semester = semesterInfo()
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()]
  const rate = data.weekRate == null ? '—' : `${Math.round(data.weekRate * 100)}%`

  const focusBandRows = data.focusMastery.slice(0, 5).map((chapter) => {
    const score = chapter.score
    return {
      id: chapter.chapterId,
      name: chapter.title,
      pct: score == null ? 0 : Math.round(score * 100),
      label: score == null ? '样本不足' : chapter.band,
      cls: score == null ? 'none' : bandClass(chapter.band),
    }
  })

  return (
    <AppShell
      active="today"
      crumb={
        <>
          <b>今日</b>
          <i>/</i>第 {semester.week} 周
        </>
      }
    >
      <div className="hero">
        <div>
          <div className="kicker">
            第 {semester.week} 周 · {weekday}
            {data.daysToExam != null && data.examCourseName
              ? ` · 距《${data.examCourseName}》期末 ${data.daysToExam} 天`
              : ' · 尚未设置考试日期'}
          </div>
          <h1 className="h1">
            {data.hasCourses
              ? data.totalToday > 0
                ? `今天只有 ${data.totalToday} 件事，做完就收工。`
                : '今天没有排任务，先把资料补进来。'
              : '先把课表导进来，今天才有得排。'}
          </h1>
          <p className="lede">
            顺序是按各章掌握度和上课进度排的。没做完不叠加惩罚，明天继续接上。
          </p>
        </div>
        <div className="hero-stat">
          <div>
            <span className="n">
              {data.doneToday}/{data.totalToday}
            </span>
            <span className="t">今日完成</span>
          </div>
          <div>
            <span className="n">{data.pendingDrafts}</span>
            <span className="t">待你确认的草稿</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{data.adoptedKps}</span>
            <span className="t">已采纳知识点</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{rate}</span>
            <span className="t">近 7 天完成率</span>
          </div>
        </div>
      </div>

      <div className="columns">
        <div>
          <h2 className="sec-title">
            今日任务<span className="count">{String(data.totalToday).padStart(2, '0')}</span>
          </h2>

          {!data.hasCourses ? (
            <div className="empty">
              <b>还没有课程。</b>
              <br />
              导入教务课表，或手动新建一门课，系统才会从课表和资料里排任务。
              <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                <Link className="btn primary" href="/timetable">
                  导入课表
                </Link>
                <Link className="btn ghost" href="/courses">
                  手动新建课程
                </Link>
              </div>
            </div>
          ) : data.tasks.length === 0 ? (
            <div className="empty">
              <b>今天没有自动安排的任务。</b>
              <br />
              这通常意味着章节还没确认知识点。去课程页上传资料、提取并确认知识点，任务才会出现。
              <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                <Link className="btn primary" href={`/courses/${data.courses[0]?.id ?? ''}`}>
                  去确认知识点
                </Link>
              </div>
            </div>
          ) : (
            data.tasks.map((task) => {
              const path = [
                task.kind === '课前预习' ? '课表' : '练习',
                task.chapter_title ?? '课程',
                task.title,
              ]
              const href = task.kp_id
                ? `/courses/${task.course_id}/practice?kp=${task.kp_id}`
                : `/courses/${task.course_id}`
              return (
                <article key={task.id} className={`task ${task.done ? 'done' : ''}`}>
                  <TaskTick taskId={task.id} done={task.done} />
                  <div className="task-body">
                    <div className="task-top">
                      <span className={`type ${taskTypeClass(task.kind)}`}>{task.kind}</span>
                      <span className="small">{task.course_name}</span>
                    </div>
                    <div className="task-title">{task.title}</div>
                    <div className="task-note">{task.note}</div>
                    <div className="path">
                      {path.map((item, index) => (
                        <Fragment key={`${task.id}-${index}`}>
                          {index > 0 ? <i>›</i> : null}
                          {item}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                  <Link className="btn ghost" href={href}>
                    {task.done ? '再看看' : '开始'}
                  </Link>
                </article>
              )
            })
          )}

          {data.tasks.length > 0 ? (
            <div className="notice ai" style={{ marginTop: 22 }}>
              <span>AI</span>
              <span>
                今日任务都来自你自己的记录：错题、课表上的下一节课、上次复述的缺口。没有凭空安排的内容。
              </span>
            </div>
          ) : null}
        </div>

        <aside>
          <h2 className="sec-title">
            协同轨迹<span className="count">最近</span>
          </h2>
          {data.trace.length === 0 ? (
            <div className="empty-line">还没有协同记录。采纳、驳回、复述之后会出现在这里。</div>
          ) : (
            <div className="trace">
              {data.trace.map((item) => (
                <div className="trace-row" key={item.id}>
                  <div className={`trace-who ${item.actor === 'ai' ? 'ai' : 'me'}`}>
                    {item.actor === 'ai' ? 'AI' : '你'}
                  </div>
                  <div className="trace-txt">{item.text}</div>
                  <div className="trace-time">{fmtTime(item.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          {data.focusCourse ? (
            <>
              <h2 className="sec-title" style={{ marginTop: 26 }}>
                {data.focusCourse.name}掌握度<span className="count">章节</span>
              </h2>
              {focusBandRows.length === 0 ? (
                <div className="empty-line">这门课还没有确认的知识点。</div>
              ) : (
                <div className="mini-bars">
                  {focusBandRows.map((row) => (
                    <div className="mini-row" key={row.id}>
                      <span className="nm" title={row.name}>
                        {row.name}
                      </span>
                      <span className="bar">
                        <i
                          className={row.cls === 'mid' ? 'mid' : row.cls === 'weak' ? 'low' : ''}
                          style={{ width: `${row.pct}%` }}
                        />
                      </span>
                      <span className="lv">{row.label === '样本不足' ? '样本不足' : `${row.pct}%`}</span>
                    </div>
                  ))}
                </div>
              )}
              <Link
                className="btn ghost"
                style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
                href={`/courses/${data.focusCourse.id}/review`}
              >
                查看完整复盘
              </Link>
            </>
          ) : null}

          {data.courses.length > 0 ? (
            <div className="card pad" style={{ marginTop: 20 }}>
              <div className="panel-title">
                <h3>最近的考试</h3>
                <Link className="link" href="/courses">
                  课程
                </Link>
              </div>
              <div className="stack">
                {data.courses
                  .filter((course) => course.exam_date)
                  .sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)))
                  .slice(0, 3)
                  .map((course) => (
                    <div className="pref-row" key={course.id}>
                      <span>{course.name}</span>
                      <span className="mono">{fmtDate(course.exam_date)}</span>
                    </div>
                  ))}
                {data.courses.filter((course) => course.exam_date).length === 0 ? (
                  <div className="small">还没有设置考试日期，系统只推错题、复述与上课章节。</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </AppShell>
  )
}
