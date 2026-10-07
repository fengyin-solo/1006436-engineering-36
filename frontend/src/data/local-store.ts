import {
  CURRENT_SCHEMA_VERSION,
  ROW_VERSION_FIELD,
  dedupeTrainingRows,
  freshStore,
  isVersionedStore,
  seedEntries,
  stampCurrentVersion,
  upgradeStore,
  type VersionedStore,
} from './migration'
import { TRAINING_MODULE_KEY } from './training'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
// 元信息（当前版本、升级时间等），数据本体在 STORAGE_KEY。
const META_KEY = 'waste-to-energy-plant:meta'
// 升级前对正式培训记录抄的底：只抄第一次，之后不再覆盖。
const TRAINING_BACKUP_KEY = 'waste-to-energy-plant:training-backup:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function persist(store: VersionedStore): void {
  if (!hasStorage()) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  window.localStorage.setItem(
    META_KEY,
    JSON.stringify({ version: store.version, upgradedAt: store.upgradedAt }),
  )
}

// 升级前先把本地已有的正式培训记录抄一份底，只抄一次，绝不覆盖已有底稿。
function backupTrainings(raw: unknown): void {
  if (!hasStorage() || window.localStorage.getItem(TRAINING_BACKUP_KEY)) {
    return
  }
  if (typeof raw !== 'object' || raw === null) {
    return
  }
  const rows = (raw as Record<string, unknown>)[TRAINING_MODULE_KEY]
  if (!Array.isArray(rows) || rows.length === 0) {
    return
  }
  const snapshot = {
    key: TRAINING_MODULE_KEY,
    schemaVersion: 1,
    backedUpAt: new Date().toISOString(),
    rows: clone(rows),
  }
  window.localStorage.setItem(TRAINING_BACKUP_KEY, JSON.stringify(snapshot))
}

function readStorage(): VersionedStore {
  if (!hasStorage()) {
    return freshStore()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = freshStore()
    persist(seeded)
    return seeded
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const seeded = freshStore()
    persist(seeded)
    return seeded
  }

  // v2：已是新形状，不再做任何升级或改写（同一份数据重复导入只升一次）。
  if (isVersionedStore(parsed) && parsed.version >= CURRENT_SCHEMA_VERSION) {
    return {
      version: CURRENT_SCHEMA_VERSION,
      upgradedAt: parsed.upgradedAt,
      entries: parsed.entries,
    }
  }

  // v1：先抄底，再按当时字段补形状、回填缺失记录、编号去重，最后整体覆盖成 v2。
  backupTrainings(parsed)
  const { store, report } = upgradeStore(parsed)
  persist(store)
  if (report.upgraded) {
    // 本地开发环境留个痕迹，方便确认升级跑过、回填/去重了多少条。
    console.info(
      `[training] 本地存储已升级到 v${CURRENT_SCHEMA_VERSION}：补齐 ${report.upgradedRows} 条，` +
        `回填 ${report.backfilledRows} 条，编号去重 ${report.removedDuplicates} 条`,
    )
  }
  return store
}

let cache: VersionedStore | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache.entries
}

export function listRows(key: string): EntryRow[] {
  // v2 数据里若没有这个模块（比如老库之后新增的模块），懒补一份示例，不改落库结构。
  if (!(key in allRows())) {
    return seedEntries()[key] ?? []
  }
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): EntryRow[] {
  // 新写入的行打上当前版本记号；培训记录落库前按编号归并，重报只落一条。
  let nextRows = rows.map((row) =>
    Number(row[ROW_VERSION_FIELD]) >= CURRENT_SCHEMA_VERSION
      ? row
      : stampCurrentVersion(row),
  )
  if (key === TRAINING_MODULE_KEY) {
    nextRows = dedupeTrainingRows(nextRows).rows
  }
  const store = cache ?? readStorage()
  const next: VersionedStore = {
    version: CURRENT_SCHEMA_VERSION,
    upgradedAt: store.upgradedAt,
    entries: { ...store.entries, [key]: nextRows },
  }
  cache = next
  persist(next)
  return nextRows
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(seedEntries()[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

export type TrainingBackup = {
  key: string
  schemaVersion: number
  backedUpAt: string
  rows: EntryRow[]
}

export function readTrainingBackup(): TrainingBackup | null {
  if (!hasStorage()) {
    return null
  }
  const raw = window.localStorage.getItem(TRAINING_BACKUP_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as TrainingBackup
  } catch {
    return null
  }
}
