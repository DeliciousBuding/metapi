import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import DownstreamKeys from './DownstreamKeys.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getDownstreamApiKeysSummary: vi.fn(),
    getDownstreamApiKeyOverview: vi.fn(),
    getDownstreamApiKeyTrend: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: unknown) => node,
  };
});

vi.mock('../components/useAnimatedVisibility.js', () => ({
  useAnimatedVisibility: (open: boolean) => ({
    shouldRender: open,
    isVisible: open,
  }),
}));

vi.mock('../components/charts/DownstreamKeyTrendChart.js', () => ({
  default: ({ buckets }: { buckets: Array<{ totalTokens: number }> }) => (
    <div data-testid="downstream-trend-chart">{`trend:${buckets.length}`}</div>
  ),
}));

vi.mock('../components/ModernSelect.js', () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buildSummaryItem(overrides?: Partial<any>) {
  return {
    id: 1,
    name: 'smoke-key',
    keyMasked: 'sk-s****0315',
    enabled: true,
    description: 'local smoke',
    expiresAt: null,
    maxCost: null,
    usedCost: 0,
    maxRequests: null,
    usedRequests: 0,
    supportedModels: [],
    allowedRouteIds: [],
    siteWeightMultipliers: {},
    lastUsedAt: null,
    createdAt: '2026-03-15T08:27:25.378Z',
    updatedAt: '2026-03-15T08:27:25.378Z',
    rangeUsage: {
      totalRequests: 3,
      successRequests: 2,
      failedRequests: 1,
      successRate: 66.7,
      totalTokens: 4200,
      totalCost: 0.42,
    },
    ...overrides,
  };
}

describe('DownstreamKeys page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).document = { body: {} };
    apiMock.getDownstreamApiKeysSummary.mockResolvedValue({
      success: true,
      items: [buildSummaryItem()],
    });
    apiMock.getDownstreamApiKeyOverview.mockResolvedValue({
      success: true,
      item: buildSummaryItem(),
      usage: {
        last24h: { totalRequests: 3, successRequests: 2, failedRequests: 1, successRate: 66.7, totalTokens: 4200, totalCost: 0.42 },
        last7d: { totalRequests: 9, successRequests: 8, failedRequests: 1, successRate: 88.9, totalTokens: 12400, totalCost: 1.24 },
        all: { totalRequests: 20, successRequests: 18, failedRequests: 2, successRate: 90, totalTokens: 55200, totalCost: 5.52 },
      },
    });
    apiMock.getDownstreamApiKeyTrend.mockResolvedValue({
      success: true,
      buckets: [
        { startUtc: '2026-03-15T08:00:00.000Z', totalRequests: 2, totalTokens: 1200, totalCost: 0.12, successRate: 100 },
        { startUtc: '2026-03-15T09:00:00.000Z', totalRequests: 1, totalTokens: 3000, totalCost: 0.3, successRate: 0 },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).document;
  });

  it('loads summary rows and renders range usage data', async () => {
    let root: ReturnType<typeof create> | null = null;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/downstream-keys']}>
            <ToastProvider>
              <DownstreamKeys />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getDownstreamApiKeysSummary).toHaveBeenCalledWith({
        range: '24h',
        status: 'all',
        search: undefined,
      });

      const text = collectText(root!.root);
      expect(text).toContain('smoke-key');
      expect(text).toContain('sk-s****0315');
      expect(text).toContain('4.2K');
      expect(text).toContain('$0.420000');
    } finally {
      root?.unmount();
    }
  });

  it('re-queries summary when search and status change', async () => {
    let root: ReturnType<typeof create> | null = null;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/downstream-keys']}>
            <ToastProvider>
              <DownstreamKeys />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const input = root!.root.findAllByType('input')[0];
      await act(async () => {
        input.props.onChange({ target: { value: 'smoke' } });
      });
      await flushMicrotasks();

      const select = root!.root.findByType('select');
      await act(async () => {
        select.props.onChange({ target: { value: 'enabled' } });
      });
      await flushMicrotasks();

      expect(apiMock.getDownstreamApiKeysSummary).toHaveBeenLastCalledWith({
        range: '24h',
        status: 'enabled',
        search: 'smoke',
      });
    } finally {
      root?.unmount();
    }
  });

  it('opens drawer and loads overview plus trend for selected key', async () => {
    let root: ReturnType<typeof create> | null = null;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/downstream-keys']}>
            <ToastProvider>
              <DownstreamKeys />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root!.root.findAll((node) => (
        node.type === 'tr'
        && typeof node.props.onClick === 'function'
      ))[0];

      await act(async () => {
        row.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getDownstreamApiKeyOverview).toHaveBeenCalledWith(1);
      expect(apiMock.getDownstreamApiKeyTrend).toHaveBeenCalledWith(1, { range: '24h' });

      const buttons = root!.root.findAll((node) => node.type === 'button');
      const trendToggle = buttons.find((button) => collectText(button) === '7d');
      expect(trendToggle).toBeTruthy();

      await act(async () => {
        trendToggle!.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getDownstreamApiKeyTrend).toHaveBeenLastCalledWith(1, { range: '7d' });

      const text = collectText(root!.root);
      expect(text).toContain('smoke-key');
      expect(text).toContain('trend:2');
      expect(text).toContain('24h');
      expect(text).toContain('7d');
    } finally {
      root?.unmount();
    }
  });
});
