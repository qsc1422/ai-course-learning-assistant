'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, apiForm, errorText, toast } from '@/lib/client'
import { fmtDate, weekText } from '@/lib/format'

interface Row {
  name: string
  weekday: number | null
  startTime: string
  endTime: string
  weekRange: string
  room: string
  confidence: number
  note?: string
}

interface CourseRow {
  id: string
  name: string
  code: string | null
  teacher: string | null
  room: string
  slotText: string
  nextClass: string
  examDate: string | null
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export default function TimetableClient({ courses }: { courses: CourseRow[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<'idle' | 'parsing' | 'done'>('idle')
  const [rows, setRows] = useState<Row[]>([])
  const [sourceName, setSourceName] = useState('')
  const [conflicts, setConflicts] = useState<string[] | null>(null)
  const [importing, setImporting] = useState(false)

  const [manual, setManual] = useState({
    name: '',
    code: '',
    teacher: '',
    room: '',
    weekday: '',
    startTime: '',
    endTime: '',
    examDate: '',
    chapters: '',
  })
  const [creating, setCreating] = useState(false)

  async function handleFile(file: File) {
    setSourceName(file.name)
    setStage('parsing')
    try {
      const form = new FormData()
      form.set('file', file)
      const data = await apiForm<{ rows: Row[] }>('/api/timetable/parse', form)
      setRows(
        data.rows.map((row) => ({
          ...row,
          weekRange: row.weekRange || '1–16 周',
          room: row.room || '',
        })),
      )
      setStage('done')
      toast(`识别完成，共 ${data.rows.length} 行，请核对后导入`)
    } catch (error) {
      setStage('idle')
      toast(errorText(error))
    }
  }

  function patch(index: number, key: keyof Row, value: string | number | null) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    )
  }

  async function submitImport(mode: 'ask' | 'merge' | 'overwrite') {
    const cleaned = rows.filter((row) => row.name.trim())
    if (cleaned.length === 0) {
      toast('至少保留一行有课程名称的记录')
      return
    }
    setImporting(true)
    try {
      const result = await api<{ imported: number; created: number; merged: number; conflicts?: string[] }>(
        '/api/timetable/import',
        { rows: cleaned, mode },
      )
      if (result.conflicts && result.conflicts.length > 0) {
        setConflicts(result.conflicts)
        return
      }
      setConflicts(null)
      setStage('idle')
      setRows([])
      toast(`已导入 ${result.imported} 门课（新建 ${result.created}，合并 ${result.merged}）`)
      router.refresh()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setImporting(false)
    }
  }

  async function createManual() {
    if (!manual.name.trim()) {
      toast('先填写课程名称')
      return
    }
    setCreating(true)
    try {
      const chapters = manual.chapters
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const result = await api<{ courseId: string }>('/api/courses', {
        name: manual.name,
        code: manual.code,
        teacher: manual.teacher,
        room: manual.room,
        weekday: manual.weekday ? Number(manual.weekday) : null,
        startTime: manual.startTime,
        endTime: manual.endTime,
        examDate: manual.examDate,
        chapters,
      })
      toast('课程已建立')
      setManual({
        name: '',
        code: '',
        teacher: '',
        room: '',
        weekday: '',
        startTime: '',
        endTime: '',
        examDate: '',
        chapters: '',
      })
      router.refresh()
      router.push(`/courses/${result.courseId}`)
    } catch (error) {
      toast(errorText(error))
    } finally {
      setCreating(false)
    }
  }

  if (stage === 'parsing') {
    return (
      <div className="card parse-state">
        <div className="spinner" />
        <p>正在识别课表…</p>
        <div className="small">提取课程名、星期与时段、周次范围</div>
      </div>
    )
  }

  if (stage === 'done') {
    return (
      <>
        <div className="course-head">
          <div>
            <div className="kicker">识别完成 · 待你核对</div>
            <h1 className="h1" style={{ fontSize: 28, marginTop: 8 }}>
              {rows.filter((row) => row.confidence < 70).length > 0
                ? `有 ${rows.filter((row) => row.confidence < 70).length} 处我不确定，其余可直接用。`
                : '识别结果已就绪，核对后导入。'}
            </h1>
            <p className="lede" style={{ marginTop: 10 }}>
              识别置信度低于 70% 的行已标黄。所有文字都可以直接修改，改完再导入。
            </p>
          </div>
          <div className="mono" style={{ color: 'var(--muted)' }}>
            来源：{sourceName} · {rows.length} 行
          </div>
        </div>

        <table className="tbl">
          <thead>
            <tr>
              <th>课程</th>
              <th>星期</th>
              <th>开始</th>
              <th>结束</th>
              <th>周次</th>
              <th>教室</th>
              <th>置信度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className={row.confidence < 70 ? 'low' : ''}>
                <td>
                  <input value={row.name} onChange={(event) => patch(index, 'name', event.target.value)} />
                  {row.note ? <span className="row-note">{row.note}</span> : null}
                </td>
                <td>
                  <select
                    value={row.weekday ?? ''}
                    onChange={(event) =>
                      patch(index, 'weekday', event.target.value ? Number(event.target.value) : null)
                    }
                  >
                    <option value="">待补充</option>
                    {WEEKDAYS.map((day) => (
                      <option key={day} value={day}>
                        {weekText(day)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="time"
                    value={row.startTime}
                    onChange={(event) => patch(index, 'startTime', event.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={row.endTime}
                    onChange={(event) => patch(index, 'endTime', event.target.value)}
                  />
                </td>
                <td>
                  <input value={row.weekRange} onChange={(event) => patch(index, 'weekRange', event.target.value)} />
                </td>
                <td>
                  <input value={row.room} onChange={(event) => patch(index, 'room', event.target.value)} />
                </td>
                <td>
                  <span className={`conf ${row.confidence < 70 ? 'low' : ''}`}>
                    <span className="track">
                      <i style={{ width: `${row.confidence}%` }} />
                    </span>
                    {row.confidence}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="notice ai" style={{ marginTop: 20 }}>
          <span>AI</span>
          <span>
            识别不出来的地方没有猜：标记为待补充，等你核对。确认后课程会进入课程列表，并从各自的下一节课开始排任务。
            缺少星期或时段的课程会先建档，但不会产生「下一次上课时间」。
          </span>
        </div>

        <div className="confirm-bar">
          <div className="sum">
            共 <b>{rows.filter((row) => row.name.trim()).length}</b> 门课 · 其中{' '}
            <b style={{ color: 'var(--gold)' }}>{rows.filter((row) => row.confidence < 70).length}</b> 行待核对
          </div>
          <div className="row">
            <button
              className="btn ghost"
              onClick={() => {
                setStage('idle')
                setRows([])
              }}
              disabled={importing}
            >
              取消
            </button>
            <button className="btn primary" onClick={() => submitImport('ask')} disabled={importing}>
              {importing ? '导入中…' : '确认并导入'}
            </button>
          </div>
        </div>

        {conflicts ? (
          <div className="modal-mask">
            <div className="modal">
              <div className="modal-head">
                <h3>已有同名课程</h3>
                <button className="link mute" onClick={() => setConflicts(null)}>
                  关闭
                </button>
              </div>
              <div className="modal-body">
                <p className="small" style={{ lineHeight: 1.8 }}>
                  本学期已经存在这些课程：{conflicts.join('、')}。你可以合并时段（保留已有课程与资料），或覆盖其课表时段。
                </p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setConflicts(null)}>
                  取消
                </button>
                <button className="btn ghost" onClick={() => submitImport('merge')} disabled={importing}>
                  合并
                </button>
                <button className="btn primary" onClick={() => submitImport('overwrite')} disabled={importing}>
                  覆盖
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="course-head">
        <div>
          <div className="kicker">{courses.length > 0 ? '学期已建档' : '学期建档'}</div>
          <h1 className="h1" style={{ fontSize: 30, marginTop: 10 }}>
            {courses.length > 0 ? `本学期 ${courses.length} 门课，课表就是排任务的基准。` : '把你的课表，变成学习节奏。'}
          </h1>
          <p className="lede" style={{ marginTop: 12 }}>
            上传教务系统导出的表格，核对后建档。课表在这里不是一张图，它决定后面每一次「课前预习」和「考试倒排」的时间点。
          </p>
        </div>
      </div>

      <div className="upload">
        <div className="glyph">＋</div>
        <h3>选择课表文件</h3>
        <p>识别结果会先给你核对，确认前不会写入任何课程</p>
        <div className="formats">
          <span>XLSX</span>
          <span>XLS</span>
          <span>CSV</span>
        </div>
        <button className="btn primary" onClick={() => inputRef.current?.click()}>
          选择课表文件
        </button>
        <div className="small" style={{ marginTop: 14 }}>
          当前版本不做截图 OCR：请从教务系统导出 Excel / CSV，或手动新建课程
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
            event.target.value = ''
          }}
        />
      </div>

      <div className="notice">
        <span>说明</span>
        <span>
          课表只作为调度源使用：产出课程建档、下一次上课时间、考试日期三项，不单独成为功能模块。
          Excel 需要包含课程名称列；星期、时段、周次、教室列会被尽量识别，缺失项标为待补充。
        </span>
      </div>

      {courses.length > 0 ? (
        <>
          <h2 className="sec-title" style={{ marginTop: 26 }}>
            已导入课程<span className="count">{courses.length}</span>
          </h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>课程</th>
                <th>时段</th>
                <th>教室</th>
                <th>下一次上课</th>
                <th>期末</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>
                    <b>{course.name}</b>
                    {course.code || course.teacher ? (
                      <span className="row-note" style={{ color: 'var(--muted)' }}>
                        {[course.code, course.teacher].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </td>
                  <td>{course.slotText}</td>
                  <td>{course.room}</td>
                  <td>{course.nextClass}</td>
                  <td>{fmtDate(course.examDate)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn sm ghost" href={`/courses/${course.id}`}>
                      进入课程
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2 className="sec-title" style={{ marginTop: 32 }}>
        手动新建课程<span className="count">与导入等价</span>
      </h2>
      <div className="card pad">
        <div className="form-grid">
          <label className="field wide">
            <span>课程名称 *</span>
            <input
              value={manual.name}
              placeholder="例如：数据结构与算法"
              onChange={(event) => setManual({ ...manual, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>课程代码</span>
            <input
              value={manual.code}
              placeholder="CS201"
              onChange={(event) => setManual({ ...manual, code: event.target.value })}
            />
          </label>
          <label className="field">
            <span>教师</span>
            <input
              value={manual.teacher}
              placeholder="张明"
              onChange={(event) => setManual({ ...manual, teacher: event.target.value })}
            />
          </label>
          <label className="field">
            <span>教室</span>
            <input
              value={manual.room}
              placeholder="A302"
              onChange={(event) => setManual({ ...manual, room: event.target.value })}
            />
          </label>
          <label className="field">
            <span>星期</span>
            <select
              value={manual.weekday}
              onChange={(event) => setManual({ ...manual, weekday: event.target.value })}
            >
              <option value="">暂不安排</option>
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {weekText(day)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>开始时间</span>
            <input
              type="time"
              value={manual.startTime}
              onChange={(event) => setManual({ ...manual, startTime: event.target.value })}
            />
          </label>
          <label className="field">
            <span>结束时间</span>
            <input
              type="time"
              value={manual.endTime}
              onChange={(event) => setManual({ ...manual, endTime: event.target.value })}
            />
          </label>
          <label className="field">
            <span>期末考试日期</span>
            <input
              type="date"
              value={manual.examDate}
              onChange={(event) => setManual({ ...manual, examDate: event.target.value })}
            />
          </label>
          <label className="field wide">
            <span>初始章节（每行一个，可留空）</span>
            <textarea
              style={{ minHeight: 84 }}
              value={manual.chapters}
              placeholder={'第 1 章 绪论\n第 2 章 线性表'}
              onChange={(event) => setManual({ ...manual, chapters: event.target.value })}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={createManual} disabled={creating}>
            {creating ? '创建中…' : '新建课程'}
          </button>
          <span className="small">手填的课程与导入课程在数据结构上完全等价。</span>
        </div>
      </div>
    </>
  )
}
