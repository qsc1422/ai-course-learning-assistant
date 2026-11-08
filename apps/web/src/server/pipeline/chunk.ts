import type { ParsedPage } from './parse'

export interface PipelineChunk {
  page: number
  content: string
}

const HEADING = /^(第[一二三四五六七八九十百\d]+[章节讲篇]|[一二三四五六七八九十]+、|\d+(\.\d+)*[.、\s]|（[一二三四五六七八九十]+）)/

function splitLong(text: string, target: number, overlap: number): string[] {
  if (text.length <= target * 1.5) return [text]
  const sentences = text.split(/(?<=[。！？；\n])/)
  const result: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (!sentence.trim()) continue
    if (buffer.length + sentence.length > target && buffer.length > 0) {
      result.push(buffer.trim())
      buffer = buffer.slice(Math.max(0, buffer.length - overlap)) + sentence
    } else {
      buffer += sentence
    }
  }
  if (buffer.trim()) result.push(buffer.trim())
  return result
}

export function chunkPages(pages: ParsedPage[]): PipelineChunk[] {
  const chunks: PipelineChunk[] = []

  for (const page of pages) {
    if (!page.text.trim()) continue
    const paragraphs = page.text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
    let buffer = ''
    let startPage = page.page

    const flush = () => {
      const content = buffer.replace(/\n{2,}/g, '\n').trim()
      if (content.length < 30) {
        buffer = ''
        return
      }
      const pieces = splitLong(content, 480, 50)
      for (const piece of pieces) {
        if (piece.trim()) chunks.push({ page: startPage, content: piece.trim() })
      }
      buffer = content.slice(-50)
      startPage = page.page
    }

    for (const paragraph of paragraphs) {
      const isHeading = paragraph.length <= 32 && HEADING.test(paragraph)
      if (isHeading && buffer.trim().length > 80) {
        flush()
        buffer = ''
      }
      if (buffer.length + paragraph.length > 520 && buffer.trim()) {
        flush()
      }
      buffer += (buffer && !buffer.endsWith('\n') ? '\n' : '') + paragraph
      if (isHeading && buffer.length > 0) {
        buffer += '\n'
      }
    }

    const tail = buffer.trim()
    if (tail.length >= 30) {
      for (const piece of splitLong(tail, 480, 50)) {
        if (piece.trim()) chunks.push({ page: startPage, content: piece.trim() })
      }
    }
  }

  return chunks
}
