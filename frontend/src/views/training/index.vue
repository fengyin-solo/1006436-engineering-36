<template>
  <section class="page" data-module="training">
    <header class="page-head">
      <div>
        <h2>安全培训管理</h2>
        <p class="page-desc">维护培训记录，围绕培训编号、培训主题、培训对象、培训讲师做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记培训记录</button>
        <button class="btn" type="button" @click="exportRows">导出安全培训清单</button>
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
          <td v-for="column in columns" :key="column">
            <button
              v-if="column === '培训编号'"
              class="link"
              type="button"
              @click="openDetail(row)"
            >{{ row[column] ?? '—' }}</button>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无安全培训数据，可先登记培训记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ total }} 条培训记录
        <em v-if="upgradeNote" class="upgrade-note">{{ upgradeNote }}</em>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="detail-mask" @click.self="closeDetail">
      <section class="detail-panel" role="dialog" aria-modal="true" aria-label="培训记录详情">
        <header class="detail-head">
          <h3>{{ detailRow['培训主题'] }}（{{ detailRow['培训编号'] }}）</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <div v-for="column in columns" :key="column" class="detail-item">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] || '—' }}</dd>
          </div>
          <div class="detail-item">
            <dt>当前状态</dt>
            <dd>{{ detailRow.status }}</dd>
          </div>
        </dl>
        <p class="detail-tags">
          <span v-if="detailRow.__backfilled" class="detail-tag tag-backfill">历史记录回填</span>
          <span class="detail-tag tag-version">存储结构 v{{ detailRow.__schemaVersion ?? 1 }}</span>
        </p>
        <footer class="detail-foot">
          <span>已考核场次按同一口径统计，清单、详情与运营概览数字一致。</span>
        </footer>
      </section>
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
} from '@/api/local-service'
import { listRows, readTrainingBackup } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { assessedTrainingCount, monthTrainingCount, pendingOrganizeCount } from '@/data/training'

const meta = moduleMeta('training')
const columns = ["培训编号", "培训主题", "培训对象", "培训讲师", "计划日期", "培训时长", "考核结果", "培训状态"]
const actions = ["组织培训", "提交考核", "取消培训"]
const statuses = ["待组织", "培训中", "已考核", "已取消"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detailRow = ref<EntryRow | null>(null)

// 统计口径与运营概览共用 data/training.ts，三边已考核场次必然一致。
const stats = computed(() => {
  const all = listRows(meta.key)
  return [
    { label: '待组织培训', value: pendingOrganizeCount(all) },
    { label: '已考核培训', value: assessedTrainingCount(all) },
    { label: '本月培训场次', value: monthTrainingCount(all) },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const upgradeNote = computed(() => {
  const backup = readTrainingBackup()
  if (!backup) {
    return ''
  }
  return `· 老存储已升级到 v2，升级前底稿 ${backup.rows.length} 条（${backup.backedUpAt.slice(0, 10)}）`
})

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

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
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
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全培训列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.upgrade-note {
  margin-left: 8px;
  font-style: normal;
  color: #1f6feb;
}
.detail-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.detail-panel {
  width: 640px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.detail-head h3 {
  margin: 0;
  font-size: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
  margin: 14px 0;
}
.detail-item dt {
  font-size: 12px;
  color: var(--muted);
}
.detail-item dd {
  margin: 2px 0 0;
  font-size: 13px;
}
.detail-tags {
  display: flex;
  gap: 8px;
  margin: 0 0 10px;
}
.detail-tag {
  font-size: 12px;
  border-radius: 999px;
  padding: 2px 10px;
}
.tag-backfill {
  background: #fff7e6;
  color: #b54708;
}
.tag-version {
  background: #eef2f7;
  color: var(--muted);
}
.detail-foot {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  font-size: 12px;
  color: var(--muted);
}
</style>
