import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), '.data', 'storage'))
}

function secret(): string {
  return process.env.FILE_SECRET ?? 'ke-ban-local-file-secret'
}

export function storageKeyFor(id: string): string {
  return `${id.slice(0, 2)}/${id}`
}

export function saveBuffer(id: string, buffer: Buffer): string {
  const key = storageKeyFor(id)
  const full = path.join(storageRoot(), key)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, buffer)
  return key
}

export function readBuffer(key: string): Buffer {
  const full = path.join(storageRoot(), key)
  return fs.readFileSync(full)
}

export function removeBuffer(key: string): void {
  const full = path.join(storageRoot(), key)
  fs.rmSync(full, { force: true })
}

export function signFile(fileId: string, expiresAt: number): string {
  return crypto.createHmac('sha256', secret()).update(`${fileId}.${expiresAt}`).digest('hex')
}

export function verifyFileSignature(fileId: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false
  const expected = signFile(fileId, expiresAt)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function signedFileUrl(fileId: string, ttlMs = 5 * 60 * 1000): string {
  const expiresAt = Date.now() + ttlMs
  return `/api/files/${fileId}/raw?expires=${expiresAt}&sig=${signFile(fileId, expiresAt)}`
}
