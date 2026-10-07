import { SEED_ROWS } from './seed'
import { MARK_BACKFILLED, MARK_UPGRADED, migrateTrainingV1 } from './training/migrate'
import { TRAINING_KEY, TRAINING_SCHEMA_VERSION } from './training/shared'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
// 存储结构版本信封。v1 是最早那版：培训记录里没有培训主题、考核结果等字段。
const META_KEY = 'waste-to-energy-plant:meta'
const CURRENT_STORE_VERSION = 2

// 正式培训记录升级前，先在这个键下抄一份底，升级出问题还能翻回去。
const TRAINING_BACKUP_PREFIX = 'waste-to-energy-plant:training-backup:v'

type StoreMeta = {
  version: number
  migratedAt?: string
  lastTrainingMigration?: unknown
}

type StoreEnvelope = {
  version: number
  rows: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function seedData(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function readMeta(store: Storage): StoreMeta {
  try {
    const raw = store.getItem(META_KEY)
    if (!raw) {
      return { version: 1 }
    }
    const parsed = JSON.parse(raw) as Partial<StoreMeta>
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      migratedAt: parsed.migratedAt,
      lastTrainingMigration: parsed.lastTrainingMigration,
    }
  } catch {
    return { version: 1 }
  }
}

function writeMeta(store: Storage, meta: StoreMeta): void {
  store.setItem(META_KEY, JSON.stringify(meta))
}

// 升级覆盖前，把本地已有的正式培训记录原样抄一份（只在确实要迁移时抄，且只保留最近一份）。
function backupTraining(store: Storage, rows: EntryRow[], fromVersion: number, now: string): void {
  const key = `${TRAINING_BACKUP_PREFIX}${fromVersion}`
  const payload = {
    module: TRAINING_KEY,
    fromVersion,
    backedUpAt: new Date(now).toISOString(),
    rows: clone(rows),
  }
  store.setItem(key, JSON.stringify(payload))
}

function isEnvelope(value: unknown): value is StoreEnvelope {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as StoreEnvelope).version === 'number' &&
      (value as StoreEnvelope).rows &&
      typeof (value as StoreEnvelope).rows === 'object',
  )
}

type ParsedStore = {
  version: number
  rows: Record<string, EntryRow[]>
}

function parseRaw(raw: string): ParsedStore | null {
  const parsed: unknown = JSON.parse(raw)
  if (isEnvelope(parsed)) {
    return { version: parsed.version, rows: parsed.rows }
  }
  if (parsed && typeof parsed === 'object') {
    // v1：整个 value 直接就是 { 模块名: 行数组 }，没有版本信封。
    return { version: 1, rows: parsed as Record<string, EntryRow[]> }
  }
  return null
}

function persist(store: Storage | null, rows: Record<string, EntryRow[]>, version: number): void {
  cache = rows
  if (store) {
    const envelope: StoreEnvelope = { version, rows }
    store.setItem(STORAGE_KEY, JSON.stringify(envelope))
  }
}

// 读进来的存储统一过一遍版本升级：目前只有培训模块从 v1 升到 v2。
function upgrade(
  store: Storage,
  version: number,
  rows: Record<string, EntryRow[]>,
): { rows: Record<string, EntryRow[]>; version: number } {
  const fallback = seedData()
  const merged: Record<string, EntryRow[]> = { ...fallback, ...rows }

  if (version >= CURRENT_STORE_VERSION) {
    // 已经是最新版：仍然走一遍迁移函数，但只是做口径校正，不打记号、不回填。
    const { rows: trainingRows } = migrateTrainingV1(merged[TRAINING_KEY] ?? [])
    merged[TRAINING_KEY] = trainingRows
    return { rows: merged, version: CURRENT_STORE_VERSION }
  }

  const now = new Date().toISOString()
  const existingTraining = merged[TRAINING_KEY] ?? []
  const { rows: upgradedTraining, report, migrated } = migrateTrainingV1(existingTraining, now)

  if (migrated && existingTraining.length > 0) {
    backupTraining(store, existingTraining, version, now)
  }
  merged[TRAINING_KEY] = upgradedTraining

  if (store) {
    writeMeta(store, {
      version: CURRENT_STORE_VERSION,
      migratedAt: now,
      lastTrainingMigration: report,
    })
  }
  return { rows: merged, version: CURRENT_STORE_VERSION }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedData()
  const store = storage()
  if (!store) {
    return fallback
  }
  const raw = store.getItem(STORAGE_KEY)
  if (!raw) {
    persist(store, fallback, CURRENT_STORE_VERSION)
    writeMeta(store, { version: CURRENT_STORE_VERSION })
    return fallback
  }
  let parsed: ParsedStore
  try {
    const maybeParsed = parseRaw(raw)
    if (!maybeParsed) {
      persist(store, fallback, CURRENT_STORE_VERSION)
      writeMeta(store, { version: CURRENT_STORE_VERSION })
      return fallback
    }
    parsed = maybeParsed
  } catch {
    persist(store, fallback, CURRENT_STORE_VERSION)
    writeMeta(store, { version: CURRENT_STORE_VERSION })
    return fallback
  }

  const metaVersion = readMeta(store).version
  const { rows: upgraded, version } = upgrade(store, Math.max(parsed.version, metaVersion), parsed.rows)
  persist(store, upgraded, version)
  return upgraded
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const stampedRows = key === TRAINING_KEY
    ? rows.map((row) => ({ ...row, __schemaVersion: TRAINING_SCHEMA_VERSION }))
    : rows
  const next = { ...allRows(), [key]: stampedRows }
  persist(storage(), next, CURRENT_STORE_VERSION)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 培训升级记号透出给页面使用：详情里能看出这条记录是升级补齐还是历史回填来的。
export { MARK_BACKFILLED, MARK_UPGRADED }
