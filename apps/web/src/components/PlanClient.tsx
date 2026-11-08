'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, errorText, toast } from '@/lib/client'

export default function PlanClient({
  courseId,
  examDate,
  preferences,
}: {
  courseId: string
  examDate: string | null
  preferences: { id: string; kind: string; note: string | null }[]
}) {
  const router = useRouter()
  const [date, setDate] = useState(examDate ?? '')
  const [busy, setBusy] = useState(false)

  async function saveExam() {
    setBusy(true)
    try {
      await api(`/api/courses/${courseId}`, { examDate: date }, 'PATCH')
      toast(date ? '考试日期已更新，排期会按剩余天数倒排' : '已取消考试日期，只推错题、复述与上课章节')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/preferences/${id}`, { action: 'revoke' })
      toast('已撤销该偏好')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    }
  }

  return (
    <>
      <div className="card pad">
        <div className="panel-title">
          <h3>考试日期</h3>
          <span className="mono">决定每日容量</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <button className="btn primary sm" onClick={saveExam} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
          {examDate ? (
            <button
              className="btn ghost sm"
              disabled={busy}
              onClick={() => {
                setDate('')
                setBusy(true)
                void api(`/api/courses/${courseId}`, { examDate: null }, 'PATCH')
                  .then(() => {
                    toast('已取消考试日期，只推错题、复述与上课章节')
                    router.refresh()
                  })
                  .catch((error) => toast(errorText(error)))
                  .finally(() => setBusy(false))
              }}
            >
              清除
            </button>
          ) : null}
        </div>
        <div className="small" style={{ marginTop: 10, lineHeight: 1.8 }}>
          设置了日期：剩余知识点 ÷ 剩余天数，向上取整，单日不超过 3 个。没有日期：只推错题、依赖提示通过的题和上课章节。
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h3>课程偏好</h3>
          <span className="mono">{preferences.length}</span>
        </div>
        {preferences.length === 0 ? (
          <div className="empty-line">还没有偏好记录。驳回、过易、本章不考都会写在这里。</div>
        ) : (
          preferences.map((pref) => (
            <div className="pref-row" key={pref.id}>
              <span className="small">
                {pref.kind}
                {pref.note ? ` · ${pref.note}` : ''}
              </span>
              <button className="link" onClick={() => revoke(pref.id)}>
                撤销
              </button>
            </div>
          ))
        )}
      </div>
    </>
  )
}
