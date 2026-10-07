import type { EntryRow } from '@/data/types'
import {
  TRAINING_CANCELLED_STATUS,
  TRAINING_FIELDS,
  TRAINING_FINAL_STATUS,
  TRAINING_SCHEMA_VERSION,
} from './shared'

// v2 培训记录模板：按培训编号索引。
// 两个用途：
//  1. 老 v1 记录升级时，按当时的培训编号把后来新增的字段（培训主题、考核结果等）补齐；
//  2. 老存储里缺失的历史场次，照这份回填补齐（标 _backfilled）。
// 模板里的计划日期统一落在当前演示月份，方便「本月培训场次」演示。
export const TRAINING_TEMPLATES: EntryRow[] = [
  {
    id: 1,
    status: '待组织',
    pending: true,
    abnormal: false,
    培训编号: 'TRAI-0001',
    培训主题: '新员工入职三级安全教育',
    培训对象: '新入职员工',
    培训讲师: '安全员 王磊',
    计划日期: '2026-10-08',
    培训时长: '4课时',
    考核结果: '未考核',
    培训状态: '待组织',
    __schemaVersion: TRAINING_SCHEMA_VERSION,
  },
  {
    id: 2,
    status: '培训中',
    pending: true,
    abnormal: false,
    培训编号: 'TRAI-0002',
    培训主题: '有限空间作业安全培训',
    培训对象: '渗滤液车间运行人员',
    培训讲师: '安全员 王磊',
    计划日期: '2026-10-09',
    培训时长: '2课时',
    考核结果: '未考核',
    培训状态: '培训中',
    __schemaVersion: TRAINING_SCHEMA_VERSION,
  },
  {
    id: 3,
    status: '已考核',
    pending: false,
    abnormal: false,
    培训编号: 'TRAI-0003',
    培训主题: '安全生产规章制度培训',
    培训对象: '全体运行人员',
    培训讲师: '安全总监 李建国',
    计划日期: '2026-10-10',
    培训时长: '3课时',
    考核结果: '优秀',
    培训状态: '已考核',
    __schemaVersion: TRAINING_SCHEMA_VERSION,
  },
  {
    id: 4,
    status: '已考核',
    pending: false,
    abnormal: true,
    培训编号: 'TRAI-0004',
    培训主题: '岗位安全操作规范（补考）',
    培训对象: '焚烧炉车间班组',
    培训讲师: '安全员 赵敏',
    计划日期: '2026-10-12',
    培训时长: '2课时',
    考核结果: '不合格',
    培训状态: '已考核',
    __schemaVersion: TRAINING_SCHEMA_VERSION,
  },
  {
    id: 5,
    status: '已取消',
    pending: false,
    abnormal: false,
    培训编号: 'TRAI-0005',
    培训主题: '应急处置演练（已取消）',
    培训对象: '应急救援小组',
    培训讲师: '安全总监 李建国',
    计划日期: '2026-10-15',
    培训时长: '2课时',
    考核结果: '未考核',
    培训状态: '已取消',
    __schemaVersion: TRAINING_SCHEMA_VERSION,
  },
]

// 校验：模板字段顺序与模块字段一致，状态合法。
TRAINING_TEMPLATES.forEach((row) => {
  for (const field of TRAINING_FIELDS) {
    if (row[field] === undefined) {
      throw new Error(`培训模板 ${row['培训编号']} 缺字段 ${field}`)
    }
  }
  if (!['待组织', '培训中', TRAINING_FINAL_STATUS, TRAINING_CANCELLED_STATUS].includes(String(row.status))) {
    throw new Error(`培训模板 ${row['培训编号']} 状态非法`)
  }
})

export const TRAINING_TEMPLATE_BY_NO: Map<string, EntryRow> = new Map(
  TRAINING_TEMPLATES.map((row) => [String(row['培训编号']), row]),
)
