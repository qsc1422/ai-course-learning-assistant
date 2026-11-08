import Link from 'next/link'
import { notFound } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { getReviewData } from '@/server/services/review'
import { bandClass, fmtDateTime, fmtTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getReviewData(id)
  if (!data) notFound()

  const weakest = data.chapters
    .filter((chapter) => chapter.band === '薄弱')
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
  const suggestion =
    data.openMistakes.length > 0
      ? `先把 ${data.openMistakes[0].kp_name} 的错题重做通过，它来自「${data.openMistakes[0].chapter_title}」。`
      : weakest.length > 0
        ? `「${weakest[0].title}」是当前最薄弱的一章，明天优先补它的复述与练习。`
        : data.strongCount > 0
          ? '当前已确认章节都在稳固区，保持每节课后的一次练习即可。'
          : '还没有足够样本判断强弱。先完成一轮练习与复述。'

  return (
    <AppShell
      active="review"
      crumb={
        <>
          <Link href="/courses">课程</Link>
          <i>/</i>
          <Link href={`/courses/${id}`}>{data.course.name}</Link>
          <i>/</i>
          <b>复盘</b>
        </>
      }
    >
      <div className="hero">
        <div>
          <div className="kicker">复盘 · {data.course.name}</div>
          <h1 className="h1">
            {data.weakCount > 0
              ? `这 ${data.weakCount} 章还没过关，其余先放一放。`
              : data.strongCount > 0
                ? `${data.strongCount} 章已到稳固，接下来守住错题。`
                : '样本还不够，先把练习做起来。'}
          </h1>
          <p className="lede" style={{ marginTop: 14 }}>
            掌握度不是分数，是「独立答对 / 提示后答对 / 复述是否讲清」的加权结果。样本不足的章节不给档位，避免用一两道题下结论。
          </p>
        </div>
        <div className="hero-stat">
          <div>
            <span className="n">{data.strongCount}</span>
            <span className="t">稳固章节</span>
          </div>
          <div>
            <span className="n" style={{ color: 'var(--clay)' }}>
              {data.weakCount}
            </span>
            <span className="t">薄弱章节</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{data.insufficientCount}</span>
            <span className="t">样本不足</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <span className="n">{data.openMistakes.length}</span>
            <span className="t">未通过错题</span>
          </div>
        </div>
      </div>

      <div className="columns">
        <div>
          <h2 className="sec-title">
            章节掌握度<span className="count">{data.chapters.length} 章</span>
          </h2>
          {data.chapters.length === 0 ? (
            <div className="empty">还没有可统计的章节。先确认知识点并完成练习。</div>
          ) : (
            <div className="card pad">
              {data.chapters.map((chapter) => {
                const pct = chapter.score == null ? 0 : Math.round(chapter.score * 100)
                return (
                  <div className="mastery-row" key={chapter.chapterId}>
                    <Link className="nm" href={`/courses/${id}?chapter=${chapter.chapterId}`}>
                      {chapter.title}
                    </Link>
                    <span className="track">
                      <i
                        className={
                          chapter.score == null
                            ? ''
                            : bandClass(chapter.band) === 'good'
                              ? ''
                              : bandClass(chapter.band) === 'mid'
                                ? 'mid'
                                : 'low'
                        }
                        style={{
                          width: `${pct}%`,
                          background:
                            chapter.score == null
                              ? 'var(--line-2)'
                              : undefined,
                        }}
                      />
                    </span>
                    <span className={`lv ${bandClass(chapter.band)}`}>
                      {chapter.score == null ? '样本不足' : `${pct}% ${chapter.band}`}
                    </span>
                  </div>
                )
              })}
              <div className="small" style={{ marginTop: 12, lineHeight: 1.8 }}>
                档位阈值：≥75% 稳固，45%–75% 一般，&lt;45% 薄弱。章节作答少于 5 次或已采纳知识点少于 3 个时不给档位。
              </div>
            </div>
          )}

          {data.excluded.length > 0 ? (
            <div className="chap-off" style={{ marginTop: 16 }}>
              已标记「本章不考」：{data.excluded.map((chapter) => chapter.title).join('、')}。它们不计入掌握度，也不参与排期。
            </div>
          ) : null}

          <h2 className="sec-title" style={{ marginTop: 30 }}>
            错题本<span className="count">按知识点归因</span>
          </h2>
          {data.openMistakes.length === 0 ? (
            <div className="empty">没有未通过的错题。答错后会自动进入这里，答对同一知识点后转为已通过。</div>
          ) : (
            data.openMistakes.map((mistake) => (
              <div className="wrong-card" key={mistake.id}>
                <span className="n">{mistake.wrong_count}</span>
                <div className="body">
                  <div className="t">{mistake.kp_name}</div>
                  <div className="d">
                    {mistake.chapter_title} · 最近错误 {fmtDateTime(mistake.last_attempt_at)}
                  </div>
                </div>
                <Link className="btn clay" href={`/courses/${id}/practice?kp=${mistake.kp_id}`}>
                  重做
                </Link>
              </div>
            ))
          )}

          {data.clearedMistakes.length > 0 ? (
            <>
              <h2 className="sec-title" style={{ marginTop: 26, fontSize: 14 }}>
                已在重做中通过<span className="count">{data.clearedMistakes.length}</span>
              </h2>
              {data.clearedMistakes.map((mistake) => (
                <div className="wrong-card cleared" key={mistake.id}>
                  <span className="n">✓</span>
                  <div className="body">
                    <div className="t">{mistake.kp_name}</div>
                    <div className="d">{mistake.chapter_title}</div>
                  </div>
                </div>
              ))}
            </>
          ) : null}

          <div className="notice ai" style={{ marginTop: 22 }}>
            <span>AI</span>
            <span>
              建议：{suggestion} 这来自你的作答记录与复述缺口，不是通用复习清单。
            </span>
          </div>

          <div className="row" style={{ marginTop: 22 }}>
            <Link className="btn primary" href={`/courses/${id}/plan`}>
              看明日计划
            </Link>
            <Link className="btn ghost" href={`/courses/${id}/practice`}>
              继续练习
            </Link>
          </div>
        </div>

        <aside>
          <h2 className="sec-title">
            协同轨迹<span className="count">{data.trace.length}</span>
          </h2>
          {data.trace.length === 0 ? (
            <div className="empty-line">还没有协同记录。</div>
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

          <div className="card pad" style={{ marginTop: 20 }}>
            <div className="panel-title">
              <h3>不足样本的章节</h3>
              <span className="mono">{data.insufficientCount}</span>
            </div>
            <div className="small" style={{ lineHeight: 1.8 }}>
              {data.chapters.filter((chapter) => chapter.band === '样本不足').length === 0
                ? '没有样本不足的章节。'
                : data.chapters
                    .filter((chapter) => chapter.band === '样本不足')
                    .map((chapter) => chapter.title)
                    .join('、')}
              <br />
              这些章节不是「没问题」，而是还看不到。完成练习与复述后会自动出档。
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  )
}
