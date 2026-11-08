'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, errorText, toast } from '@/lib/client'

export default function TaskTick({ taskId, done }: { taskId: string; done: boolean }) {
  const [checked, setChecked] = useState(done)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function toggle() {
    if (busy) return
    setBusy(true)
    const next = !checked
    try {
      await api(`/api/tasks/${taskId}`, { done: next })
      setChecked(next)
      toast(next ? '已记下完成，明天继续接上' : '已取消完成标记')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className="tick"
      onClick={toggle}
      disabled={busy}
      aria-label={checked ? '取消完成' : '标记完成'}
    >
      ✓
    </button>
  )
}
