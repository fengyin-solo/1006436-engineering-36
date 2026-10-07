import type { EntryRow } from '@/data/types'

// 安全培训模块的数据形状与迁移规则都集中在这里，local-store 与页面共用。

export const TRAINING_KEY = 'training'

// 当前培训记录的结构版本：老存储里没有培训主题、考核结果这些字段，属于 v1。
export const TRAINING_SCHEMA_VERSION = 2

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
export const TRAINING_FINAL_STATUS = '已考核'
export const TRAINING_CANCELLED_STATUS = '已取消'

// 各字段缺值时的兜底默认值：老记录补形状照这份填。
export const TRAINING_DEFAULTS: Record<string, string> = {
  培训编号: '',
  培训主题: '未登记培训主题',
  培训对象: '全员',
  培训讲师: '安全员',
  计划日期: '',
  培训时长: '2课时',
  考核结果: '未考核',
  培训状态: '待组织',
}

// 老示例数据（v1 播种）里写进去的占位文字：这些不算正式值，升级时按模板覆盖。
const PLACEHOLDER_PREFIX = '安全培训管理样例'

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

export function isPlaceholderValue(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PLACEHOLDER_PREFIX)
}

// 已考核的场次，考核结果必须落在这个集合里；其余状态一律是「未考核」。
export const TRAINING_PASS_RESULTS = ['合格', '优秀']
export const TRAINING_FAIL_RESULTS = ['不合格', '补考合格']
export const TRAINING_ASSESSED_RESULTS = [
  ...TRAINING_PASS_RESULTS,
  ...TRAINING_FAIL_RESULTS,
]
export const TRAINING_UNASSESSED_RESULT = '未考核'

export function trainingId(row: EntryRow): string {
  return String(row['培训编号'] ?? '').trim()
}

export function isAssessed(row: EntryRow): boolean {
  return String(row.status) === TRAINING_FINAL_STATUS
}

// 状态决定考核结果：已考核要有合格/不合格类结论，其它状态必须是「未考核」。
export function expectedExamResult(row: EntryRow): string {
  const current = String(row['考核结果'] ?? '').trim()
  if (isAssessed(row)) {
    return TRAINING_ASSESSED_RESULTS.includes(current) ? current : '合格'
  }
  return TRAINING_UNASSESSED_RESULT
}

// 培训主题和考核结果要能对上：已考核记录缺主题时给一个与考核相符的主题。
export function fallbackTopic(row: EntryRow): string {
  if (isAssessed(row)) {
    const result = expectedExamResult(row)
    return result === '不合格' ? '岗位安全操作规范（补考）' : '安全生产规章制度培训'
  }
  if (String(row.status) === TRAINING_CANCELLED_STATUS) {
    return '应急处置演练（已取消）'
  }
  return TRAINING_DEFAULTS['培训主题']
}

export function trainingPending(row: EntryRow): boolean {
  return String(row.status) !== TRAINING_FINAL_STATUS && String(row.status) !== TRAINING_CANCELLED_STATUS
}
