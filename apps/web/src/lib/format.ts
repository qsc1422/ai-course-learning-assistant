export function fmtTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '未设置'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '未设置'
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '未安排'
  return `${fmtDate(value)} ${fmtTime(value)}`
}

export function bandClass(band: string): 'good' | 'mid' | 'weak' | 'none' {
  if (band === '稳固') return 'good'
  if (band === '一般') return 'mid'
  if (band === '薄弱') return 'weak'
  return 'none'
}

export function importanceClass(importance: string): 'must' | 'under' | 'know' {
  if (importance === '必背') return 'must'
  if (importance === '理解') return 'under'
  return 'know'
}

export function weekText(weekday: number | null): string {
  if (!weekday) return ''
  return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][weekday] ?? ''
}

export function parseStatusClass(status: string): 'ok' | 'wait' | 'bad' {
  if (status === '已解析') return 'ok'
  if (status === '解析失败') return 'bad'
  return 'wait'
}

export function taskTypeClass(kind: string): 'clay' | 'green' | '' {
  if (kind === '错题重做') return 'clay'
  if (kind === '课前预习') return 'green'
  return ''
}

export function nowHHmm(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
