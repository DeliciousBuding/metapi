import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
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

type OverviewResponse = {
  success: boolean;
  item: SummaryItem;
  usage: null | {
    last24h: any;
    last7d: any;
    all: any;
  };
};

function formatIso(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (!text) return '—';
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
        const nextBuckets = Array.isArray(res?.buckets) ? res.buckets : [];
        setBuckets(nextBuckets);
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
              <span>{item?.name || '—'}</span>
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
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{item?.rangeUsage?.successRate == null ? '—' : `${item.rangeUsage.successRate}%`}</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>成本</div>
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{formatMoney(Number(item?.rangeUsage?.totalCost || 0))}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

export default function DownstreamKeys() {
  const toast = useToast();
  const [range, setRange] = useState<Range>('24h');
  const [status, setStatus] = useState<Status>('all');
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput.trim());
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getDownstreamApiKeysSummary({ range, status, search: deferredSearch || undefined })
      .then((res: any) => {
        if (cancelled) return;
        const nextItems = Array.isArray(res?.items) ? res.items : [];
        setItems(nextItems);
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error(err?.message || '加载下游 Key 列表失败');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, range, status, toast]);

  const statusOptions = useMemo(() => [
    { value: 'all', label: '全部状态' },
    { value: 'enabled', label: '仅启用' },
    { value: 'disabled', label: '仅禁用' },
  ], []);

  const empty = !loading && items.length === 0;

  return (
    <div className="animate-fade-in" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {tr('下游 API Key')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {tr('按 Key 查看请求数、tokens 与成本趋势（24h / 7d / 全部）')}
          </div>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="toolbar-search">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={tr('搜索名称/描述')}
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <ModernSelect
              value={status}
              onChange={(value) => setStatus((value as Status) || 'all')}
              options={statusOptions}
            />
          </div>
          <button
            className="btn btn-ghost"
            style={{ border: '1px solid var(--color-border)' }}
            onClick={() => {
              setSearchInput('');
              setStatus('all');
            }}
          >
            重置
          </button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ width: '100%', height: 220, borderRadius: 'var(--radius-sm)' }} />
        ) : empty ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="empty-state-title">暂无 Key</div>
            <div className="empty-state-desc">请先在设置页创建下游 Key，或调整筛选条件</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>状态</th>
                  <th>Key</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                  <th style={{ textAlign: 'right' }}>请求数</th>
                  <th style={{ textAlign: 'right' }}>成功率</th>
                  <th style={{ textAlign: 'right' }}>成本</th>
                  <th>最近使用</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="row-selectable"
                    onClick={() => {
                      setSelectedId(row.id);
                      setDrawerOpen(true);
                    }}
                  >
                    <td style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>
                      {row.name}
                      {row.description ? (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.description}
                        </div>
                      ) : null}
                    </td>
                    <td><StatusBadge enabled={row.enabled} /></td>
                    <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace', color: 'var(--color-text-muted)' }}>
                      {row.keyMasked}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-primary)', fontWeight: 700 }}>
                      {formatCompactTokens(row.rangeUsage?.totalTokens || 0)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {(row.rangeUsage?.totalRequests || 0).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {row.rangeUsage?.successRate == null ? '—' : `${row.rangeUsage.successRate}%`}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(Number(row.rangeUsage?.totalCost || 0))}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)' }}>
                      {formatIso(row.lastUsedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={selectedItem}
        initialRange={range}
      />
    </div>
  );
}

