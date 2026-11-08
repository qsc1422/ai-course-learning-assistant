import { newId } from './ids'
import { q } from './db/index'

export async function logActivity(courseId: string, actor: 'ai' | 'me', text: string): Promise<void> {
  await q('INSERT INTO activity_log (id, course_id, actor, text) VALUES ($1, $2, $3, $4)', [
    newId(),
    courseId,
    actor,
    text,
  ])
}
