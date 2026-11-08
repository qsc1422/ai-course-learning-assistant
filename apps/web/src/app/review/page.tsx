import { redirect } from 'next/navigation'
import { listCourses } from '@/server/services/courses'

export const dynamic = 'force-dynamic'

export default async function ReviewEntry() {
  const courses = await listCourses()
  if (courses.length === 0) redirect('/timetable')
  redirect(`/courses/${courses[0].id}/review`)
}
