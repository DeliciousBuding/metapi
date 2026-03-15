import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import CenteredModal from '../components/CenteredModal.js';
import DeleteConfirmModal from '../components/DeleteConfirmModal.js';
import { useToast } from '../components/Toast.js';
import ModernSelect from '../components/ModernSelect.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import DownstreamKeyTrendChart, { type DownstreamKeyTrendBucket } from '../components/charts/DownstreamKeyTrendChart.js';
import { tr } from '../i18n.js';

type Range = '24h' | '7d' | 'all';
type Status = 'all' | 'enabled' | 'disabled';

type SummaryItem = {
  id: number;
  name: string;
  keyMasked: string;
  enabled: boolean;
  description: string | null;
  expiresAt: string | null;
  maxCost: number | null;
  usedCost: number;
  maxRequests: number | null;
  usedRequests: number;
  supportedModels: string[];
  allowedRouteIds: number[];
  siteWeightMultipliers: Record<number, number>;
  lastUsedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  rangeUsage: {
    totalRequests: number;
    successRequests: number;
    failedRequests: number;
    successRate: number | null;
    totalTokens: number;
    totalCost: number;
  };
};

type AggregateUsage = {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number | null;
  totalTokens: number;
  totalCost: number;
};

type OverviewResponse = {
  success: boolean;
  item: SummaryItem;
  usage: null | {
    last24h: AggregateUsage | null;
    last7d: AggregateUsage | null;
    all: AggregateUsage | null;
  };
};

type DownstreamApiKeyItem = {
  id: number;
  name: string;
  key: string;
  keyMasked: string;
  description: string | null;
  enabled: boolean;
  expiresAt: string | null;
  maxCost: number | null;
  usedCost: number;
  maxRequests: number | null;
  usedRequests: number;
  supportedModels: string[];
  allowedRouteIds: number[];
  lastUsedAt: string | null;
};

type ManagedItem = SummaryItem & {
  key?: string;
};

type RouteSelectorItem = {
  id: number;
  modelPattern: string;
  displayName?: string | null;
  enabled: boolean;
};

type EditorForm = {
  name: string;
  key: string;
  description: string;
  maxCost: string;
  maxRequests: string;
  expiresAt: string;
  enabled: boolean;
  selectedModels: string[];
  selectedGroupRouteIds: number[];
};

type DeleteConfirmState =
  | null
  | { mode: 'single'; item: ManagedItem }
  | { mode: 'batch'; ids: number[] };

function formatIso(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (!text) return '--';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(6)}`;
}

function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.trunc(value));
}

function toDateTimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const ts = Date.parse(isoString);
  if (!Number.isFinite(ts)) return '';
  const date = new Date(ts);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function isExactModelPattern(modelPattern: string): boolean {
  const normalized = modelPattern.trim();
  if (!normalized) return false;
  if (normalized.toLowerCase().startsWith('re:')) return false;
  return !/[\*\?\[]/.test(normalized);
}

function routeTitle(route: RouteSelectorItem): string {
  const displayName = (route.displayName || '').trim();
  return displayName || route.modelPattern;
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function uniqIds(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.trunc(value)))];
}

function buildEditorForm(item?: ManagedItem | DownstreamApiKeyItem | null): EditorForm {
  return {
    name: item?.name || '',
    key: item?.key || '',
    description: item?.description || '',
    maxCost: item?.maxCost === null || item?.maxCost === undefined ? '' : String(item.maxCost),
    maxRequests: item?.maxRequests === null || item?.maxRequests === undefined ? '' : String(item.maxRequests),
    expiresAt: toDateTimeLocal(item?.expiresAt),
    enabled: item?.enabled ?? true,
    selectedModels: uniqStrings(Array.isArray(item?.supportedModels) ? item!.supportedModels : []),
    selectedGroupRouteIds: uniqIds(Array.isArray(item?.allowedRouteIds) ? item!.allowedRouteIds : []),
  };
}

function summarizeModelLimit(models: string[]): string {
  if (!Array.isArray(models) || models.length === 0) return '全部模型';
  if (models.length === 1) return models[0];
  return `${models[0]} +${models.length - 1}`;
}

function summarizeRouteLimit(routeIds: number[], routeMap: Map<number, RouteSelectorItem>): string {
  if (!Array.isArray(routeIds) || routeIds.length === 0) return '全部群组';
  const names = routeIds
    .map((id) => routeMap.get(id))
    .filter(Boolean)
    .map((item) => routeTitle(item!));
  if (names.length === 0) return `${routeIds.length} 个群组`;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

function RangeToggle({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-card)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
  };

  const active: React.CSSProperties = {
    background: 'var(--color-primary)',
    color: '#fff',
    borderColor: 'var(--color-primary)',
  };

  return (
    <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <button onClick={() => onChange('24h')} style={{ ...base, ...(range === '24h' ? active : {}), borderRight: 'none' }}>
        24h
      </button>
      <button onClick={() => onChange('7d')} style={{ ...base, ...(range === '7d' ? active : {}), borderRight: 'none' }}>
        7d
      </button>
      <button onClick={() => onChange('all')} style={{ ...base, ...(range === 'all' ? active : {}), borderTopRightRadius: 'var(--radius-sm)', borderBottomRightRadius: 'var(--radius-sm)' }}>
        全部
      </button>
    </div>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        border: '1px solid var(--color-border-light)',
        color: enabled ? 'var(--color-success)' : 'var(--color-text-muted)',
        background: enabled
          ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
          : 'color-mix(in srgb, var(--color-text-muted) 10%, transparent)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: enabled ? 'var(--color-success)' : 'var(--color-text-muted)',
        }}
      />
      {enabled ? '启用' : '禁用'}
    </span>
  );
}

function Drawer({
  open,
  onClose,
  item,
  initialRange,
}: {
  open: boolean;
  onClose: () => void;
  item: SummaryItem | null;
  initialRange: Range;
}) {
  const toast = useToast();
  const presence = useAnimatedVisibility(open, 220);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [trendRange, setTrendRange] = useState<Range>(initialRange);
  const [trendLoading, setTrendLoading] = useState(false);
  const [buckets, setBuckets] = useState<DownstreamKeyTrendBucket[]>([]);

  useEffect(() => {
    if (!open) return;
    setTrendRange(initialRange);
  }, [open, initialRange]);

  useEffect(() => {
    if (!open || !item?.id) return;
    let cancelled = false;
    setOverviewLoading(true);
    api.getDownstreamApiKeyOverview(item.id)
      .then((res: any) => {
        if (cancelled) return;
        setOverview(res as OverviewResponse);
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error(err?.message || '加载 Key 概览失败');
      })
      .finally(() => {
        if (cancelled) return;
        setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id, toast]);

  useEffect(() => {
    if (!open || !item?.id) return;
    let cancelled = false;
    setTrendLoading(true);
    api.getDownstreamApiKeyTrend(item.id, { range: trendRange })
      .then((res: any) => {
        if (cancelled) return;
        setBuckets(Array.isArray(res?.buckets) ? res.buckets : []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error(err?.message || '加载趋势失败');
      })
      .finally(() => {
        if (cancelled) return;
        setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id, trendRange, toast]);

  if (!presence.shouldRender) return null;

  const panel = (
    <div
      className={`modal-backdrop ${presence.isVisible ? '' : 'is-closing'}`.trim()}
      onClick={onClose}
      style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}
    >
      <div
        className={`modal-content ${presence.isVisible ? '' : 'is-closing'}`.trim()}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(92vw, 560px)',
          maxWidth: 560,
          height: '100vh',
          maxHeight: '100vh',
          borderRadius: 0,
          animation: presence.isVisible ? 'drawer-slide-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both' : 'drawer-slide-out 0.22s cubic-bezier(0.4, 0, 1, 1) both',
        }}
      >
        <div className="modal-header" style={{ paddingTop: 18, paddingBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{item?.name || '--'}</span>
              <StatusBadge enabled={!!item?.enabled} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {item?.keyMasked || '****'}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ border: '1px solid var(--color-border)' }}>
            关闭
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.02em' }}>
              趋势
            </div>
            <RangeToggle range={trendRange} onChange={setTrendRange} />
          </div>

          <DownstreamKeyTrendChart buckets={buckets} loading={trendLoading} height={260} />

          <div style={{ height: 16 }} />

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
              概览
            </div>
            {overviewLoading ? (
              <div className="skeleton" style={{ width: '100%', height: 72, borderRadius: 'var(--radius-sm)' }} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>最近使用</div>
                  <div style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{formatIso(item?.lastUsedAt)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>累计请求</div>
                  <div style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{(item?.usedRequests || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>累计成本</div>
                  <div style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{formatMoney(Number(item?.usedCost || 0))}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>到期时间</div>
                  <div style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{formatIso(item?.expiresAt)}</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ height: 16 }} />

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
              当前范围汇总
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>Tokens</div>
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{formatCompactTokens(item?.rangeUsage?.totalTokens || 0)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>请求数</div>
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{(item?.rangeUsage?.totalRequests || 0).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>成功率</div>
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{item?.rangeUsage?.successRate == null ? '--' : `${item.rangeUsage.successRate}%`}</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>成本</div>
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{formatMoney(Number(item?.rangeUsage?.totalCost || 0))}</div>
              </div>
            </div>
          </div>

          {overview?.usage ? (
            <>
              <div style={{ height: 16 }} />
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
                  固定窗口对比
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 12 }}>
                  {[
                    { label: '24h', data: overview.usage.last24h },
                    { label: '7d', data: overview.usage.last7d },
                    { label: '全部', data: overview.usage.all },
                  ].map((section) => (
                    <div key={section.label} style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
                      <div style={{ color: 'var(--color-text-primary)', fontWeight: 700, marginBottom: 8 }}>{section.label}</div>
                      <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>Tokens</div>
                      <div style={{ color: 'var(--color-text-primary)', fontWeight: 700, marginBottom: 8 }}>{formatCompactTokens(section.data?.totalTokens || 0)}</div>
                      <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>请求数</div>
                      <div style={{ color: 'var(--color-text-primary)', fontWeight: 700, marginBottom: 8 }}>{(section.data?.totalRequests || 0).toLocaleString()}</div>
                      <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>成功率</div>
                      <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{section.data?.successRate == null ? '--' : `${section.data.successRate}%`}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

function EditorModal({
  open,
  editingItem,
  form,
  onChange,
  onClose,
  onSave,
  saving,
  routeOptions,
}: {
  open: boolean;
  editingItem: ManagedItem | null;
  form: EditorForm;
  onChange: (updater: (prev: EditorForm) => EditorForm) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  routeOptions: RouteSelectorItem[];
}) {
  const [modelSearch, setModelSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');

  useEffect(() => {
    if (!open) {
      setModelSearch('');
      setGroupSearch('');
    }
  }, [open]);

  const exactModels = useMemo(
    () => uniqStrings(routeOptions.filter((item) => isExactModelPattern(item.modelPattern)).map((item) => item.modelPattern)).sort((a, b) => a.localeCompare(b)),
    [routeOptions],
  );

  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase();
    if (!keyword) return exactModels;
    return exactModels.filter((model) => model.toLowerCase().includes(keyword));
  }, [exactModels, modelSearch]);

  const filteredGroups = useMemo(() => {
    const keyword = groupSearch.trim().toLowerCase();
    if (!keyword) return routeOptions;
    return routeOptions.filter((route) => {
      const title = routeTitle(route).toLowerCase();
      return title.includes(keyword) || route.modelPattern.toLowerCase().includes(keyword);
    });
  }, [groupSearch, routeOptions]);

  const selectedModelCount = form.selectedModels.length;
  const selectedGroupCount = form.selectedGroupRouteIds.length;
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-bg)',
    color: 'var(--color-text-primary)',
  };

  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      title={editingItem ? '编辑下游密钥' : '新增下游密钥'}
      maxWidth={1040}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      footer={(
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={saving}>取消</button>
          <button onClick={onSave} className="btn btn-primary" disabled={saving}>
            {saving
              ? <><span className="spinner spinner-sm" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} /> 保存中...</>
              : (editingItem ? '保存修改' : '创建密钥')}
          </button>
        </>
      )}
    >
      <div className="info-tip" style={{ marginBottom: 0 }}>
        支持为每个下游密钥独立配置过期时间、额度上限、模型白名单与群组范围。留空表示不限制。
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>名称</div>
          <input value={form.name} onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：项目 A / 移动端" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>下游密钥</div>
          <input value={form.key} onChange={(e) => onChange((prev) => ({ ...prev, key: e.target.value }))} placeholder="sk-..." style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>请求额度</div>
          <input value={form.maxRequests} onChange={(e) => onChange((prev) => ({ ...prev, maxRequests: e.target.value }))} placeholder="留空表示不限" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>成本额度</div>
          <input value={form.maxCost} onChange={(e) => onChange((prev) => ({ ...prev, maxCost: e.target.value }))} placeholder="留空表示不限" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>过期时间</div>
          <input type="datetime-local" value={form.expiresAt} onChange={(e) => onChange((prev) => ({ ...prev, expiresAt: e.target.value }))} style={inputStyle} />
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 12px',
            background: 'var(--color-bg)',
            cursor: 'pointer',
            minHeight: 42,
            marginTop: 18,
          }}
        >
          <input type="checkbox" checked={form.enabled} onChange={(e) => onChange((prev) => ({ ...prev, enabled: e.target.checked }))} />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>创建后立即启用</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>关闭后该密钥将无法继续分发请求</div>
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>备注说明</div>
        <textarea
          value={form.description}
          onChange={(e) => onChange((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="填写业务场景、负责人或限制说明"
          style={{ ...inputStyle, minHeight: 84, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>模型白名单</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>只展示精确模型，未勾选则视为全部模型可用</div>
            </div>
            <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => onChange((prev) => ({ ...prev, selectedModels: [] }))}>
              清空
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>已选 {selectedModelCount} 个模型</div>
          <div className="toolbar-search" style={{ maxWidth: '100%' }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="搜索模型" />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredModels.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无匹配模型</div>
            ) : filteredModels.map((model) => {
              const checked = form.selectedModels.includes(model);
              return (
                <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--color-border-light)', background: checked ? 'color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-card))' : 'var(--color-bg-card)' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange((prev) => ({
                      ...prev,
                      selectedModels: checked ? prev.selectedModels.filter((item) => item !== model) : [...prev.selectedModels, model],
                    }))}
                  />
                  <code style={{ color: 'var(--color-text-primary)', fontSize: 12 }}>{model}</code>
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>群组范围</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>限制可访问的群组路由，未勾选则视为全部群组可用</div>
            </div>
            <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => onChange((prev) => ({ ...prev, selectedGroupRouteIds: [] }))}>
              清空
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>已选 {selectedGroupCount} 个群组</div>
          <div className="toolbar-search" style={{ maxWidth: '100%' }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="搜索群组或模型模式" />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredGroups.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>暂无匹配群组</div>
            ) : filteredGroups.map((route) => {
              const checked = form.selectedGroupRouteIds.includes(route.id);
              return (
                <label key={route.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--color-border-light)', background: checked ? 'color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-card))' : 'var(--color-bg-card)' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange((prev) => ({
                      ...prev,
                      selectedGroupRouteIds: checked
                        ? prev.selectedGroupRouteIds.filter((item) => item !== route.id)
                        : [...prev.selectedGroupRouteIds, route.id],
                    }))}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 600 }}>
                      {routeTitle(route)}
                      {!route.enabled ? <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-danger)' }}>已禁用</span> : null}
                    </div>
                    <code style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>{route.modelPattern}</code>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </CenteredModal>
  );
}

export default function DownstreamKeys() {
  const toast = useToast();
  const [range, setRange] = useState<Range>('24h');
  const [status, setStatus] = useState<Status>('all');
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const [summaryItems, setSummaryItems] = useState<SummaryItem[]>([]);
  const [rawItems, setRawItems] = useState<DownstreamApiKeyItem[]>([]);
  const [routeOptions, setRouteOptions] = useState<RouteSelectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorForm, setEditorForm] = useState<EditorForm>(() => buildEditorForm());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [summaryRes, rawRes, routesRes] = await Promise.all([
        api.getDownstreamApiKeysSummary({ range }),
        api.getDownstreamApiKeys(),
        api.getRoutesLite(),
      ]);
      setSummaryItems(Array.isArray(summaryRes?.items) ? summaryRes.items : []);
      setRawItems(Array.isArray(rawRes?.items) ? rawRes.items : []);
      setRouteOptions((Array.isArray(routesRes) ? routesRes : []).map((row: any) => ({
        id: Number(row.id),
        modelPattern: String(row.modelPattern || ''),
        displayName: row.displayName,
        enabled: !!row.enabled,
      })));
    } catch (err: any) {
      toast.error(err?.message || '加载下游密钥列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [range]);

  const rawItemMap = useMemo(() => new Map(rawItems.map((item) => [item.id, item])), [rawItems]);
  const routeMap = useMemo(() => new Map(routeOptions.map((item) => [item.id, item])), [routeOptions]);

  const managedItems = useMemo<ManagedItem[]>(() => (
    summaryItems.map((item) => {
      const raw = rawItemMap.get(item.id);
      return {
        ...item,
        key: raw?.key,
        keyMasked: raw?.keyMasked || item.keyMasked,
        description: raw?.description ?? item.description,
        enabled: raw?.enabled ?? item.enabled,
        expiresAt: raw?.expiresAt ?? item.expiresAt,
        maxCost: raw?.maxCost ?? item.maxCost,
        usedCost: raw?.usedCost ?? item.usedCost,
        maxRequests: raw?.maxRequests ?? item.maxRequests,
        usedRequests: raw?.usedRequests ?? item.usedRequests,
        supportedModels: raw?.supportedModels ?? item.supportedModels,
        allowedRouteIds: raw?.allowedRouteIds ?? item.allowedRouteIds,
        lastUsedAt: raw?.lastUsedAt ?? item.lastUsedAt,
      };
    })
  ), [rawItemMap, summaryItems]);

  const visibleItems = useMemo(() => managedItems.filter((item) => {
    if (status === 'enabled' && !item.enabled) return false;
    if (status === 'disabled' && item.enabled) return false;
    if (!deferredSearch) return true;
    const haystack = [
      item.name,
      item.description || '',
      item.keyMasked,
      ...(item.supportedModels || []),
      ...((item.allowedRouteIds || []).map((id) => routeTitle(routeMap.get(id) || { id, modelPattern: String(id), enabled: true } as RouteSelectorItem))),
    ].join(' ').toLowerCase();
    return haystack.includes(deferredSearch);
  }).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const lastA = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const lastB = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    if (lastA !== lastB) return lastB - lastA;
    return a.name.localeCompare(b.name);
  }), [deferredSearch, managedItems, routeMap, status]);

  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selectedVisibleCount = useMemo(() => selectedIds.filter((id) => visibleIds.includes(id)).length, [selectedIds, visibleIds]);
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => managedItems.some((item) => item.id == id)));
    setSelectedId((current) => (current && managedItems.some((item) => item.id === current) ? current : null));
  }, [managedItems]);

  const selectedItem = useMemo(
    () => managedItems.find((item) => item.id === selectedId) || null,
    [managedItems, selectedId],
  );

  const editingItem = useMemo(
    () => managedItems.find((item) => item.id === editingId) || null,
    [editingId, managedItems],
  );

  const statusOptions = useMemo(() => [
    { value: 'all', label: '全部状态' },
    { value: 'enabled', label: '仅启用' },
    { value: 'disabled', label: '仅禁用' },
  ], []);

  const totals = useMemo(() => visibleItems.reduce((acc, item) => {
    acc.tokens += Number(item.rangeUsage?.totalTokens || 0);
    acc.requests += Number(item.rangeUsage?.totalRequests || 0);
    acc.cost += Number(item.rangeUsage?.totalCost || 0);
    if (item.enabled) acc.enabled += 1;
    return acc;
  }, { tokens: 0, requests: 0, cost: 0, enabled: 0 }), [visibleItems]);

  const openCreate = () => {
    setEditingId(null);
    setEditorForm(buildEditorForm());
    setEditorOpen(true);
  };

  const openEdit = (item: ManagedItem) => {
    setEditingId(item.id);
    setEditorForm(buildEditorForm(rawItemMap.get(item.id) || item));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setEditorForm(buildEditorForm());
  };

  const withRowLoading = async (key: string, action: () => Promise<void>) => {
    setRowLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await action();
    } finally {
      setRowLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const saveKey = async () => {
    const name = editorForm.name.trim();
    const key = editorForm.key.trim();
    if (!name) {
      toast.info('请填写密钥名称');
      return;
    }
    if (!key) {
      toast.info('请填写下游密钥');
      return;
    }
    if (!key.startsWith('sk-')) {
      toast.info('下游密钥必须以 sk- 开头');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        key,
        description: editorForm.description.trim(),
        enabled: editorForm.enabled,
        expiresAt: editorForm.expiresAt ? new Date(editorForm.expiresAt).toISOString() : null,
        maxCost: editorForm.maxCost.trim() ? Number(editorForm.maxCost.trim()) : null,
        maxRequests: editorForm.maxRequests.trim() ? Number(editorForm.maxRequests.trim()) : null,
        supportedModels: uniqStrings(editorForm.selectedModels),
        allowedRouteIds: uniqIds(editorForm.selectedGroupRouteIds),
      };
      if (editingId) {
        await api.updateDownstreamApiKey(editingId, payload);
        toast.success('下游密钥已更新');
      } else {
        await api.createDownstreamApiKey(payload);
        toast.success('下游密钥已创建');
      }
      closeEditor();
      await load();
    } catch (err: any) {
      toast.error(err?.message || '保存下游密钥失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = (id: number, checked: boolean) => {
    setSelectedIds((current) => checked ? uniqIds([...current, id]) : current.filter((item) => item !== id));
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setSelectedIds((current) => uniqIds([...current, ...visibleIds]));
  };

  const batchRun = async (label: string, ids: number[], action: (id: number) => Promise<void>) => {
    if (ids.length === 0) return;
    setBatchActionLoading(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => action(id)));
      const failedIds = results.map((result, index) => ({ result, id: ids[index] })).filter((item) => item.result.status === 'rejected').map((item) => item.id);
      const successCount = ids.length - failedIds.length;
      if (failedIds.length > 0) {
        toast.info(`${label}完成：成功 ${successCount}，失败 ${failedIds.length}`);
      } else {
        toast.success(`${label}完成：成功 ${successCount}`);
      }
      setSelectedIds(failedIds);
      await load();
    } catch (err: any) {
      toast.error(err?.message || `${label}失败`);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const toggleEnabled = async (item: ManagedItem) => {
    await withRowLoading(`toggle-${item.id}`, async () => {
      await api.updateDownstreamApiKey(item.id, { enabled: !item.enabled });
      await load();
      toast.success(item.enabled ? '已禁用该密钥' : '已启用该密钥');
    });
  };

  const resetUsage = async (item: ManagedItem) => {
    await withRowLoading(`reset-${item.id}`, async () => {
      await api.resetDownstreamApiKeyUsage(item.id);
      await load();
      toast.success('已清零该密钥用量');
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const target = deleteConfirm;
    setDeleteConfirm(null);

    if (target.mode === 'single') {
      await withRowLoading(`delete-${target.item.id}`, async () => {
        await api.deleteDownstreamApiKey(target.item.id);
        toast.success('下游密钥已删除');
        await load();
      });
      return;
    }

    await batchRun('批量删除', target.ids, (id) => api.deleteDownstreamApiKey(id));
  };

  const empty = !loading && visibleItems.length === 0;

  return (
    <div className="animate-fade-in" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page-title">下游密钥</h2>
          <div className="page-subtitle">统一管理分发给下游项目的密钥、额度、模型白名单、群组范围与历史用量。</div>
        </div>
        <div className="page-actions">
          <RangeToggle range={range} onChange={setRange} />
          <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => void load()} disabled={loading}>
            {loading ? <><span className="spinner spinner-sm" /> 刷新中...</> : '刷新'}
          </button>
          <button className="btn btn-primary" onClick={openCreate}>+ 新增下游密钥</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="stat-card">
          <div className="stat-card-header"><span>当前范围</span></div>
          <div className="stat-card-row"><span>时间窗口</span><strong>{range === '24h' ? '最近 24 小时' : range === '7d' ? '最近 7 天' : '全部历史'}</strong></div>
          <div className="stat-card-row"><span>可见密钥</span><strong>{visibleItems.length}</strong></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><span>运行状态</span></div>
          <div className="stat-card-row"><span>启用中</span><strong>{totals.enabled}</strong></div>
          <div className="stat-card-row"><span>已选中</span><strong>{selectedIds.length}</strong></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><span>范围用量</span></div>
          <div className="stat-card-row"><span>Tokens</span><strong>{formatCompactTokens(totals.tokens)}</strong></div>
          <div className="stat-card-row"><span>请求数</span><strong>{totals.requests.toLocaleString()}</strong></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header"><span>范围成本</span></div>
          <div className="stat-card-row"><span>累计成本</span><strong>{formatMoney(totals.cost)}</strong></div>
          <div className="stat-card-row"><span>筛选状态</span><strong>{statusOptions.find((item) => item.value === status)?.label || '全部状态'}</strong></div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="toolbar-search">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="搜索名称、备注、模型或群组" />
          </div>
          <div style={{ minWidth: 180 }}>
            <ModernSelect value={status} onChange={(value) => setStatus((value as Status) || 'all')} options={statusOptions} />
          </div>
          <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => { setSearchInput(''); setStatus('all'); }}>
            重置筛选
          </button>
        </div>

        {selectedIds.length > 0 ? (
          <div className="card" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'color-mix(in srgb, var(--color-primary) 6%, var(--color-bg-card))' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>已选 {selectedIds.length} 个密钥</span>
            <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => void batchRun('批量启用', selectedIds, (id) => api.updateDownstreamApiKey(id, { enabled: true }))} disabled={batchActionLoading}>批量启用</button>
            <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => void batchRun('批量禁用', selectedIds, (id) => api.updateDownstreamApiKey(id, { enabled: false }))} disabled={batchActionLoading}>批量禁用</button>
            <button className="btn btn-ghost" style={{ border: '1px solid var(--color-border)' }} onClick={() => void batchRun('批量清零用量', selectedIds, (id) => api.resetDownstreamApiKeyUsage(id))} disabled={batchActionLoading}>批量清零用量</button>
            <button className="btn btn-link btn-link-danger" onClick={() => setDeleteConfirm({ mode: 'batch', ids: [...selectedIds] })} disabled={batchActionLoading}>批量删除</button>
          </div>
        ) : null}

        {loading ? (
          <div className="skeleton" style={{ width: '100%', height: 280, borderRadius: 'var(--radius-sm)' }} />
        ) : empty ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="empty-state-title">暂无下游密钥</div>
            <div className="empty-state-desc">可以先新增一条密钥，或调整筛选条件查看已有数据。</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 42 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={(e) => toggleSelectAllVisible(e.target.checked)} />
                  </th>
                  <th>密钥信息</th>
                  <th>授权范围</th>
                  <th style={{ textAlign: 'right' }}>额度</th>
                  <th style={{ textAlign: 'right' }}>用量</th>
                  <th>最近使用</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((row) => {
                  const loadingToggle = !!rowLoading[`toggle-${row.id}`];
                  const loadingReset = !!rowLoading[`reset-${row.id}`];
                  const loadingDelete = !!rowLoading[`delete-${row.id}`];
                  const checked = selectedIds.includes(row.id);
                  return (
                    <tr key={row.id} className={`row-selectable ${checked ? 'row-selected' : ''}`.trim()} onClick={() => { setSelectedId(row.id); setDrawerOpen(true); }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={(e) => toggleSelection(row.id, e.target.checked)} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <strong style={{ color: 'var(--color-text-primary)' }}>{row.name}</strong>
                          <StatusBadge enabled={row.enabled} />
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>{row.keyMasked}</div>
                        {row.description ? <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 320 }}>{row.description}</div> : null}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>模型：<span style={{ color: 'var(--color-text-primary)' }}>{summarizeModelLimit(row.supportedModels || [])}</span></div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>群组：<span style={{ color: 'var(--color-text-primary)' }}>{summarizeRouteLimit(row.allowedRouteIds || [], routeMap)}</span></div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{row.maxRequests == null ? '不限' : row.maxRequests.toLocaleString()}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{row.maxCost == null ? '成本不限' : `成本 ${formatMoney(row.maxCost)}`}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{row.expiresAt ? `到期 ${formatIso(row.expiresAt)}` : '永久有效'}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{formatCompactTokens(row.rangeUsage?.totalTokens || 0)}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{(row.rangeUsage?.totalRequests || 0).toLocaleString()} 请求</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{row.rangeUsage?.successRate == null ? '--' : `成功率 ${row.rangeUsage.successRate}%`}</div>
                      </td>
                      <td style={{ color: 'var(--color-text-muted)' }}>{formatIso(row.lastUsedAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn btn-link" onClick={() => { setSelectedId(row.id); setDrawerOpen(true); }}>查看</button>
                          <button className="btn btn-link" onClick={() => openEdit(row)}>编辑</button>
                          <button className="btn btn-link" onClick={() => void toggleEnabled(row)} disabled={loadingToggle}>{loadingToggle ? '处理中...' : (row.enabled ? '禁用' : '启用')}</button>
                          <button className="btn btn-link" onClick={() => void resetUsage(row)} disabled={loadingReset}>{loadingReset ? '处理中...' : '清零用量'}</button>
                          <button className="btn btn-link btn-link-danger" onClick={() => setDeleteConfirm({ mode: 'single', item: row })} disabled={loadingDelete}>{loadingDelete ? '处理中...' : '删除'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditorModal
        open={editorOpen}
        editingItem={editingItem}
        form={editorForm}
        onChange={(updater) => setEditorForm((prev) => updater(prev))}
        onClose={closeEditor}
        onSave={() => void saveKey()}
        saving={saving}
        routeOptions={routeOptions}
      />

      <DeleteConfirmModal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => void confirmDelete()}
        title="确认删除下游密钥"
        confirmText="确认删除"
        loading={batchActionLoading || (deleteConfirm?.mode === 'single' && !!rowLoading[`delete-${deleteConfirm.item.id}`])}
        description={deleteConfirm?.mode === 'single'
          ? <>确定要删除密钥 <strong>{deleteConfirm.item.name}</strong> 吗？</>
          : <>确定要删除选中的 <strong>{deleteConfirm?.ids.length || 0}</strong> 个密钥吗？</>}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={selectedItem}
        initialRange={range}
      />
    </div>
  );
}