import type { EntryRow } from './types'

// 安全培训领域口径：迁移、页面统计、概览都从这里取，保证三边数字一致。
export const TRAINING_MODULE_KEY = 'training'

export const TRAINING_FIELDS = [
  '培训编号',
  '培训主题',
  '培训对象',
  '培训讲师',
  '计划日期',
  '培训时长',
  '考核结果',
  '培训状态',
] as const

export const TRAINING_STATUSES = ['待组织', '培训中', '已考核', '已取消'] as const

export const ASSESSED_STATUS = '已考核'
export const CANCELED_STATUS = '已取消'

// 考核结果的合法档位；还没走到考核环节的记录统一记「未考核」。
export const TRAINING_GRADES = ['优秀', '良好', '合格', '不合格'] as const
export const PENDING_GRADE = '未考核'

export function isAssessedTraining(row: EntryRow): boolean {
  return String(row.status) === ASSESSED_STATUS
}

export function assessedTrainingCount(rows: EntryRow[]): number {
  return rows.filter(isAssessedTraining).length
}

export function pendingOrganizeCount(rows: EntryRow[]): number {
  return rows.filter((row) => String(row.status) === '待组织').length
}

function currentMonth(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}`
}

// 本月培训场次：计划日期落在自然月内，已取消的不算场次。
export function monthTrainingCount(rows: EntryRow[], now: Date = new Date()): number {
  const prefix = currentMonth(now)
  return rows.filter((row) => {
    if (String(row.status) === CANCELED_STATUS) {
      return false
    }
    return String(row['计划日期'] ?? '').startsWith(prefix)
  }).length
}

export type TrainingStats = {
  pendingCount: number
  assessedCount: number
  monthCount: number
}

export function trainingStats(rows: EntryRow[], now: Date = new Date()): TrainingStats {
  return {
    pendingCount: pendingOrganizeCount(rows),
    assessedCount: assessedTrainingCount(rows),
    monthCount: monthTrainingCount(rows, now),
  }
}
