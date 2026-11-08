import AppShell from '@/components/AppShell'
import TimetableClient from '@/components/TimetableClient'
import { courseMeta, listCourses, listSlots } from '@/server/services/courses'
import { semesterInfo } from '@/server/ids'

export const dynamic = 'force-dynamic'

export default async function TimetablePage() {
  const courses = await listCourses()
  const slotsByCourse = await Promise.all(courses.map((course) => listSlots(course.id)))
  const rows = courses.map((course, index) => {
    const slots = slotsByCourse[index]
    const meta = courseMeta(course, slots)
    return {
      id: course.id,
      name: course.name,
      code: course.code,
      teacher: course.teacher,
      room: course.room ?? meta.slotText,
      slotText: meta.slotText,
      nextClass: meta.nextClass,
      examDate: course.exam_date,
    }
  })
  const semester = semesterInfo()

  return (
    <AppShell
      active="timetable"
      crumb={
        <>
          <b>课表</b>
          <i>/</i>第 {semester.week} 周
        </>
      }
    >
      <TimetableClient courses={rows} />
    </AppShell>
  )
}
