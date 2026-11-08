'use client'

import { useEffect, useState } from 'react'

export default function ToastHost() {
  const [message, setMessage] = useState('')
  const [on, setOn] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      setMessage(detail)
      setOn(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setOn(false), 2600)
    }
    window.addEventListener('ke-ban-toast', handler)
    return () => {
      window.removeEventListener('ke-ban-toast', handler)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return (
    <div className={`toast ${on ? 'on' : ''}`} role="status">
      {message}
    </div>
  )
}
