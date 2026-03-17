import type { FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { isModelAllowedByPolicyOrAllowedRoutes, recordManagedKeyCostUsage } from '../../services/downstreamApiKeyService.js';
import { EMPTY_DOWNSTREAM_ROUTING_POLICY, type DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';

function normalizeClientKindHint(clientKind?: string | null): string | null {
  const normalized = String(clientKind || '').trim().toLowerCase();
  if (!normalized || normalized === 'generic') return null;
  return normalized;
}

export function getDownstreamRoutingPolicy(
  request: FastifyRequest,
  options?: { clientKind?: string | null },
): DownstreamRoutingPolicy {
  const basePolicy = getProxyAuthContext(request)?.policy || EMPTY_DOWNSTREAM_ROUTING_POLICY;
  const clientKind = normalizeClientKindHint(options?.clientKind);
  if (!clientKind) return basePolicy;
  return {
    ...basePolicy,
    clientKind,
  };
}

export async function ensureModelAllowedForDownstreamKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedModel: string,
): Promise<boolean> {
  const authContext = getProxyAuthContext(request);
  if (!authContext) return true;

  if (await isModelAllowedByPolicyOrAllowedRoutes(requestedModel, authContext.policy)) {
    return true;
  }

  reply.code(403).send({
    error: {
      message: `Model not allowed for this API key: ${requestedModel}`,
      type: 'permission_error',
    },
  });
  return false;
}

export function recordDownstreamCostUsage(request: FastifyRequest, estimatedCost: number): void {
  const authContext = getProxyAuthContext(request);
  if (!authContext || authContext.keyId === null) return;
  void recordManagedKeyCostUsage(authContext.keyId, estimatedCost);
}
