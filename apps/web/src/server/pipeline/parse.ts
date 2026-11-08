import JSZip from 'jszip'

export interface ParsedPage {
  page: number
  text: string
}

export interface ParseResult {
  pages: ParsedPage[]
  pageCount: number
  note?: string
  failed?: boolean
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, (entity) => XML_ENTITIES[entity] ?? entity)
}

function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/a:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

export function cleanPages(pages: ParsedPage[]): ParsedPage[] {
  const cleaned = pages.map((page) => ({
    page: page.page,
    text: page.text
      .replace(/\r/g, '')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }))

  const counts = new Map<string, number>()
  for (const page of cleaned) {
    for (const line of page.text.split('\n')) {
      const key = line.trim()
      if (!key || key.length > 40) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.ceil(cleaned.length * 0.5))
  const repeated = new Set(
    [...counts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line),
  )

  return cleaned.map((page) => ({
    page: page.page,
    text: page.text
      .split('\n')
      .filter((line) => !repeated.has(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }))
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const { extractText } = await import('unpdf')
  const { totalPages, text } = await extractText(new Uint8Array(buffer), { mergePages: false })
  const pages = (text as string[]).map((content, index) => ({
    page: index + 1,
    text: content ?? '',
  }))
  return { pages: cleanPages(pages), pageCount: totalPages }
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(buffer)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('DOCX 中未找到正文')
  const xml = await entry.async('string')
  const text = xmlToText(xml)
  return { pages: cleanPages([{ page: 1, text }]), pageCount: 1, note: 'DOCX 无固定页码，出处定位到全文' }
}

async function parsePptx(buffer: Buffer): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(buffer)
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, match: name.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((item): item is { name: string; match: RegExpMatchArray } => Boolean(item.match))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))

  if (slides.length === 0) throw new Error('PPTX 中未找到幻灯片')
  const pages: ParsedPage[] = []
  for (const slide of slides) {
    const xml = await zip.file(slide.name)!.async('string')
    pages.push({ page: Number(slide.match[1]), text: xmlToText(xml) })
  }
  return { pages: cleanPages(pages), pageCount: slides.length }
}

export async function parseFile(filename: string, mime: string, buffer: Buffer): Promise<ParseResult> {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') return parsePdf(buffer)
  if (ext === 'docx') return parseDocx(buffer)
  if (ext === 'pptx') return parsePptx(buffer)
  if (ext === 'txt' || ext === 'md') {
    return {
      pages: cleanPages([{ page: 1, text: buffer.toString('utf8') }]),
      pageCount: 1,
    }
  }
  if (ext === 'ppt' || ext === 'doc') {
    return {
      pages: [],
      pageCount: 0,
      failed: true,
      note: '旧版二进制格式暂不支持，请另存为 .pptx / .docx 后重新上传',
    }
  }
  if (['png', 'jpg', 'jpeg'].includes(ext) || mime.startsWith('image/')) {
    return {
      pages: [],
      pageCount: 0,
      failed: true,
      note: '图片需要 OCR 服务。当前环境未启用 OCR，可在章节下使用「粘贴文字版」补充内容',
    }
  }
  return { pages: [], pageCount: 0, failed: true, note: `不支持的文件类型：${ext || mime}` }
}
