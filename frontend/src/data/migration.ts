import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import {
  ASSESSED_STATUS,
  CANCELED_STATUS,
  PENDING_GRADE,
  TRAINING_FIELDS,
  TRAINING_GRADES,
  TRAINING_MODULE_KEY,
  TRAINING_STATUSES,
} from './training'

// 存储结构版本：v1 是裸 { 模块key: 行数组 }，v2 加了版本包装并给培训记录补齐形状。
export const CURRENT_SCHEMA_VERSION = 2

// 行级记号：升到哪一版、是否由历史记录回填。
export const ROW_VERSION_FIELD = '__schemaVersion'
export const ROW_BACKFILLED_FIELD = '__backfilled'

export type VersionedStore = {
  version: number
  upgradedAt?: string
  entries: Record<string, EntryRow[]>
}

export type UpgradeReport = {
  upgraded: boolean
  upgradedRows: number
  backfilledRows: number
  removedDuplicates: number
}

export function isVersionedStore(value: unknown): value is VersionedStore {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { version?: unknown; entries?: unknown }
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.entries === 'object' &&
    candidate.entries !== null
  )
}

export function freshStore(now: Date = new Date()): VersionedStore {
  return { version: CURRENT_SCHEMA_VERSION, upgradedAt: now.toISOString(), entries: seedEntries() }
}

// 示例数据始终带上最新版本记号，迁移跑到它们身上是空操作。
export function seedEntries(): Record<string, EntryRow[]> {
  const entries: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(SEED_ROWS)) {
    entries[key] = rows.map((row) => stampCurrentVersion(row))
  }
  return entries
}

export function stampCurrentVersion<T extends EntryRow>(row: T): T {
  return { ...row, [ROW_VERSION_FIELD]: CURRENT_SCHEMA_VERSION }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

function codeOf(row: EntryRow): string {
  return normalizeCode(row['培训编号'])
}

function fallbackCode(id: number): string {
  return `TRAI-${String(id).padStart(4, '0')}`
}

// 考核结果归一成标准档位：老记录里怎么写的都收敛到「优秀/良好/合格/不合格/未考核」。
function normalizeGrade(raw: unknown, status: string): string {
  const value = String(raw ?? '').trim()
  if (value === '') {
    return status === ASSESSED_STATUS ? '合格' : PENDING_GRADE
  }
  const hit = TRAINING_GRADES.find((grade) => grade === value)
  if (hit) {
    return hit
  }
  if (value.includes('优秀')) {
    return '优秀'
  }
  if (value.includes('良好')) {
    return '良好'
  }
  if (value.includes('不合格') || value.includes('未通过')) {
    return '不合格'
  }
  if (value.includes('合格') || value.includes('通过')) {
    return '合格'
  }
  return status === ASSESSED_STATUS ? '合格' : PENDING_GRADE
}

function deriveStatus(row: EntryRow): string {
  const raw = String(row.status ?? '').trim()
  if ((TRAINING_STATUSES as readonly string[]).includes(raw)) {
    return raw
  }
  const state = String(row['培训状态'] ?? '').trim()
  if ((TRAINING_STATUSES as readonly string[]).includes(state)) {
    return state
  }
  return '待组织'
}

function textOr(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim()
  return value === '' ? fallback : value
}

// 把任意形状的老培训记录补成 v2 的完整形状；已经是新版的行原样返回。
export function upgradeTrainingRow(rawRow: unknown, nextId: () => number): EntryRow {
  if (typeof rawRow !== 'object' || rawRow === null) {
    const invalidId = nextId()
    return stampCurrentVersion({
      id: invalidId,
      status: '待组织',
      pending: true,
      abnormal: false,
      培训编号: fallbackCode(invalidId),
      培训主题: '未登记培训主题',
      培训对象: '未登记培训对象',
      培训讲师: '未安排讲师',
      计划日期: '',
      培训时长: '2学时',
      考核结果: PENDING_GRADE,
      培训状态: '待组织',
    })
  }
  const source = rawRow as EntryRow
  if (Number(source[ROW_VERSION_FIELD]) >= CURRENT_SCHEMA_VERSION) {
    return clone(source)
  }

  const numericId = Number(source.id)
  const id = Number.isFinite(numericId) && numericId > 0 ? Math.trunc(numericId) : nextId()
  const status = deriveStatus(source)
  const grade = normalizeGrade(source['考核结果'], status)

  const upgraded: EntryRow = {
    ...clone(source),
    id,
    status,
    pending: status !== ASSESSED_STATUS && status !== CANCELED_STATUS,
    abnormal: status === CANCELED_STATUS,
    培训编号: textOr(source['培训编号'], fallbackCode(id)),
    培训主题: textOr(source['培训主题'], '未登记培训主题'),
    培训对象: textOr(source['培训对象'], '未登记培训对象'),
    培训讲师: textOr(source['培训讲师'], '未安排讲师'),
    计划日期: textOr(source['计划日期'], ''),
    培训时长: textOr(source['培训时长'], '2学时'),
    考核结果: grade,
    培训状态: status,
  }
  upgraded[ROW_VERSION_FIELD] = CURRENT_SCHEMA_VERSION
  return upgraded
}

// 示例里的正式培训记录：老库里对不上编号的场次按这份回填。
// templateKey 指向示例模板，primaryKey 是分配给当前库的新主键（业务编号保持示例原值）。
function buildBackfilledRow(templateKey: number, primaryKey: number): EntryRow {
  const template = (SEED_ROWS[TRAINING_MODULE_KEY] ?? []).find((row) => Number(row.id) === templateKey)
  if (!template) {
    return stampCurrentVersion({
      id: primaryKey,
      status: '待组织',
      pending: true,
      abnormal: false,
      培训编号: fallbackCode(primaryKey),
      培训主题: '未登记培训主题',
      培训对象: '未登记培训对象',
      培训讲师: '未安排讲师',
      计划日期: '',
      培训时长: '2学时',
      考核结果: PENDING_GRADE,
      培训状态: '待组织',
    })
  }
  const row = stampCurrentVersion(clone(template))
  row.id = primaryKey
  row[ROW_BACKFILLED_FIELD] = true
  return row
}

// 回填老库里取不到的历史培训记录：培训编号是业务身份，缺哪个编号补哪条；
// 回填行的数字主键重新分配，避免和老记录撞 id 导致动作指错行。
function backfillMissingTrainings(rows: EntryRow[], nextId: () => number): {
  rows: EntryRow[]
  count: number
} {
  const haveCodes = new Set(rows.map(codeOf))
  const result = [...rows]
  let count = 0
  for (const seedRow of SEED_ROWS[TRAINING_MODULE_KEY] ?? []) {
    const code = codeOf(seedRow)
    if (haveCodes.has(code)) {
      continue
    }
    const backfilled = buildBackfilledRow(Number(seedRow.id), nextId())
    result.push(backfilled)
    haveCodes.add(code)
    count += 1
  }
  return { rows: result, count }
}

// 培训编号重报只落一条：同编号合并，正式记录优先于回填占位，字段互相补齐。
export function dedupeTrainingRows(rows: EntryRow[]): {
  rows: EntryRow[]
  removed: number
} {
  const byCode = new Map<string, EntryRow[]>()
  const noCode: EntryRow[] = []
  for (const row of rows) {
    const code = codeOf(row)
    if (!code) {
      noCode.push(row)
      continue
    }
    const group = byCode.get(code)
    if (group) {
      group.push(row)
    } else {
      byCode.set(code, [row])
    }
  }

  const merged: EntryRow[] = []
  let removed = 0
  for (const [code, group] of byCode.entries()) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }
    removed += group.length - 1
    // 主记录挑选：工作流上走得越远越优先（已考核 > 培训中 > 待组织），其次正式记录优先
    // 于回填占位，最后取最早主键；其余记录只用来补主记录缺的字段。
    const statusRank = (row: EntryRow) => {
      const index = TRAINING_STATUSES.indexOf(row.status as (typeof TRAINING_STATUSES)[number])
      return index < 0 ? 0 : index
    }
    const ordered = [...group].sort((a, b) => {
      const rankDiff = statusRank(b) - statusRank(a)
      if (rankDiff !== 0) {
        return rankDiff
      }
      const backfillDiff =
        Number(Boolean(a[ROW_BACKFILLED_FIELD])) - Number(Boolean(b[ROW_BACKFILLED_FIELD]))
      if (backfillDiff !== 0) {
        return backfillDiff
      }
      return Number(a.id) - Number(b.id)
    })
    const base: EntryRow = { ...ordered[0], 培训编号: code }
    for (const donor of ordered.slice(1)) {
      for (const field of TRAINING_FIELDS) {
        const current = String(base[field] ?? '').trim()
        const incoming = String(donor[field] ?? '').trim()
        if (
          (current === '' || current === '未登记培训主题') &&
          incoming !== '' &&
          incoming !== '未登记培训主题'
        ) {
          base[field] = donor[field]
        }
      }
      if (donor[ROW_VERSION_FIELD] && Number(base[ROW_VERSION_FIELD]) < Number(donor[ROW_VERSION_FIELD])) {
        base[ROW_VERSION_FIELD] = donor[ROW_VERSION_FIELD]
      }
    }
    delete base[ROW_BACKFILLED_FIELD]
    merged.push(base)
  }

  merged.push(...noCode)
  merged.sort((a, b) => Number(a.id) - Number(b.id))
  return { rows: merged, removed }
}

type RawStore = Record<string, unknown>

// v1（裸对象）一次性升级到 v2；已是 v2 的数据进来原样返回，保证重复导入只升一次。
export function upgradeStore(
  raw: unknown,
  now: Date = new Date(),
): { store: VersionedStore; report: UpgradeReport } {
  if (isVersionedStore(raw) && raw.version >= CURRENT_SCHEMA_VERSION) {
    return {
      store: { version: CURRENT_SCHEMA_VERSION, upgradedAt: raw.upgradedAt, entries: raw.entries },
      report: { upgraded: false, upgradedRows: 0, backfilledRows: 0, removedDuplicates: 0 },
    }
  }

  const rawStore: RawStore =
    typeof raw === 'object' && raw !== null && !isVersionedStore(raw)
      ? (raw as RawStore)
      : {}

  const trainingRows = (rawStore[TRAINING_MODULE_KEY] as EntryRow[] | undefined) ?? []
  let maxId = 0
  for (const row of trainingRows) {
    const id = Number((row as EntryRow)?.id)
    if (Number.isFinite(id) && id > maxId) {
      maxId = Math.trunc(id)
    }
  }
  // 主键分配：缺 id 的老行从老库最大 id 之后发；回填阶段再按现存 id 集合发，绝不重号。
  let issuedId = maxId
  const issueMissingId = () => {
    issuedId += 1
    return issuedId
  }
  const makeBackfillIdIssuer = (existing: EntryRow[]) => {
    const usedIds = new Set(existing.map((row) => Number(row.id)))
    let cursor = Math.max(maxId, ...existing.map((row) => Number(row.id) || 0))
    return () => {
      do {
        cursor += 1
      } while (usedIds.has(cursor))
      usedIds.add(cursor)
      return cursor
    }
  }

  const report: UpgradeReport = {
    upgraded: true,
    upgradedRows: 0,
    backfilledRows: 0,
    removedDuplicates: 0,
  }

  const entries: Record<string, EntryRow[]> = {}
  for (const [key, value] of Object.entries(rawStore)) {
    if (!Array.isArray(value)) {
      continue
    }
    if (key !== TRAINING_MODULE_KEY) {
      entries[key] = value.filter(
        (row): row is EntryRow => typeof row === 'object' && row !== null,
      )
      continue
    }

    // 先归一、再按编号去重，最后才回填缺号；否则重号老记录会挡住同号历史记录的回填。
    let rows = value.map((row) => upgradeTrainingRow(row, issueMissingId))
    report.upgradedRows = rows.length

    const deduped = dedupeTrainingRows(rows)
    rows = deduped.rows
    report.removedDuplicates = deduped.removed

    const backfilled = backfillMissingTrainings(rows, makeBackfillIdIssuer(rows))
    rows = backfilled.rows
    report.backfilledRows = backfilled.count

    entries[TRAINING_MODULE_KEY] = rows
  }

  if (!entries[TRAINING_MODULE_KEY]) {
    // 整份培训记录都取不到：示例培训记录全部按历史记录回填。
    const backfilled = backfillMissingTrainings([], makeBackfillIdIssuer([]))
    entries[TRAINING_MODULE_KEY] = backfilled.rows
    report.upgraded = true
    report.upgradedRows = 0
    report.backfilledRows = backfilled.count
  }

  return {
    store: { version: CURRENT_SCHEMA_VERSION, upgradedAt: now.toISOString(), entries },
    report,
  }
}
