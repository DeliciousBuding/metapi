import {
  db,
  schema,
  hasProxyLogBillingDetailsColumn,
  hasProxyLogClientKindColumn,
  hasProxyLogClientSessionIdColumn,
  hasProxyLogClientTraceHintColumn,
  hasProxyLogDownstreamApiKeyIdColumn,
  hasProxyLogDownstreamPathColumn,
  hasProxyLogUpstreamPathColumn,
} from '../db/index.js';

export type ProxyLogInsertInput = {
  routeId?: number | null;
  channelId?: number | null;
  accountId?: number | null;
  downstreamApiKeyId?: number | null;
  modelRequested?: string | null;
  modelActual?: string | null;
  status?: string | null;
  httpStatus?: number | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  billingDetails?: unknown;
  clientKind?: string | null;
  clientSessionId?: string | null;
  clientTraceHint?: string | null;
  downstreamPath?: string | null;
  upstreamPath?: string | null;
  errorMessage?: string | null;
  retryCount?: number | null;
  createdAt?: string | null;
};

function buildProxyLogBaseSelectFields() {
  return {
    id: schema.proxyLogs.id,
    routeId: schema.proxyLogs.routeId,
    channelId: schema.proxyLogs.channelId,
    accountId: schema.proxyLogs.accountId,
    downstreamApiKeyId: schema.proxyLogs.downstreamApiKeyId,
    clientKind: schema.proxyLogs.clientKind,
    clientSessionId: schema.proxyLogs.clientSessionId,
    clientTraceHint: schema.proxyLogs.clientTraceHint,
    downstreamPath: schema.proxyLogs.downstreamPath,
    upstreamPath: schema.proxyLogs.upstreamPath,
    modelRequested: schema.proxyLogs.modelRequested,
    modelActual: schema.proxyLogs.modelActual,
    status: schema.proxyLogs.status,
    httpStatus: schema.proxyLogs.httpStatus,
    latencyMs: schema.proxyLogs.latencyMs,
    promptTokens: schema.proxyLogs.promptTokens,
    completionTokens: schema.proxyLogs.completionTokens,
    totalTokens: schema.proxyLogs.totalTokens,
    estimatedCost: schema.proxyLogs.estimatedCost,
    errorMessage: schema.proxyLogs.errorMessage,
    retryCount: schema.proxyLogs.retryCount,
    createdAt: schema.proxyLogs.createdAt,
  };
}

export function getProxyLogBaseSelectFields() {
  return buildProxyLogBaseSelectFields();
}

export type ProxyLogSelectFields = ReturnType<typeof buildProxyLogBaseSelectFields> & {
  billingDetails?: typeof schema.proxyLogs.billingDetails;
};

export type ResolvedProxyLogSelectFields = {
  includeBillingDetails: boolean;
  fields: ProxyLogSelectFields;
};

export async function resolveProxyLogSelectFields(options?: { includeBillingDetails?: boolean }) {
  const includeBillingDetails = options?.includeBillingDetails === true
    && await hasProxyLogBillingDetailsColumn();

  return {
    includeBillingDetails,
    fields: includeBillingDetails
      ? { ...buildProxyLogBaseSelectFields(), billingDetails: schema.proxyLogs.billingDetails }
      : buildProxyLogBaseSelectFields(),
  };
}

export async function withProxyLogSelectFields<T>(
  runner: (selection: ResolvedProxyLogSelectFields) => Promise<T>,
  options?: { includeBillingDetails?: boolean },
): Promise<T> {
  const selection = await resolveProxyLogSelectFields(options);

  try {
    return await runner(selection);
  } catch (error) {
    if (selection.includeBillingDetails && isMissingBillingDetailsColumnError(error)) {
      return await runner({
        includeBillingDetails: false,
        fields: buildProxyLogBaseSelectFields(),
      });
    }
    throw error;
  }
}

export function parseProxyLogBillingDetails(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function isMissingBillingDetailsColumnError(error: unknown): boolean {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  const lowered = message.toLowerCase();
  return lowered.includes('billing_details')
    && (
      lowered.includes('does not exist')
      || lowered.includes('unknown column')
      || lowered.includes('no such column')
      || lowered.includes('has no column named')
    );
}

export function isMissingDownstreamApiKeyIdColumnError(error: unknown): boolean {
  return isMissingProxyLogColumnError(error, 'downstream_api_key_id');
}

export function isMissingClientKindColumnError(error: unknown): boolean {
  return isMissingProxyLogColumnError(error, 'client_kind');
}

export function isMissingClientSessionIdColumnError(error: unknown): boolean {
  return isMissingProxyLogColumnError(error, 'client_session_id');
}

export function isMissingClientTraceHintColumnError(error: unknown): boolean {
  return isMissingProxyLogColumnError(error, 'client_trace_hint');
}

export function isMissingDownstreamPathColumnError(error: unknown): boolean {
  return isMissingProxyLogColumnError(error, 'downstream_path');
}

export function isMissingUpstreamPathColumnError(error: unknown): boolean {
  return isMissingProxyLogColumnError(error, 'upstream_path');
}

function isMissingProxyLogColumnError(error: unknown, columnName: string): boolean {
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  const lowered = message.toLowerCase();
  return lowered.includes(columnName)
    && (
      lowered.includes('does not exist')
      || lowered.includes('unknown column')
      || lowered.includes('no such column')
      || lowered.includes('has no column named')
    );
}

export async function insertProxyLog(input: ProxyLogInsertInput): Promise<void> {
  const baseValues = {
    routeId: input.routeId ?? null,
    channelId: input.channelId ?? null,
    accountId: input.accountId ?? null,
    modelRequested: input.modelRequested ?? null,
    modelActual: input.modelActual ?? null,
    status: input.status ?? null,
    httpStatus: input.httpStatus ?? null,
    latencyMs: input.latencyMs ?? null,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
    estimatedCost: input.estimatedCost ?? 0,
    errorMessage: input.errorMessage ?? null,
    retryCount: input.retryCount ?? 0,
    createdAt: input.createdAt ?? null,
  };
  const serializedBillingDetails = input.billingDetails == null
    ? null
    : JSON.stringify(input.billingDetails);
  const includeBillingDetails = serializedBillingDetails !== null
    && await hasProxyLogBillingDetailsColumn();
  const includeDownstreamApiKeyId = input.downstreamApiKeyId != null
    && await hasProxyLogDownstreamApiKeyIdColumn();
  const includeClientKind = typeof input.clientKind === 'string' && input.clientKind.trim().length > 0
    && await hasProxyLogClientKindColumn();
  const includeClientSessionId = typeof input.clientSessionId === 'string' && input.clientSessionId.trim().length > 0
    && await hasProxyLogClientSessionIdColumn();
  const includeClientTraceHint = typeof input.clientTraceHint === 'string' && input.clientTraceHint.trim().length > 0
    && await hasProxyLogClientTraceHintColumn();
  const includeDownstreamPath = typeof input.downstreamPath === 'string' && input.downstreamPath.trim().length > 0
    && await hasProxyLogDownstreamPathColumn();
  const includeUpstreamPath = typeof input.upstreamPath === 'string' && input.upstreamPath.trim().length > 0
    && await hasProxyLogUpstreamPathColumn();

  const optionalColumns: Array<{
    key:
      | 'billingDetails'
      | 'downstreamApiKeyId'
      | 'clientKind'
      | 'clientSessionId'
      | 'clientTraceHint'
      | 'downstreamPath'
      | 'upstreamPath';
    value: unknown;
    enabled: boolean;
    isMissingError(error: unknown): boolean;
  }> = [
    {
      key: 'billingDetails',
      value: serializedBillingDetails,
      enabled: includeBillingDetails,
      isMissingError: isMissingBillingDetailsColumnError,
    },
    {
      key: 'downstreamApiKeyId',
      value: input.downstreamApiKeyId,
      enabled: includeDownstreamApiKeyId,
      isMissingError: isMissingDownstreamApiKeyIdColumnError,
    },
    {
      key: 'clientKind',
      value: input.clientKind,
      enabled: includeClientKind,
      isMissingError: isMissingClientKindColumnError,
    },
    {
      key: 'clientSessionId',
      value: input.clientSessionId,
      enabled: includeClientSessionId,
      isMissingError: isMissingClientSessionIdColumnError,
    },
    {
      key: 'clientTraceHint',
      value: input.clientTraceHint,
      enabled: includeClientTraceHint,
      isMissingError: isMissingClientTraceHintColumnError,
    },
    {
      key: 'downstreamPath',
      value: input.downstreamPath,
      enabled: includeDownstreamPath,
      isMissingError: isMissingDownstreamPathColumnError,
    },
    {
      key: 'upstreamPath',
      value: input.upstreamPath,
      enabled: includeUpstreamPath,
      isMissingError: isMissingUpstreamPathColumnError,
    },
  ];

  let activeOptionalColumns = optionalColumns.filter((column) => column.enabled);

  while (true) {
    const optionalValues = Object.fromEntries(
      activeOptionalColumns.map((column) => [column.key, column.value]),
    );
    try {
      await db.insert(schema.proxyLogs).values({
        ...baseValues,
        ...optionalValues,
      }).run();
      return;
    } catch (error) {
      const missingColumn = activeOptionalColumns.find((column) => column.isMissingError(error));
      if (!missingColumn) {
        throw error;
      }
      activeOptionalColumns = activeOptionalColumns.filter((column) => column.key !== missingColumn.key);
    }
  }
}
