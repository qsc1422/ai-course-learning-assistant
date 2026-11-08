export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startJobRunner } = await import('./server/jobs/runner')
    startJobRunner()
  }
}
