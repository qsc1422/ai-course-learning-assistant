import type { Metadata } from 'next'
import './globals.css'
import ToastHost from '@/components/ToastHost'

export const metadata: Metadata = {
  title: '课伴 · 人机协同学习',
  description: '把课程原始资料变成可确认、可练习、可复盘的学习路径。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  )
}
