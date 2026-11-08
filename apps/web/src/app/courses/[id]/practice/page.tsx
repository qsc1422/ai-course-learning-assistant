import Link from 'next/link'
import AppShell from '@/components/AppShell'
import PracticeClient from '@/components/PracticeClient'
import { getPracticeView } from '@/server/services/practice'

export const dynamic = 'force-dynamic'

export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ kp?: string; chapter?: string }>
}) {
  const { id } = await params
  const { kp, chapter } = await searchParams
  const view = await getPracticeView(id, kp, chapter)

  return (
    <AppShell
      active="practice"
      crumb={
        <>
          <Link href="/courses">课程</Link>
          <i>/</i>
          <Link href={`/courses/${id}`}>{view?.course.name ?? '课程'}</Link>
          <i>/</i>
          <b>练习</b>
        </>
      }
    >
      {!view ? (
        <div className="empty">
          <b>没有可练习的知识点。</b>
          <br />
          练习只从「已采纳」的知识点出题。先去课程页提取知识点并确认。
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link className="btn primary" href={`/courses/${id}`}>
              去确认知识点
            </Link>
          </div>
        </div>
      ) : (
        <PracticeClient
          course={{ id: view.course.id, name: view.course.name }}
          chapter={{ id: view.chapter.id, title: view.chapter.title }}
          kp={{
            id: view.kp.id,
            name: view.kp.name,
            summary: view.kp.summary,
            importance: view.kp.importance,
            sourceRefs: view.kp.source_refs,
          }}
          questions={view.questions}
          done={view.done}
          empty={view.empty}
          answeredCount={view.answeredCount}
          total={view.total}
        />
      )}
    </AppShell>
  )
}
