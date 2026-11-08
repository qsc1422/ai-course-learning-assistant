import crypto from 'node:crypto'

export function newId(): string {
  return crypto.randomUUID()
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function weekdayOf(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function daysSince(iso: string | null): number {
  if (!iso) return 30
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
}

export function semesterInfo(date = new Date()): { label: string; week: number } {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const autumn = month >= 8
  const start = new Date(autumn ? `${year}-09-01T00:00:00` : `${year}-02-17T00:00:00`)
  const week = Math.max(1, Math.floor((date.getTime() - start.getTime()) / (7 * 86400000)) + 1)
  return { label: `${year} ${autumn ? '秋' : '春'}`, week }
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
