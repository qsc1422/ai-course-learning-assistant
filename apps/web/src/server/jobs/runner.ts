import { claimJob, completeJob, failJob, recoverStaleJobs } from './queue'
import { handleJob } from './handlers'

const globalKey = Symbol.for('ke-ban.job-runner')

type RunnerGlobal = typeof globalThis & {
  [globalKey]?: boolean
}

async function tick(): Promise<void> {
  try {
    await recoverStaleJobs()
    for (let index = 0; index < 2; index += 1) {
      const job = await claimJob()
      if (!job) break
      try {
        const result = await handleJob(job.type, job.payload)
        await completeJob(job.id, result)
      } catch (error) {
        await failJob(job.id, error instanceof Error ? error.message : '任务执行失败')
      }
    }
  } catch (error) {
    console.error('[jobs] tick failed', error)
  }
}

export function startJobRunner(): void {
  const store = globalThis as RunnerGlobal
  if (store[globalKey]) return
  store[globalKey] = true
  console.log('[jobs] runner started')

  const loop = async () => {
    await tick()
    setTimeout(loop, 2000)
  }
  setTimeout(loop, 800)
}
