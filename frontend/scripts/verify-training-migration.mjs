/**
 * 本地开发用的存储升级验证脚本（不参与构建）：
 *   npx vite-node 不依赖额外安装，用 vite 的 SSR 加载能力直接执行。
 *   node scripts/verify-training-migration.mjs
 */
import { createServer } from 'vite'

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败：${message}`)
  }
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map),
  }
}

async function loadFresh(globalScope) {
  globalThis.window = globalScope
  globalThis.localStorage = globalScope.localStorage
  // 每个场景都要重新执行模块顶层（cache 是模块级变量）：失效整棵 SSR 模块图后重新加载。
  vite.moduleGraph.invalidateAll()
  return vite.ssrLoadModule('/src/data/local-store.ts')
}

let passed = 0
function ok(name) {
  passed += 1
  console.info(`  ✓ ${name}`)
}

// ---- 场景 1：v1 老记录（缺培训主题、考核结果）读进来补成新形状 ----
{
  console.info('[1] v1 老记录补形状 + 升级记号')
  const v1 = {
    weighbridge: [{ id: 1, status: '已复核', pending: false, abnormal: false }],
    training: [
      {
        id: 10,
        status: '培训中',
        pending: true,
        abnormal: false,
        培训编号: 'TRAI-9001',
        培训对象: '运行一班',
        计划日期: '2026-10-12',
      },
      {
        id: 11,
        status: '已考核',
        pending: false,
        abnormal: false,
        培训编号: 'TRAI-9002',
        培训主题: '消防安全演练',
        考核结果: '通过',
        计划日期: '2026-10-03',
      },
    ],
  }
  const storage = memoryStorage({ 'waste-to-energy-plant:entries': JSON.stringify(v1) })
  const store = await loadFresh({ localStorage: storage })
  const rows = store.listRows('training')

  assert(rows.length === 6, `应有 6 条（2 老 + 4 回填），实际 ${rows.length}`)
  const r10 = rows.find((r) => r.id === 10)
  assert(r10['培训主题'] === '未登记培训主题', '缺主题补默认值')
  assert(r10['考核结果'] === '未考核', '培训中考核结果归一成未考核')
  assert(r10['培训讲师'] === '未安排讲师', '缺讲师补默认值')
  assert(r10['培训状态'] === '培训中', '培训状态同步状态字段')
  assert(r10.__schemaVersion === 2, '行级升级记号')
  const r11 = rows.find((r) => r.id === 11)
  assert(r11['考核结果'] === '合格', `“通过”归一到合格，实际 ${r11['考核结果']}`)
  const backfilled = rows.filter((r) => r.__backfilled)
  assert(backfilled.length === 4, `回填 4 条，实际 ${backfilled.length}`)
  assert(backfilled.every((r) => r.__schemaVersion === 2), '回填行也有版本记号')

  const persisted = JSON.parse(storage.getItem('waste-to-energy-plant:entries'))
  assert(persisted.version === 2, '存储带 v2 版本包装')
  assert(persisted.upgradedAt, '存储带升级时间')
  const meta = JSON.parse(storage.getItem('waste-to-energy-plant:meta'))
  assert(meta.version === 2, '元信息记录版本')

  const backup = JSON.parse(storage.getItem('waste-to-energy-plant:training-backup:v1'))
  assert(backup.rows.length === 2, `升级前底稿 2 条，实际 ${backup.rows.length}`)
  assert(backup.rows[0]['培训主题'] === undefined, '底稿保留老形状原样')
  ok('补形状 / 默认值 / 记号 / 回填 / 底稿')
}

// ---- 场景 2：幂等——同一份老数据重复导入只升一次 ----
{
  console.info('[2] 重复导入只升一次')
  const v1 = {
    training: [
      { id: 1, status: '待组织', pending: true, abnormal: false, 培训编号: 'TRAI-0001' },
    ],
  }
  const storage = memoryStorage({ 'waste-to-energy-plant:entries': JSON.stringify(v1) })
  const first = await loadFresh({ localStorage: storage })
  const firstRows = first.listRows('training')
  assert(firstRows.some((r) => r.__backfilled), '首次有回填')

  // 第二次“导入”同一份已升级数据：读出来不能再变
  const second = await loadFresh({ localStorage: storage })
  const secondRows = second.listRows('training')
  assert(secondRows.length === firstRows.length, '二次读取条数不变')
  assert(secondRows.filter((r) => r.__backfilled).length === 3, '回填不重复叠加')
  assert(secondRows.every((r) => r.__schemaVersion === 2), '记号不被重复盖写')

  // 底稿只抄一次：再来一个新实例读到同样数据，不得覆盖已有的底稿
  const backupOnce = storage.getItem('waste-to-energy-plant:training-backup:v1')
  await loadFresh({ localStorage: storage })
  assert(
    storage.getItem('waste-to-energy-plant:training-backup:v1') === backupOnce,
    '底稿不被重复覆盖',
  )
  // 第三次读取起数据本体字节级不变（同一份数据只升一次）
  const stableOnce = storage.getItem('waste-to-energy-plant:entries')
  await loadFresh({ localStorage: storage })
  assert(
    storage.getItem('waste-to-energy-plant:entries') === stableOnce,
    '后续读取不再重写数据本体',
  )

  // 再次拿原始 v1 裸数据直接跑迁移函数
  const migration = await vite.ssrLoadModule('/src/data/migration.ts')
  const upgradedOnce = migration.upgradeStore(v1)
  const upgradedTwice = migration.upgradeStore(upgradedOnce.store)
  assert(upgradedTwice.report.upgraded === false, '对 v2 再跑迁移应是 no-op')
  assert(
    JSON.stringify(upgradedOnce.store) === JSON.stringify(upgradedTwice.store),
    '连跑两次结果完全一致',
  )
  ok('幂等')
}

// ---- 场景 3：培训编号重报只落一条 ----
{
  console.info('[3] 培训编号重报去重')
  const v1 = {
    training: [
      { id: 1, status: '培训中', pending: true, abnormal: false, 培训编号: 'TRAI-0003' },
      {
        id: 2,
        status: '已考核',
        pending: false,
        abnormal: false,
        培训编号: 'trai-0003',
        培训主题: '焚烧炉检修有限空间作业安全',
        考核结果: '优秀',
      },
      {
        id: 3,
        status: '已考核',
        pending: false,
        abnormal: false,
        培训编号: 'TRAI-0003',
        培训主题: '重复上报的第三条',
      },
    ],
  }
  const storage = memoryStorage({ 'waste-to-energy-plant:entries': JSON.stringify(v1) })
  const store = await loadFresh({ localStorage: storage })
  const rows = store.listRows('training')
  const dup = rows.filter((r) => String(r['培训编号']).toUpperCase() === 'TRAI-0003')
  assert(dup.length === 1, `TRAI-0003 只落一条，实际 ${dup.length}`)
  assert(dup[0].status === '已考核', '保留正式（已考核）记录的状态')
  assert(dup[0]['考核结果'] === '优秀', '考核结果取正式记录')
  assert(dup[0].id === 2, '正式记录走得最远，主键随正式记录')
  assert(dup[0]['培训主题'] === '焚烧炉检修有限空间作业安全', '主题取正式记录')

  // 运行期再存一条重号也只落一条
  const saved = store.saveRows('training', [
    ...rows,
    {
      id: 99,
      status: '已考核',
      pending: false,
      abnormal: false,
      培训编号: 'TRAI-0003',
      培训主题: '页面重报',
      考核结果: '良好',
    },
  ])
  assert(
    saved.filter((r) => String(r['培训编号']).toUpperCase() === 'TRAI-0003').length === 1,
    'saveRows 重号同样归并',
  )
  ok('编号去重（迁移期 + 运行期）')
}

// ---- 场景 4：清单 / 详情 / 概览的已考核场次一致 ----
{
  console.info('[4] 已考核场次三处一致')
  const v1 = {
    training: [
      { id: 1, status: '待组织', pending: true, abnormal: false, 培训编号: 'TRAI-2001', 计划日期: '2026-10-02' },
      { id: 2, status: '已考核', pending: false, abnormal: false, 培训编号: 'TRAI-2002', 培训主题: 'A', 考核结果: '合格', 计划日期: '2026-10-02' },
      { id: 3, status: '已取消', pending: true, abnormal: false, 培训编号: 'TRAI-2003', 计划日期: '2026-10-02' },
    ],
  }
  const storage = memoryStorage({ 'waste-to-energy-plant:entries': JSON.stringify(v1) })
  await loadFresh({ localStorage: storage })
  const service = await vite.ssrLoadModule('/src/api/local-service.ts')
  const training = await vite.ssrLoadModule('/src/data/training.ts')
  const overview = service.loadOverview()
  const card = overview.cards.find((c) => c.label === '已考核培训场次')
  const listed = service.listEntries('training').items
  const direct = training.assessedTrainingCount(service.listEntries('training').items)
  // 回填的 4 条示例：老库 2001/2002/2003 不占 0001~0004，示例 4 条全补；已考核 = 示例 2 + 老 1 = 3
  assert(direct === 3, `已考核 3 场，实际 ${direct}`)
  assert(card.value === direct, `概览 ${card.value} === 口径函数 ${direct}`)
  assert(
    listed.filter((r) => r.status === '已考核').length === direct,
    '清单筛选数 === 口径函数',
  )
  // 考核结果与培训主题对得上
  for (const row of listed.filter((r) => r.status === '已考核')) {
    assert(row['培训主题'] && row['培训主题'] !== '未登记培训主题', `已考核行必须有主题：${row.id}`)
    assert(['优秀', '良好', '合格', '不合格'].includes(row['考核结果']), `考核档位合法：${row['考核结果']}`)
  }
  // 取消培训后三处数字一起变
  const cancelId = listed.find((r) => r['培训编号'] === 'TRAI-2002').id
  const result = service.runAction('training', cancelId, '取消培训')
  assert(result.ok, '取消动作成功')
  const afterOverview = service.loadOverview().cards.find((c) => c.label === '已考核培训场次').value
  const afterList = service.listEntries('training').items.filter((r) => r.status === '已考核').length
  assert(afterOverview === direct - 1, `取消后概览 ${afterOverview} === ${direct - 1}`)
  assert(afterList === direct - 1, `取消后清单 ${afterList} === ${direct - 1}`)
  ok('三处口径一致且联动')
}

// ---- 场景 5：整份培训记录缺失 / 存储损坏 / 示例直接演示 ----
{
  console.info('[5] 空库与损坏数据')
  // 全新浏览器：直接播种 v2 示例
  const empty = memoryStorage({})
  const fresh = await loadFresh({ localStorage: empty })
  const rows = fresh.listRows('training')
  assert(rows.length === 4, `示例 4 条，实际 ${rows.length}`)
  assert(rows.every((r) => r.__schemaVersion === 2), '示例自带版本记号')
  assert(!fresh.readTrainingBackup(), '没有老数据就没有底稿')

  // 损坏 JSON：回退示例且不抛错
  const broken = memoryStorage({ 'waste-to-energy-plant:entries': '{not-json' })
  const recovered = await loadFresh({ localStorage: broken })
  assert(recovered.listRows('training').length === 4, '损坏存储回退示例')
  ok('空库播种 / 损坏兜底')
}

await vite.close()
console.info(`\n全部通过：${passed} 组场景`)
