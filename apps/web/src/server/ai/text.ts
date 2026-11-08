const STOPWORDS = new Set([
  '我们', '你们', '他们', '可以', '不能', '就是', '这个', '那个', '这些', '那些', '这样', '那样',
  '因为', '所以', '但是', '然后', '如果', '并且', '以及', '其中', '通过', '进行', '具有', '需要',
  '一个', '一种', '一些', '什么', '怎么', '为什么', '时候', '问题', '情况', '方式', '方法', '内容',
  '主要', '基本', '一般', '通常', '例如', '如图', '如表', '注意', '因此', '同时', '对于', '由于',
  '本节', '本章', '如下', '以上', '以下', '之间', '分别', '可以', '能够', '应该', '必须', '不同',
  '相关', '有关', '这种', '那种', '第一', '第二', '第三', '每个', '所有', '任何', '其他', '此外',
])

const PUNCT = /[\s，。！？；：、“”‘’（）《》【】〈〉…—－\-·,.!?;:'"()\[\]{}]/g

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(PUNCT, '')
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?；;\n])/)
    .map((item) => item.trim())
    .filter((item) => item.length > 4)
}

export function keywordsOf(text: string, limit = 6): string[] {
  const candidates = new Map<string, number>()
  const cleaned = text.replace(/\r/g, ' ')

  for (const match of cleaned.matchAll(/[「“《]([\u4e00-\u9fa5A-Za-z0-9\-]{2,12})[」”》]/g)) {
    candidates.set(match[1], (candidates.get(match[1]) ?? 0) + 3)
  }
  for (const match of cleaned.matchAll(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9\-]{1,11})(?:是指|指的是|是一种|是一个|称为|叫做|简称)/g)) {
    candidates.set(match[1], (candidates.get(match[1]) ?? 0) + 4)
  }
  for (const token of cleaned.match(/[A-Za-z][A-Za-z0-9\-]{1,12}/g) ?? []) {
    candidates.set(token, (candidates.get(token) ?? 0) + 2)
  }
  for (let size = 2; size <= 6; size += 1) {
    for (let i = 0; i + size <= cleaned.length; i += 1) {
      const gram = cleaned.slice(i, i + size)
      if (!/^[\u4e00-\u9fa5]+$/.test(gram)) continue
      if (STOPWORDS.has(gram)) continue
      candidates.set(gram, (candidates.get(gram) ?? 0) + 1)
    }
  }

  const ranked = [...candidates.entries()]
    .filter(([term, count]) => term.length >= 2 && count >= 2 && !STOPWORDS.has(term))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)

  const picked: string[] = []
  for (const [term] of ranked) {
    if (picked.some((item) => item.includes(term) || term.includes(item))) continue
    picked.push(term)
    if (picked.length >= limit) break
  }
  return picked
}

export function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function blankOut(text: string, term: string): string | null {
  if (!text.includes(term)) return null
  return text.replace(term, '____')
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
