'use client'

import { useState } from 'react'
import { api, errorText } from '@/lib/client'

interface Source {
  id: string
  content: string
  page_no: number
  filename: string
  file_id: string
  file_url: string
}

export default function SourceButton({ chunkId, label = '查看出处' }: { chunkId: string; label?: string }) {
  const [source, setSource] = useState<Source | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (source) {
      setOpen(true)
      return
    }
    setLoading(true)
    try {
      const data = await api<{ source: Source }>(`/api/chunks/${chunkId}`, undefined, 'GET')
      setSource(data.source)
      setOpen(true)
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('ke-ban-toast', { detail: errorText(error) }),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button onClick={load} disabled={loading} title="查看原始资料片段">
        {loading ? '读取中…' : label}
      </button>
      {open && source ? (
        <div className="modal-mask" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>原文出处</h3>
              <button className="link mute" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <div className="src" style={{ marginBottom: 12 }}>
                <span>
                  {source.filename} · 第 {source.page_no} 页
                </span>
                <a className="link" href={source.file_url} target="_blank" rel="noreferrer">
                  打开原始文件
                </a>
              </div>
              <div
                style={{
                  background: 'var(--sheet-2)',
                  border: '1px solid var(--line)',
                  padding: '12px 14px',
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: 'var(--ink-2)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {source.content}
              </div>
              <p className="small" style={{ marginTop: 10 }}>
                片段是系统切分后的原文单位；判断与资料矛盾时，以原文为准。
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
