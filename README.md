# 课伴 · 人机协同 AI 课程学习助手

把「上课听讲」到「第二天复习」之间的空白补上：导入课表建档，上传课程资料，AI 拆出知识点草稿由你确认，再按掌握度安排出题、提示、复述和次日计划。所有 AI 产出都经过人工确认，不做无人审核的自动决策。

## 功能

- **课表建档**：导入 XLSX / XLS / CSV，识别课程名称、星期、时段、周次、教室；可手动建课；冲突支持合并或覆盖
- **资料导入**：PDF / DOCX / PPTX / TXT / MD 上传或直接粘贴文字；异步解析、切片、向量化；每个知识点可回查原文页码
- **知识点草稿**：按资料强调方式和篇幅提取，分必背 / 理解 / 了解三档；支持采纳、修改、驳回、找回，整章批量确认
- **练习**：选择、填空、简答三类题；三级提示阶梯，看完整解答前必须先通过提示；独立作答与提示后作答分别记录
- **复述评判**：用自己的话讲一遍，判定「已讲清 / 有缺口 / 偏离」，给出缺口并追问
- **错题与掌握度**：错题按知识点归因；掌握度按重要度加权，分稳固 / 一般 / 薄弱，样本不足时不下结论
- **次日计划与复盘**：按掌握度、未通过错题、依赖关系、距上次练习天数、上课章节排期；每日容量上限；14 天趋势
- **协同轨迹**：记录 AI 做了什么、你确认/驳回了什么，可按课程撤销偏好

## 技术栈

- Next.js 15 App Router + React 19 + TypeScript（strict）
- PGlite 嵌入式 PostgreSQL（含 pgvector）；配置 `DATABASE_URL` 可切真实 Postgres
- 任务队列：Postgres `jobs` 表 + `FOR UPDATE SKIP LOCKED`，进程内 runner 轮询执行
- AI：OpenAI 兼容接口 + Zod 校验；无 Key 时自动使用本地规则引擎，界面明确标注
- 文件存储：本地私有目录 + HMAC 短时签名链接，不产生公开直链

## 快速开始

要求 Node.js >= 18.19。

```bash
npm install
npm run dev
```

打开 http://localhost:3000 。首次启动是空库，从「课表」导入或「手动新建课程」开始。

生产模式：

```bash
npm run build
npm start
```

## 配置

复制 `.env.example` 为 `.env.local`，按需填写（全部可选）：

| 变量 | 作用 | 不填时 |
| --- | --- | --- |
| `DATABASE_URL` | 真实 PostgreSQL 连接串（需支持 pgvector） | 使用嵌入式 PGlite |
| `PGLITE_DATA_DIR` | PGlite 数据目录 | `apps/web/.data/pg` |
| `STORAGE_DIR` | 上传文件目录 | `apps/web/.data/storage` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容大模型 | 本地规则引擎兜底 |
| `OLLAMA_URL` / `EMBEDDING_MODEL` | Ollama 向量化（如 bge-m3） | 本地确定性向量 |

## 数据存储

默认全部落在 `apps/web/.data/`（数据库 + 上传文件），已在 `.gitignore` 中，仓库不含任何演示数据。换机器时整个目录拷走即可。

## 目录结构

```
apps/web/src/app/            页面与 /api 路由
apps/web/src/components/     AppShell、练习、课表、课程工作区等客户端组件
apps/web/src/server/
  db/                        连接、schema（15 张表）
  services/                  课程、资料、知识点、练习、复盘、计划
  jobs/                      队列、runner、任务处理
  pipeline/                  解析、切片、向量化
  ai/                        模型接入、本地规则引擎、提示词与校验
  rules/                     掌握度与排期（纯函数，含单测）
产品需求文档.md / 技术方案.md / 产品原型.html
```

## 测试与检查

```bash
npm test                      # 掌握度与排期规则单测
npx tsc --noEmit -p apps/web/tsconfig.json
npm run build
```

## 与《技术方案》的差异

受本机环境限制（无 Docker / Python Worker / MinIO），做了等价替代，接口与数据模型保持一致：

1. Python Worker → 进程内 Node 任务 runner（仍是异步队列 + 状态轮询）
2. MinIO → 本地私有存储 + HMAC 5 分钟签名 URL
3. 未启用图片 OCR：图片上传会明确失败并提示补充文字版，不伪造识别结果
4. 课表仅支持 XLSX / XLS / CSV，不做截图或 PDF 视觉识别
5. 未提供 docker-compose；需要真实 Postgres 时通过 `DATABASE_URL` 接入

## 版本

- `v1.0` 初版：完整功能闭环
- `v1.1` 配色定稿：外壳与统计卡片上色，课表说明改为用户视角
