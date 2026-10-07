<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>安全培训管理管理</h2>
        <p class="page-desc">维护培训记录，围绕培训编号、培训主题、培训对象、培训讲师做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记培训记录</button>
        <button class="btn" type="button" @click="exportRows">导出安全培训管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无安全培训管理数据，可先登记培训记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条安全培训管理记录，已考核 {{ statsSummary.assessedCount }} 场次</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="培训记录详情">
        <header class="modal-head">
          <h3>培训记录详情</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <table class="data-table detail-table">
          <tbody>
            <tr v-for="column in columns" :key="column">
              <th>{{ column }}</th>
              <td>{{ detailRow[column] ?? '—' }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ detailRow.status }}</td>
            </tr>
            <tr v-if="upgradedAt(detailRow)">
              <th>结构升级</th>
              <td>由老版本记录补齐，升级时间 {{ upgradedAt(detailRow) }}</td>
            </tr>
            <tr v-if="backfilledAt(detailRow)">
              <th>历史回填</th>
              <td>缺失历史记录已回填，回填时间 {{ backfilledAt(detailRow) }}</td>
            </tr>
            <tr v-if="mergedFrom(detailRow)">
              <th>重报合并</th>
              <td>同一培训编号的重报已合并（原记录ID：{{ mergedFrom(detailRow) }}）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  trainingStats,
} from '@/api/local-service'
import { MARK_BACKFILLED, MARK_MERGED, MARK_UPGRADED } from '@/data/training/migrate'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('training')
const columns = ["培训编号", "培训主题", "培训对象", "培训讲师", "计划日期", "培训时长", "考核结果", "培训状态"]
const actions = ["组织培训", "提交考核", "取消培训"]
const statuses = ["待组织", "培训中", "已考核", "已取消"]

const rows = ref<EntryRow[]>([])
const allTrainingRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detailRow = ref<EntryRow | null>(null)

// 统计卡片按全部培训记录算，不受上面筛选条件影响，与概览页共用同一口径。
const allStats = computed(() => trainingStats(allTrainingRows.value))
const stats = computed(() => [
  { label: "待组织培训", value: allStats.value.pendingCount },
  { label: "已考核培训", value: allStats.value.assessedCount },
  { label: "本月培训场次", value: allStats.value.monthCount },
])
const statsSummary = computed(() => allStats.value)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function upgradedAt(row: EntryRow): string {
  return String((row as Record<string, unknown>)[MARK_UPGRADED] ?? '')
}

function backfilledAt(row: EntryRow): string {
  return String((row as Record<string, unknown>)[MARK_BACKFILLED] ?? '')
}

function mergedFrom(row: EntryRow): string {
  return String((row as Record<string, unknown>)[MARK_MERGED] ?? '')
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '培训记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const fullPayload = listEntries(meta.key)
    allTrainingRows.value = fullPayload.items
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全培训管理列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 8px;
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow: auto;
  padding: 16px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.detail-table th {
  width: 120px;
  white-space: nowrap;
}
</style>
