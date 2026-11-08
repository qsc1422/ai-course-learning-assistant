import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL } from './schema'

type Row = Record<string, unknown>
type QueryResult<T> = { rows: T[]; affectedRows?: number }

interface Executor {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  exec(sql: string): Promise<unknown>
}

const globalKey = Symbol.for('ke-ban.db')

type DbGlobal = typeof globalThis & {
  [globalKey]?: Promise<Executor>
}

export const OWNER_ID = 'local-user'

// DATE 列（OID 1082）默认会被驱动解析成 JS Date，拼成 `${exam_date}T00:00:00` 会得到
// Invalid Date。统一保留 'YYYY-MM-DD' 字符串，SQL 侧行为不变。
const DATE_OID = 1082
const keepDateString = (value: string) => value

async function createExecutor(): Promise<Executor> {
  const connectionString = process.env.DATABASE_URL
  if (connectionString) {
    const { Pool, types } = await import('pg')
    types.setTypeParser(DATE_OID, keepDateString)
    const pool = new Pool({ connectionString, max: 4 })
    await pool.query('SELECT 1')
    return {
      async query<T>(sql: string, params: unknown[] = []) {
        const result = await pool.query(sql, params as never[])
        return { rows: result.rows as T[], affectedRows: result.rowCount ?? undefined }
      },
      async exec(sql: string) {
        await pool.query(sql)
      },
    }
  }

  const dataDir = path.resolve(
    process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), '.data', 'pg'),
  )
  fs.mkdirSync(dataDir, { recursive: true })

  const { PGlite } = await import('@electric-sql/pglite')
  const { vector } = await import('@electric-sql/pglite-pgvector')
  const db = new PGlite(dataDir, {
    extensions: { vector },
    parsers: { [DATE_OID]: keepDateString },
  })
  await db.waitReady

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params as never[])
      return { rows: result.rows as T[], affectedRows: result.affectedRows }
    },
    async exec(sql: string) {
      await db.exec(sql)
    },
  }
}

export async function getDb(): Promise<Executor> {
  const store = globalThis as DbGlobal
  if (!store[globalKey]) {
    store[globalKey] = (async () => {
      const executor = await createExecutor()
      await executor.exec(SCHEMA_SQL)
      return executor
    })()
  }
  return store[globalKey]!
}

export async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb()
  const result = await db.query<T>(sql, params)
  return result.rows
}

export async function q1<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params)
  return rows[0] ?? null
}

export async function exec(sql: string): Promise<void> {
  const db = await getDb()
  await db.exec(sql)
}

export function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

export function toIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}
