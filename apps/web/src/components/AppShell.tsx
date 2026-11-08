import Link from 'next/link'
import { engineLabel } from '@/server/ai'
import { listCourses } from '@/server/services/courses'
import { semesterInfo } from '@/server/ids'

const NAV = [
  { key: 'today', no: '01', label: '今日', href: '/' },
  { key: 'timetable', no: '02', label: '课表', href: '/timetable' },
  { key: 'courses', no: '03', label: '课程', href: '/courses' },
  { key: 'practice', no: '04', label: '练习', href: '/practice' },
  { key: 'review', no: '05', label: '复盘', href: '/review' },
]

const DOTS = ['', 'g2', 'g3', 'g4', 'g5']

export default async function AppShell({
  active,
  crumb,
  children,
}: {
  active: string
  crumb: React.ReactNode
  children: React.ReactNode
}) {
  const courses = await listCourses()
  const engine = engineLabel()
  const semester = semesterInfo()
  const now = new Date()
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="logo">课</div>
          <div>
            <span className="mark">课伴</span>
            <span className="sub">Human × AI Study</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link key={item.key} href={item.href} className={`nav-item ${active === item.key ? 'active' : ''}`}>
              <span className="no">{item.no}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="rail-course">
          <div className="label">我的课程</div>
          {courses.slice(0, 6).map((course, index) => (
            <Link key={course.id} href={`/courses/${course.id}`} title={course.name}>
              <span className={`dot ${DOTS[index % DOTS.length]}`} />
              {course.name}
            </Link>
          ))}
          {courses.length === 0 ? <div className="small">还没有课程</div> : null}
        </div>
        <div className="rail-foot">
          {semester.label} · 第 {semester.week} 周<br />
          <Link href="/courses">课程与资料库</Link>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumb">{crumb}</div>
          <div className="topmeta">
            <span className={`demo-chip ${engine.kind === 'local' ? 'local' : ''}`}>
              {engine.kind === 'local' ? '本地规则引擎' : engine.label}
            </span>
            <span>
              {weekday} · 第 {semester.week} 周
            </span>
          </div>
        </div>
        <div className="stage">{children}</div>
      </main>
    </div>
  )
}
