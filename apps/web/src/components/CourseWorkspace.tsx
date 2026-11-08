'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, apiForm, errorText, toast, waitForJob } from '@/lib/client'
import { fmtDate, importanceClass, parseStatusClass } from '@/lib/format'
import SourceButton from '@/components/SourceButton'

interface ChapterLite {
  id: string
  title: string
  status: string
  notExam: boolean
  band: string | null
}

interface FileLite {
  id: string
  chapter_id: string | null
  chapter_title: string | null
  filename: string
  parse_status: string
  parse_note: string | null
  size: number
  created_at: string
}

interface Evidence {
  chunk_id: string
  quote: string
}

interface DraftLite {
  id: string
  status: string
  payload: {
    name: string
    summary: string
    importance: string
    evidence: Evidence[]
  }
  original_payload: unknown
  created_at: string
  updated_at: string
}

interface KpLite {
  id: string
  name: string
  importance: string
  source_refs: string[]
  status: string
}

interface PrefLite {
  id: string
  kind: string
  note: string | null
}

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: '待确认', className: '' },
  adopted: { label: '已采纳', className: 'adopted' },
  modified: { label: '已修改', className: 'edited' },
  rejected: { label: '已驳回', className: 'rejected' },
}

const IMPORTANCES = ['必背', '理解', '了解']

export default function CourseWorkspace(props: {
  courseId: string
  courseName: string
  chapters: ChapterLite[]
  selectedChapter: { id: string; title: string } | null
  files: FileLite[]
  drafts: DraftLite[]
  kps: KpLite[]
  preferences: PrefLite[]
  engineLocal: boolean
}) {
  const { courseId, chapters, selectedChapter, files, drafts, kps, preferences } = props
  const router = useRouter()
  const uploadRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [jobText, setJobText] = useState('')
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('手写文字版')
  const [pasteBody, setPasteBody] = useState('')
  const [chapterTitle, setChapterTitle] = useState('')
  const [creatingChapter, setCreatingChapter] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', summary: '', importance: '理解' })

  const selected = chapters.find((item) => item.id === selectedChapter?.id) ?? null
  const adoptedCount = drafts.filter((draft) => draft.status === 'adopted' || draft.status === 'modified').length
  const draftCount = drafts.filter((draft) => draft.status === 'draft').length
  const parsedFiles = files.filter((file) => file.parse_status === '已解析')
  const currentFiles = files.filter((file) => file.chapter_id === selected?.id)

  useEffect(() => {
    const pending = files.some((file) => file.parse_status === '未解析' || file.parse_status === '解析中')
    if (!pending) return
    const timer = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(timer)
  }, [files, router])

  function laterRefresh() {
    setTimeout(() => router.refresh(), 2200)
    setTimeout(() => router.refresh(), 5500)
  }

  async function upload(list: FileList | null, chapterId: string) {
    if (!list || list.length === 0) return
    setUploading(true)
    const filesToUpload = Array.from(list)
    try {
      for (const file of filesToUpload) {
        const form = new FormData()
        form.set('file', file)
        form.set('chapterId', chapterId)
        const result = await apiForm<{ duplicate: boolean }>(`/api/courses/${courseId}/files`, form)
        toast(result.duplicate ? `${file.name}：内容重复，已复用已有解析结果` : `${file.name} 已上传，正在解析`)
      }
      laterRefresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setUploading(false)
    }
  }

  async function extract() {
    if (!selected) return
    setJobText('正在提取知识点…')
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/chapters/${selected.id}/extract`, {})
      await waitForJob(jobId, (status) => {
        if (status === 'pending') setJobText('任务已排队…')
        if (status === 'running') setJobText('正在依据原文抽取知识点…')
      })
      setJobText('')
      toast('提取完成。新增内容都是草稿，需要你确认。')
      router.refresh()
    } catch (error) {
      setJobText('')
      toast(errorText(error))
    }
  }

  async function draftAction(id: string, action: 'adopt' | 'reject' | 'restore') {
    try {
      await api(`/api/drafts/${id}`, { action })
      toast(action === 'adopt' ? '已采纳，进入学习数据' : action === 'reject' ? '已驳回，后续生成会参考' : '已找回')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    }
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim()) {
      toast('知识点名称不能为空')
      return
    }
    try {
      await api(`/api/drafts/${id}`, {
        action: 'modify',
        name: editForm.name,
        summary: editForm.summary,
        importance: editForm.importance,
      })
      setEditingId(null)
      toast('已保存修改并进入学习数据')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    }
  }

  async function batch(action: 'adopt-all' | 'confirm' | 'not-exam') {
    if (!selected) return
    try {
      await api(`/api/chapters/${selected.id}/bulk`, {
        action,
        notExam: action === 'not-exam' ? !selected.notExam : undefined,
      })
      toast(
        action === 'adopt-all'
          ? '已整章采纳'
          : action === 'confirm'
            ? '章节已确认，可以练习'
            : selected.notExam
              ? '已取消本章不考'
              : '已标记本章不考，后续不再为它排任务',
      )
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    }
  }

  async function fileAction(id: string, action: 'retry' | 'delete' | 'move', chapterId?: string) {
    if (action === 'delete' && !window.confirm('删除该文件及其解析片段？已采纳的知识点会标记为需复核。')) return
    setBusyFile(id)
    try {
      await api(`/api/files/${id}`, { action, chapterId })
      toast(action === 'retry' ? '已重新入队解析' : action === 'delete' ? '已删除' : '已移动章节，相关知识点标记为需复核')
      laterRefresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusyFile(null)
    }
  }

  async function openFile(id: string) {
    try {
      const { url } = await api<{ url: string }>(`/api/files/${id}/link`, undefined, 'GET')
      window.open(url, '_blank', 'noopener')
    } catch (error) {
      toast(errorText(error))
    }
  }

  async function createChapter() {
    if (!chapterTitle.trim()) {
      toast('填写章节名称')
      return
    }
    setCreatingChapter(true)
    try {
      await api(`/api/courses/${courseId}/chapters`, { title: chapterTitle })
      setChapterTitle('')
      toast('章节已建立')
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setCreatingChapter(false)
    }
  }

  async function paste() {
    if (!selected) return
    if (pasteBody.trim().length < 20) {
      toast('文字版内容太短，至少粘贴一段完整内容')
      return
    }
    try {
      const result = await api<{ duplicate: boolean }>(`/api/courses/${courseId}/paste`, {
        chapterId: selected.id,
        text: pasteBody,
        filename: pasteName || '手写文字版',
      })
      setPasteOpen(false)
      setPasteBody('')
      toast(result.duplicate ? '内容重复，已复用已有解析结果' : '文字版已归入章节，正在解析')
      laterRefresh()
    } catch (error) {
      toast(errorText(error))
    }
  }

  return (
    <>
      <div className="ws-grid">
        <div>
          {selected ? (
            <>
              <h2 className="sec-title">
                知识点 · {selected.title}
                <span className="count">
                  {adoptedCount} 已采纳 / {draftCount} 待确认
                </span>
              </h2>

              {selected.notExam ? (
                <div className="chap-off">
                  本章已标记「不考」，系统不会为它排任务，也不计入掌握度。
                  <button className="link" style={{ marginLeft: 10 }} onClick={() => batch('not-exam')}>
                    取消标记
                  </button>
                </div>
              ) : (
                <div className="notice ai">
                  <span>AI</span>
                  <span>
                    {props.engineLocal
                      ? '当前由本地规则引擎依据原文抽取术语与定义句，重要度为规则判定。'
                      : '知识点由模型依据原文提取，每条都带出处。'}
                    所有结果先是草稿；未采纳的内容不进入练习与统计。确认后章节才会变成「可练习」。
                  </span>
                </div>
              )}

              {drafts.length === 0 ? (
                <div className="empty">
                  <b>这一章还没有知识点草稿。</b>
                  <br />
                  {parsedFiles.length === 0
                    ? '先上传资料，等解析完成后再提取。'
                    : '资料已解析，可以现在提取知识点。'}
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                    <button
                      className="btn primary"
                      onClick={extract}
                      disabled={Boolean(jobText) || parsedFiles.length === 0}
                    >
                      {jobText || '提取知识点'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {drafts.map((draft, index) => {
                    const state = STATUS[draft.status] ?? STATUS.draft
                    const editing = editingId === draft.id
                    return (
                      <div
                        className={`item ${draft.status === 'rejected' ? 'rejected' : ''}`}
                        key={draft.id}
                      >
                        <div className="idx">{String(index + 1).padStart(2, '0')}</div>
                        <div>
                          {editing ? (
                            <div className="stack" style={{ gap: 8 }}>
                              <input
                                value={editForm.name}
                                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                                placeholder="知识点名称"
                              />
                              <textarea
                                style={{ minHeight: 64 }}
                                value={editForm.summary}
                                onChange={(event) => setEditForm({ ...editForm, summary: event.target.value })}
                                placeholder="一句话说明"
                              />
                              <select
                                value={editForm.importance}
                                onChange={(event) =>
                                  setEditForm({ ...editForm, importance: event.target.value })
                                }
                              >
                                {IMPORTANCES.map((item) => (
                                  <option key={item} value={item}>
                                    {item}
                                  </option>
                                ))}
                              </select>
                              <div className="row">
                                <button className="btn sm primary" onClick={() => saveEdit(draft.id)}>
                                  保存并采纳
                                </button>
                                <button className="btn sm ghost" onClick={() => setEditingId(null)}>
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="item-name">
                                {draft.payload.name}
                                <span className={`imp ${importanceClass(draft.payload.importance)}`}>
                                  {draft.payload.importance}
                                </span>
                                <span className={`state-chip ${state.className}`}>{state.label}</span>
                              </div>
                              <div className="item-desc">{draft.payload.summary}</div>
                              <div className="src">
                                <span>{draft.payload.evidence.length} 条出处</span>
                                {draft.payload.evidence.slice(0, 3).map((item, sourceIndex) => (
                                  <SourceButton
                                    key={`${draft.id}-${item.chunk_id}`}
                                    chunkId={item.chunk_id}
                                    label={`原文 ${sourceIndex + 1}`}
                                  />
                                ))}
                                <span style={{ color: 'var(--line)' }}>|</span>
                                <span>更新于 {fmtDate(draft.updated_at)}</span>
                              </div>
                            </>
                          )}
                        </div>
                        {!editing ? (
                          <div className="acts">
                            {draft.status === 'rejected' ? (
                              <button className="act" onClick={() => draftAction(draft.id, 'restore')}>
                                找回
                              </button>
                            ) : (
                              <>
                                {draft.status === 'draft' ? (
                                  <button className="act chosen" onClick={() => draftAction(draft.id, 'adopt')}>
                                    采纳
                                  </button>
                                ) : null}
                                <button
                                  className="act"
                                  onClick={() => {
                                    setEditingId(draft.id)
                                    setEditForm({
                                      name: draft.payload.name,
                                      summary: draft.payload.summary,
                                      importance: draft.payload.importance,
                                    })
                                  }}
                                >
                                  修改
                                </button>
                                <button className="act rej" onClick={() => draftAction(draft.id, 'reject')}>
                                  驳回
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  <div className="confirm-bar">
                    <div className="sum">
                      已采纳 <b>{adoptedCount}</b> 条 · 待确认 <b>{draftCount}</b> 条
                    </div>
                    <div className="row">
                      <button className="btn ghost" onClick={() => batch('not-exam')} disabled={Boolean(jobText)}>
                        {selected.notExam ? '取消本章不考' : '本章不考'}
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => batch('adopt-all')}
                        disabled={draftCount === 0}
                      >
                        整章采纳
                      </button>
                      <button className="btn primary" onClick={() => batch('confirm')} disabled={adoptedCount === 0}>
                        确认本章可练习
                      </button>
                    </div>
                  </div>

                  {selected.status === '可练习' ? (
                    <div className="notice" style={{ background: 'var(--green-soft)', borderColor: '#c4d6cc', color: '#1f5c47' }}>
                      <span>✓</span>
                      <span>
                        本章已确认可练习。
                        <Link className="link" href={`/courses/${courseId}/practice?chapter=${selected.id}`} style={{ marginLeft: 8 }}>
                          去练习这一章
                        </Link>
                      </span>
                    </div>
                  ) : null}
                </div>
              )}

              {kps.length > 0 ? (
                <div className="card pad" style={{ marginTop: 20 }}>
                  <div className="panel-title">
                    <h3>已进入学习数据的知识点</h3>
                    <span className="mono">{kps.length}</span>
                  </div>
                  <div className="stack" style={{ gap: 7 }}>
                    {kps.map((kp) => (
                      <div className="pref-row" key={kp.id}>
                        <span>
                          {kp.name}
                          {kp.status === 'modified' ? <span className="small"> · 已修改</span> : null}
                        </span>
                        <span className={`imp ${importanceClass(kp.importance)}`}>{kp.importance}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty">
              <b>这门课还没有章节。</b>
              <br />
              先在右侧新建章节，再把资料归入章节。
            </div>
          )}
        </div>

        <aside>
          <div className="card pad">
            <div className="panel-title">
              <h3>资料库</h3>
              <span className="mono">{files.length} 个文件</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn primary sm"
                onClick={() => uploadRef.current?.click()}
                disabled={!selected || uploading}
              >
                {uploading ? '上传中…' : '上传资料'}
              </button>
              <button className="btn ghost sm" onClick={() => setPasteOpen(true)} disabled={!selected}>
                粘贴文字版
              </button>
            </div>
            <input
              ref={uploadRef}
              type="file"
              multiple
              accept=".pdf,.pptx,.ppt,.docx,.doc,.txt,.md,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={(event) => {
                void upload(event.target.files, selected?.id ?? '')
                event.target.value = ''
              }}
            />
            {selected ? (
              <div className="small" style={{ marginTop: 8 }}>
                新资料归入「{selected.title}」；上传后可随时移动。
              </div>
            ) : null}

            <div style={{ marginTop: 14 }}>
              {files.length === 0 ? (
                <div className="empty-line">还没有资料。上传 PDF / PPTX / DOCX / TXT / MD，或粘贴文字版。</div>
              ) : (
                files.map((file) => (
                  <div className="file-row" key={file.id}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="file-name">{file.filename}</span>
                        <span className={`pill ${parseStatusClass(file.parse_status)}`}>{file.parse_status}</span>
                      </div>
                      <div className="file-meta">
                        {file.chapter_title ?? '未归类'} · {(file.size / 1024).toFixed(0)} KB ·{' '}
                        {fmtDate(file.created_at)}
                      </div>
                      {file.parse_note ? (
                        <div className="small" style={{ color: 'var(--clay)', marginTop: 3 }}>
                          {file.parse_note}
                        </div>
                      ) : null}
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        <button className="link" onClick={() => openFile(file.id)}>
                          原文
                        </button>
                        {file.parse_status !== '已解析' ? (
                          <button
                            className="link"
                            onClick={() => fileAction(file.id, 'retry')}
                            disabled={busyFile === file.id}
                          >
                            重试解析
                          </button>
                        ) : null}
                        <select
                          style={{ padding: '2px 6px', fontSize: 11.5, maxWidth: 140 }}
                          value={file.chapter_id ?? ''}
                          onChange={(event) => fileAction(file.id, 'move', event.target.value)}
                        >
                          <option value="">移动至…</option>
                          {chapters.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                        <button
                          className="link mute"
                          onClick={() => fileAction(file.id, 'delete')}
                          disabled={busyFile === file.id}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {selected ? (
              <div className="notice" style={{ marginBottom: 0 }}>
                <span>解析</span>
                <span>
                  本章已解析 {currentFiles.filter((file) => file.parse_status === '已解析').length} /{' '}
                  {currentFiles.length} 个文件。只有「已解析」的文件参与知识点提取。
                </span>
              </div>
            ) : null}

            <div className="panel-title" style={{ marginTop: 20 }}>
              <h3>新建章节</h3>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                style={{ flex: 1 }}
                placeholder="例如：第 3 章 树与二叉树"
                value={chapterTitle}
                onChange={(event) => setChapterTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createChapter()
                }}
              />
              <button className="btn sm ghost" onClick={createChapter} disabled={creatingChapter}>
                新建
              </button>
            </div>
          </div>

          {selected ? (
            <div className="card pad" style={{ marginTop: 16 }}>
              <div className="panel-title">
                <h3>提取知识点</h3>
                <span className="mono">{selected.status}</span>
              </div>
              <p className="small" style={{ lineHeight: 1.7 }}>
                依据本章已解析的 {parsedFiles.filter((file) => file.chapter_id === selected.id).length} 个文件。
                再次提取会保留已采纳条目，新增内容以草稿追加。
              </p>
              <button
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                onClick={extract}
                disabled={Boolean(jobText) || parsedFiles.filter((file) => file.chapter_id === selected.id).length === 0}
              >
                {jobText || (drafts.length > 0 ? '再次提取（追加草稿）' : '提取知识点')}
              </button>
              {parsedFiles.filter((file) => file.chapter_id === selected.id).length === 0 ? (
                <div className="small" style={{ marginTop: 8 }}>
                  本章还没有已解析文件，先上传或粘贴文字版。
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="card pad" style={{ marginTop: 16 }}>
            <div className="panel-title">
              <h3>课程偏好</h3>
              <span className="mono">{preferences.length}</span>
            </div>
            {preferences.length === 0 ? (
              <div className="empty-line">还没有偏好记录。标记「本章不考」「这题过易」后会写在这里。</div>
            ) : (
              preferences.map((pref) => (
                <div className="pref-row" key={pref.id}>
                  <span className="small">
                    {pref.kind}
                    {pref.note ? ` · ${pref.note}` : ''}
                  </span>
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        await api(`/api/preferences/${pref.id}`, { action: 'revoke' })
                        toast('已撤销该偏好')
                        router.refresh()
                      } catch (error) {
                        toast(errorText(error))
                      }
                    }}
                  >
                    撤销
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {pasteOpen ? (
        <div className="modal-mask" onClick={() => setPasteOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: 'min(720px,100%)' }}>
            <div className="modal-head">
              <h3>粘贴文字版 · {selected?.title}</h3>
              <button className="link mute" onClick={() => setPasteOpen(false)}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <span>文件名</span>
                <input value={pasteName} onChange={(event) => setPasteName(event.target.value)} />
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <span>正文内容</span>
                <textarea
                  style={{ minHeight: 220 }}
                  value={pasteBody}
                  placeholder="粘贴课件文字、手写笔记的转写内容或教材段落…"
                  onChange={(event) => setPasteBody(event.target.value)}
                />
              </div>
              <p className="small" style={{ marginTop: 10 }}>
                文字版与上传文件进入同一条解析管线，同样保留片段出处。适合扫描件或图片识别不出的情况。
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setPasteOpen(false)}>
                取消
              </button>
              <button className="btn primary" onClick={paste} disabled={!selected}>
                归入章节并解析
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
