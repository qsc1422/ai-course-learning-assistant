export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  method: 'GET' | 'POST' | 'PATCH' = 'POST',
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body == null ? undefined : { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  return read<T>(response)
}

export async function apiForm<T = Record<string, unknown>>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: form })
  return read<T>(response)
}

async function read<T>(response: Response): Promise<T> {
  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    throw new Error(`服务返回异常（HTTP ${response.status}）`)
  }
  if (!response.ok || data.ok === false) {
    throw new Error(typeof data.error === 'string' ? data.error : `请求失败（HTTP ${response.status}）`)
  }
  return data as T
}

export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent('ke-ban-toast', { detail: message }))
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function waitForJob(jobId: string, onTick?: (status: string) => void): Promise<void> {
  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const data = await api<{ job: { status: string; error: string | null } }>(
      `/api/jobs/${jobId}`,
      undefined,
      'GET',
    )
    onTick?.(data.job.status)
    if (data.job.status === 'done') return
    if (data.job.status === 'failed') throw new Error(data.job.error || '任务执行失败')
  }
  throw new Error('任务仍在执行，请稍后刷新查看')
}
