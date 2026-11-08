import { NextResponse } from 'next/server'

export function ok(data: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: true, ...data })
}

export function fail(error: unknown, status = 400): NextResponse {
  const message = error instanceof Error ? error.message : String(error ?? '操作失败')
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function run(fn: () => Promise<Record<string, unknown>>): Promise<NextResponse> {
  try {
    return ok(await fn())
  } catch (error) {
    console.error('[api]', error)
    return fail(error)
  }
}

export function asInt(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
