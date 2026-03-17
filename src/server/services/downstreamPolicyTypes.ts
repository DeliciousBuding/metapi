export interface DownstreamRoutingPolicy {
  supportedModels: string[];
  allowedRouteIds: number[];
  siteWeightMultipliers: Record<number, number>;
  // runtime hint only: not persisted to db/export.
  clientKind?: string | null;
}

export const EMPTY_DOWNSTREAM_ROUTING_POLICY: DownstreamRoutingPolicy = {
  supportedModels: [],
  allowedRouteIds: [],
  siteWeightMultipliers: {},
};
