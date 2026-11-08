import { newId } from '../ids'
import { parseJson, q, q1 } from '../db'
import type { JobRecord } from '../domain'

export async function enqueue(
  type: string,
  payload: unknown,
  idempotencyKey?: string | null,
): Promise<string> {
  if (idempotencyKey) {
    const existing = await q1<{ id: string }>('SELECT id FROM jobs WHERE idempotency_key = $1', [
      idempotencyKey,
    ])
    if (existing) return existing.id
  }
  const id = newId()
  await q(
    `INSERT INTO jobs (id, type, payload, idempotency_key) VALUES ($1, $2, $3, $4)`,
    [id, type, JSON.stringify(payload), idempotencyKey ?? null],
  )
  return id
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const job = await q1<JobRecord>('SELECT * FROM jobs WHERE id = $1', [id])
  if (!job) return null
  return { ...job, payload: parseJson(job.payload, {}) }
}

export async function claimJob(): Promise<JobRecord | null> {
  const job = await q1<JobRecord>(
    `UPDATE jobs
     SET status = 'running', locked_at = now(), updated_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
  )
  if (!job) return null
  return { ...job, payload: parseJson(job.payload, {}) }
}

export async function completeJob(id: string, result: unknown): Promise<void> {
  await q(
    `UPDATE jobs SET status = 'done', result = $2, locked_at = NULL, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(result ?? null)],
  )
}

export async function failJob(id: string, error: string): Promise<void> {
  await q(
    `UPDATE jobs
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
         error = $2, locked_at = NULL, updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  )
}

export async function recoverStaleJobs(): Promise<void> {
  await q(
    `UPDATE jobs
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
         error = COALESCE(error, '执行超时，已回收'), locked_at = NULL, updated_at = now()
     WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`,
  )
}
