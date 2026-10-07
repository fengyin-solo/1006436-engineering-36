import type { EntryRow } from '@/data/types'
import {
  TRAINING_DEFAULTS,
  TRAINING_FAIL_RESULTS,
  TRAINING_FIELDS,
  TRAINING_SCHEMA_VERSION,
  TRAINING_STATUSES,
  expectedExamResult,
  fallbackTopic,
  isBlank,
  isPlaceholderValue,
  trainingId,
  trainingPending,
} from './shared'
import { TRAINING_TEMPLATES, TRAINING_TEMPLATE_BY_NO } from './templates'

// v1 -> v2 培训存储结构升级。
// 设计目标：
//  - 老记录按当时的培训编号补齐后来新增的字段，缺的地方填默认值；
//  - 每条升级过的记录打 _upgraded 记号，回填的缺失历史打 _backfilled 记号；
//  - 取不到（存储里压根没有）的历史培训记录按模板回填；
//  - 培训编号重报只落一条（同编号合并，缺字段互补）；
//  - 同一份老数据重复跑结果不变：已是 v2 的记录只做一致性校正，不再打记号、不再回填；
//  - 考核结果与培训状态/培训主题始终对得上。

export const MARK_UPGRADED = '_upgraded'
export const MARK_BACKFILLED = '_backfilled'
export const MARK_MERGED = '_mergedFrom'

export type TrainingMigrationReport = {
  fromVersion: number
  toVersion: number
  upgraded: number
  backfilled: number
  mergedDuplicates: number
  corrected: number
  finalCount: number
  ranAt: string
}

type StampedRow = EntryRow & {
  __schemaVersion?: number
  [MARK_UPGRADED]?: string
  [MARK_BACKFILLED]?: string
  [MARK_MERGED]?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isValidStatus(value: unknown): boolean {
  return (TRAINING_STATUSES as readonly string[]).includes(String(value))
}

function stamp(now: string): string {
  return new Date(now).toISOString()
}

// 没有培训编号的老记录给一个稳定的兜底编号，避免被去重逻辑误并到一起。
function fallbackNo(row: StampedRow): string {
  const id = isValidId(Number(row.id)) ? Number(row.id) : 0
  return `TRAI-OLD-${String(id).padStart(4, '0')}`
}

// 已是 v2 形状的记录：只做口径校正（状态↔考核结果↔主题↔培训状态），不动升级记号。
export function reconcileV2Row(raw: EntryRow): { row: StampedRow; corrected: boolean } {
  const row: StampedRow = { ...raw }
  let corrected = false

  if (!isValidStatus(row.status)) {
    row.status = TRAINING_DEFAULTS['培训状态']
    corrected = true
  }

  const exam = expectedExamResult(row)
  if (String(row['考核结果'] ?? '').trim() !== exam) {
    row['考核结果'] = exam
    corrected = true
  }

  if (isBlank(row['培训主题']) || isPlaceholderValue(row['培训主题'])) {
    row['培训主题'] = fallbackTopic(row)
    corrected = true
  }

  if (String(row['培训状态'] ?? '') !== String(row.status)) {
    row['培训状态'] = String(row.status)
    corrected = true
  }

  for (const field of TRAINING_FIELDS) {
    if (field === '培训状态' || field === '考核结果' || field === '培训主题') {
      continue
    }
    if (isBlank(row[field]) || isPlaceholderValue(row[field])) {
      row[field] = TRAINING_DEFAULTS[field] ?? ''
      corrected = true
    }
  }

  const pending = trainingPending(row)
  if (row.pending !== pending) {
    row.pending = pending
    corrected = true
  }
  const abnormal = TRAINING_FAIL_RESULTS.includes(String(row['考核结果']))
  if (row.abnormal !== abnormal) {
    row.abnormal = abnormal
    corrected = true
  }

  row.__schemaVersion = TRAINING_SCHEMA_VERSION
  return { row, corrected }
}

// v1 老记录：照当时的字段 + 同编号模板 + 默认值，补成 v2 形状并打升级记号。
function upgradeV1Row(raw: EntryRow, now: string): StampedRow {
  const no = trainingId(raw) || fallbackNo(raw as StampedRow)
  const template = TRAINING_TEMPLATE_BY_NO.get(no)
  const source: StampedRow = { ...raw }
  const row = {} as StampedRow

  row.id = isValidId(Number(source.id))
    ? Number(source.id)
    : template?.id ?? 0 // 0 会在最后的统一编号阶段重新分配

  row.status = isValidStatus(source.status)
    ? String(source.status)
    : template && isValidStatus(template.status)
      ? String(template.status)
      : TRAINING_DEFAULTS['培训状态']

  for (const field of TRAINING_FIELDS) {
    const original = source[field]
    if (!isBlank(original) && !isPlaceholderValue(original)) {
      row[field] = String(original)
    } else if (template && !isBlank(template[field])) {
      row[field] = String(template[field])
    } else {
      row[field] = TRAINING_DEFAULTS[field] ?? ''
    }
  }

  if (isBlank(row['培训编号'])) {
    row['培训编号'] = template ? String(template['培训编号']) : no
  }

  // 状态是主口径：考核结果、培训状态、主题都向它看齐。
  row['考核结果'] = expectedExamResult(row)
  row['培训状态'] = String(row.status)
  if (isBlank(row['培训主题']) || isPlaceholderValue(row['培训主题'])) {
    row['培训主题'] = template && !isBlank(template['培训主题'])
      ? String(template['培训主题'])
      : fallbackTopic(row)
  }

  row.pending = trainingPending(row)
  row.abnormal = TRAINING_FAIL_RESULTS.includes(String(row['考核结果']))
  row.__schemaVersion = TRAINING_SCHEMA_VERSION
  row[MARK_UPGRADED] = stamp(now)

  // 老记录上其余未识别字段原样保留，不丢历史信息。
  for (const [key, value] of Object.entries(source)) {
    if (key in row || key === 'id' || key === 'status' || key === 'pending' || key === 'abnormal') {
      continue
    }
    row[key] = value
  }
  return row
}

// 培训编号重报只落一条：同编号保留首条，后来记录上的缺字段补进来，多余的记在 _mergedFrom。
function mergeByTrainingNo(rows: StampedRow[]): { rows: StampedRow[]; merged: number } {
  const firstByNo = new Map<string, StampedRow>()
  const result: StampedRow[] = []
  let merged = 0

  for (const raw of rows) {
    const no = trainingId(raw) || fallbackNo(raw)
    raw['培训编号'] = no
    const keeper = firstByNo.get(no)
    if (!keeper) {
      firstByNo.set(no, raw)
      result.push(raw)
      continue
    }
    for (const [key, value] of Object.entries(raw)) {
      if (isBlank(keeper[key]) && !isBlank(value)) {
        keeper[key] = value
      }
    }
    merged += 1
    const existing = String(keeper[MARK_MERGED] ?? '')
    keeper[MARK_MERGED] = [existing, String(raw.id)].filter(Boolean).join(',')
  }
  return { rows: result, merged }
}

// 统一 id：自带的合法 id 原样保留（重号时后出现者顺延），无 id / 回填的从 1 起取最小空号。
function assignUniqueIds(rows: StampedRow[]): StampedRow[] {
  const used = new Set<number>()
  const nextFree = (start: number): number => {
    let id = start
    while (used.has(id)) {
      id += 1
    }
    return id
  }
  let floor = 1
  return rows.map((raw) => {
    const id = Number(raw.id)
    if (isValidId(id) && !used.has(id)) {
      used.add(id)
      return raw
    }
    const assigned = nextFree(Math.max(floor, isValidId(id) && used.has(id) ? id : 1))
    used.add(assigned)
    floor = assigned + 1
    return { ...raw, id: assigned }
  })
}

export function isV2TrainingRow(row: unknown): boolean {
  return Boolean(
    row && typeof row === 'object' && (row as StampedRow).__schemaVersion === TRAINING_SCHEMA_VERSION,
  )
}

// 迁移入口。纯函数：输入老存储里的培训数组，输出 v2 数组和升级报告。
// 同一份老数据重复调用，除首次外各项升级计数都是 0、数组内容不再变化。
export function migrateTrainingV1(
  input: unknown,
  now: string = new Date().toISOString(),
): { rows: EntryRow[]; report: TrainingMigrationReport; migrated: boolean } {
  const rawRows = Array.isArray(input)
    ? (input as unknown[]).filter((item): item is EntryRow => Boolean(item) && typeof item === 'object')
    : []

  const stampedRows: StampedRow[] = rawRows.map((item) => clone(item) as StampedRow)
  const containsV1 = stampedRows.some((row) => !isV2TrainingRow(row))

  // 已经全部是 v2：只校正口径，绝不重新打记号、绝不重新回填、绝不重新合并。
  if (!containsV1) {
    let corrected = 0
    const rows = stampedRows.map((row) => {
      const result = reconcileV2Row(row)
      if (result.corrected) {
        corrected += 1
      }
      return result.row
    })
    return {
      rows,
      migrated: false,
      report: {
        fromVersion: TRAINING_SCHEMA_VERSION,
        toVersion: TRAINING_SCHEMA_VERSION,
        upgraded: 0,
        backfilled: 0,
        mergedDuplicates: 0,
        corrected,
        finalCount: rows.length,
        ranAt: stamp(now),
      },
    }
  }

  const { rows: dedupedRaw, merged } = mergeByTrainingNo(stampedRows)

  const upgraded: StampedRow[] = []
  let upgradedCount = 0
  for (const row of dedupedRaw) {
    if (isV2TrainingRow(row)) {
      upgraded.push(reconcileV2Row(row).row)
    } else {
      upgraded.push(upgradeV1Row(row, now))
      upgradedCount += 1
    }
  }

  // 取不到的历史培训记录：模板里有、存储里没有的场次，回填补齐。
  const ordered: StampedRow[] = []
  let backfilledCount = 0
  for (const template of TRAINING_TEMPLATES) {
    const no = String(template['培训编号'])
    const found = upgraded.find((row) => trainingId(row) === no)
    if (found) {
      ordered.push(found)
    } else {
      const filled: StampedRow = {
        ...clone(template),
        id: 0,
        [MARK_BACKFILLED]: stamp(now),
      }
      ordered.push(filled)
      backfilledCount += 1
    }
  }
  // 不在模板里的正式记录（编号不是 TRAI-000x）排在后面，按原 id 稳定排序。
  const extras = upgraded
    .filter((row) => !TRAINING_TEMPLATE_BY_NO.has(trainingId(row)))
    .sort((a, b) => Number(a.id) - Number(b.id))
  ordered.push(...extras)

  const finalRows = assignUniqueIds(ordered)

  let corrected = 0
  for (const row of finalRows) {
    const result = reconcileV2Row(row)
    if (result.corrected) {
      corrected += 1
    }
    Object.assign(row, result.row)
  }

  return {
    rows: finalRows,
    migrated: true,
    report: {
      fromVersion: 1,
      toVersion: TRAINING_SCHEMA_VERSION,
      upgraded: upgradedCount,
      backfilled: backfilledCount,
      mergedDuplicates: merged,
      corrected,
      finalCount: finalRows.length,
      ranAt: stamp(now),
    },
  }
}
