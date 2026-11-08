import Link from 'next/link'
import { notFound } from 'next/navigation'
import AppShell from '@/components/AppShell'
import PlanClient from '@/components/PlanClient'
import TaskTick from '@/components/TaskTick'
import { getPlanData } from '@/server/services/plan'
import { RULES } from '@/server/rules/config'
import { bandClass, fmtDate, fmtTime, taskTypeClass } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getPlanData(id)
  if (!data) notFound()

  const rate = data.tasks.length === 0 ? 0 : Math.round((data.completedToday / data.tasks.length) * 100)
  const examDays = data.course.exam_date
    ? Math.max(
        0,
        Math.round(
          (new Date(`${data.course.exam_date}T00:00:00`).getTime() -
            new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`).getTime()) /
            86400000,
        ),
      )
    : null

  return (
    <AppShell
      active="review"
      crumb={
        <>
          <Link href="/courses">课程</Link>
          <i>/</i>
          <Link href={`/courses/${id}`}>{data.course.name}</Link>
          <i>/</i>
          <b>计划</b>
        </>
      }
    >
      <div className="hero">
        <div>
          <div className="kicker">
            计划 · {data.course.name}
            {examDays != null ? ` · 距期末 ${examDays} 天` : ' · 未设置考试日期'}
          </div>
          <h1 className="h1">
            {data.tasks.length === 0
              ? '今天没有可排的任务。'
              : `今天 ${data.tasks.length} 项，做完不追加。`}
          </h1>
          <p className="lede" style={{ marginTop: 14 }}>
            计划由确定性规则生成：档位、错题、依赖提示、久未练习共同决定优先级，单日容量 {RULES.dailyCapacity} 个知识点。
            未采纳的知识点不参与排期。
          </p>
        </div>
        <div className="hero-stat">
          <div>
            <span className="n">
              {data.completedToday}/{data.tasks.length}
            </span>
            <span className="t">今日完成</span>
          </div>
          <div>
            <span className="n">{rate}%</span>
            <span className="t">今日完成率</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{data.backlog}</span>
            <span className="t">历史未完成任务</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{data.mastery.chapters.length}</span>
            <span className="t">计入排期的章节</span>
          </div>
        </div>
      </div>

      <div className="columns">
        <div>
          <h2 className="sec-title">
            今日任务<span className="count">{String(data.tasks.length).padStart(2, '0')}</span>
          </h2>
          {data.tasks.length === 0 ? (
            <div className="empty">
              <b>今天没有排任务。</b>
              <br />
              {data.hasData
                ? '当前所有知识点都还不需要立即复习，或今天的任务已经清空。'
                : '先在课程页确认已采纳知识点，排期才会启动。'}
              <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                <Link className="btn primary" href={`/courses/${id}`}>
                  去课程页
                </Link>
              </div>
            </div>
          ) : (
            data.tasks.map((task) => {
              const href = task.kp_id
                ? `/courses/${id}/practice?kp=${task.kp_id}`
                : `/courses/${id}/review`
              return (
                <article key={task.id} className={`task ${task.done ? 'done' : ''}`}>
                  <TaskTick taskId={task.id} done={task.done} />
                  <div className="task-body">
                    <div className="task-top">
                      <span className={`type ${taskTypeClass(task.kind)}`}>{task.kind}</span>
                    </div>
                    <div className="task-title">{task.title}</div>
                    <div className="task-note">{task.note}</div>
                    <div className="path">
                      {task.kind} <i>›</i> {task.title}
                    </div>
                  </div>
                  <Link className="btn ghost" href={href}>
                    {task.done ? '再看看' : '开始'}
                  </Link>
                </article>
              )
            })
          )}

          <div className="notice ai">
            <span>规则</span>
            <span>
              任务不会因为前一天没做完而叠加。历史未完成只作为「久未练习」权重的一部分，不形成惩罚队列。
            </span>
          </div>

          <h2 className="sec-title" style={{ marginTop: 30 }}>
            掌握度趋势<span className="count">近 14 天</span>
          </h2>
          {data.trends.length === 0 ? (
            <div className="empty">还没有可统计的章节。</div>
          ) : (
            <div className="card pad">
              {data.trends.map((series) => (
                <div className="trend-row" key={series.chapterId}>
                  <div className="trend-head">
                    <span>{series.title}</span>
                    <span className="mono">
                      {series.points.length > 0
                        ? `${Math.round(series.points[series.points.length - 1].score * 100)}%`
                        : '样本不足'}
                    </span>
                  </div>
                  {series.points.length > 0 ? (
                    <div className="trend-bars">
                      {series.points.map((point) => (
                        <i
                          key={`${series.chapterId}-${point.date}`}
                          className={
                            point.score >= 0.75 ? '' : point.score >= 0.45 ? 'mid' : 'low'
                          }
                          style={{ height: `${Math.max(2, Math.round(point.score * 34))}px` }}
                          title={`${point.date} · ${Math.round(point.score * 100)}%`}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="trend-empty">需要累计 2 天以上掌握度快照才形成趋势。</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <aside>
          <PlanClient
            courseId={id}
            examDate={data.course.exam_date}
            preferences={data.preferences.map((pref) => ({
              id: pref.id,
              kind: pref.kind,
              note: pref.note,
            }))}
          />

          <div className="card pad" style={{ marginTop: 16 }}>
            <div className="panel-title">
              <h3>课程概览</h3>
              <Link className="link" href={`/courses/${id}/review`}>
                复盘
              </Link>
            </div>
            <div className="stack" style={{ gap: 9 }}>
              {data.mastery.chapters.map((chapter) => (
                <div className="pref-row" key={chapter.chapterId}>
                  <span className="small">{chapter.title}</span>
                  <span className={`lv ${bandClass(chapter.band)}`} style={{ fontSize: 11 }}>
                    {chapter.score == null ? '样本不足' : `${Math.round(chapter.score * 100)}% ${chapter.band}`}
                  </span>
                </div>
              ))}
              {data.mastery.chapters.length === 0 ? (
                <div className="empty-line">还没有计入掌握度的章节。</div>
              ) : null}
            </div>
            <div className="small" style={{ marginTop: 12 }}>
              期末：{fmtDate(data.course.exam_date)} · 更新于 {fmtTime(new Date())}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  )
}
