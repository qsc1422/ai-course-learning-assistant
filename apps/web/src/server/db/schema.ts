export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS courses (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  code text,
  teacher text,
  semester text,
  exam_date date,
  next_class_at timestamptz,
  room text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS class_slots (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday integer NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  week_range text,
  room text,
  confidence integer NOT NULL DEFAULT 90
);
CREATE INDEX IF NOT EXISTS class_slots_course_idx ON class_slots(course_id);

CREATE TABLE IF NOT EXISTS chapters (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  seq integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT '待整理',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chapters_course_idx ON chapters(course_id, seq);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id text REFERENCES chapters(id) ON DELETE SET NULL,
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  parse_status text NOT NULL DEFAULT '未解析',
  parse_note text,
  char_count integer NOT NULL DEFAULT 0,
  page_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_course_idx ON files(course_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS files_course_sha_idx ON files(course_id, sha256);

CREATE TABLE IF NOT EXISTS chunks (
  id text PRIMARY KEY,
  file_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chapter_id text REFERENCES chapters(id) ON DELETE SET NULL,
  page_no integer NOT NULL DEFAULT 1,
  seq integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  source_type text NOT NULL DEFAULT 'text',
  ocr_conf real,
  embedding vector(1024),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chunks_file_idx ON chunks(file_id, seq);
CREATE INDEX IF NOT EXISTS chunks_chapter_idx ON chunks(chapter_id);

CREATE TABLE IF NOT EXISTS ai_drafts (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id text REFERENCES chapters(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  original_payload jsonb,
  status text NOT NULL DEFAULT 'draft',
  source_refs jsonb,
  prompt_version text,
  model text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_drafts_chapter_idx ON ai_drafts(chapter_id, status);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  draft_id text,
  name text NOT NULL,
  summary text NOT NULL,
  importance text NOT NULL,
  source_refs jsonb NOT NULL,
  status text NOT NULL DEFAULT 'adopted',
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kp_chapter_idx ON knowledge_points(chapter_id);

CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  kp_id text NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  draft_id text,
  type text NOT NULL,
  difficulty text NOT NULL,
  stem text NOT NULL,
  options jsonb,
  answer text NOT NULL,
  rubric jsonb,
  source_refs jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_kp_idx ON questions(kp_id, status);

CREATE TABLE IF NOT EXISTS attempts (
  id text PRIMARY KEY,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  kp_id text NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  answer text NOT NULL,
  result text NOT NULL,
  independence text NOT NULL,
  hint_levels integer NOT NULL DEFAULT 0,
  solution_shown boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_kp_idx ON attempts(kp_id, created_at);

CREATE TABLE IF NOT EXISTS hint_events (
  id text PRIMARY KEY,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  level integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hint_events_q_idx ON hint_events(question_id, level);

CREATE TABLE IF NOT EXISTS solution_events (
  id text PRIMARY KEY,
  question_id text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solution_events_q_idx ON solution_events(question_id);

CREATE TABLE IF NOT EXISTS narrations (
  id text PRIMARY KEY,
  kp_id text NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  text text NOT NULL,
  status text NOT NULL,
  covered jsonb,
  missing jsonb,
  wrong jsonb,
  followups jsonb,
  disagreed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS narrations_kp_idx ON narrations(kp_id, created_at);

CREATE TABLE IF NOT EXISTS mistakes (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kp_id text NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  wrong_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT '未通过',
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mistakes_kp_idx ON mistakes(kp_id);

CREATE TABLE IF NOT EXISTS preferences (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  target_id text,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preferences_course_idx ON preferences(course_id, active);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  error text,
  result jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idem_idx ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS mastery_snapshots (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  score real,
  band text NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  snap_date date NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mastery_snap_uniq ON mastery_snapshots(chapter_id, snap_date);

CREATE TABLE IF NOT EXISTS activity_log (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  actor text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_course_idx ON activity_log(course_id, created_at);

CREATE TABLE IF NOT EXISTS daily_tasks (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  task_date date NOT NULL,
  kp_id text REFERENCES knowledge_points(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  note text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_tasks_uniq ON daily_tasks(course_id, task_date, kp_id);
CREATE INDEX IF NOT EXISTS daily_tasks_date_idx ON daily_tasks(task_date, course_id);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
`
