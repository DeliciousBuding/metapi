import { db, schema } from '../db/index.js';
import { and, eq, gt, isNull, lte, not, sql } from 'drizzle-orm';

export interface ChannelPerformanceMetrics {
  channelId: number;
  routeId: number;
  priority: number;
  successCount: number;
  failCount: number;
  totalLatencyMs: number;
  totalCost: number;
  lastFailAt: string | null;
  lastSelectedAt: string | null;
  manualOverride: boolean;
  enabled: boolean;
}

export interface PerformanceScore {
  channelId: number;
  score: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;
  stability: number;
}

export interface PriorityOrchestrationResult {
  adjusted: Array<{
    channelId: number;
    oldPriority: number;
    newPriority: number;
    score: number;
  }>;
  skipped: Array<{
    channelId: number;
    reason: string;
  }>;
}

export class ChannelPriorityOrchestrator {
  /**
   * Calculate performance score for a channel
   * Score ranges from 0 to 1, higher is better
   */
  calculatePerformanceScore(metrics: ChannelPerformanceMetrics): PerformanceScore {
    const totalRequests = metrics.successCount + metrics.failCount;

    // Success rate (weight: 40%)
    const successRate = totalRequests > 0 ? metrics.successCount / totalRequests : 0;

    // Average latency (weight: 20%) - normalized to 0-1
    // Assuming reasonable latency range: 0ms - 10000ms
    const avgLatency = metrics.successCount > 0 ? metrics.totalLatencyMs / metrics.successCount : 0;
    const latencyScore = Math.max(0, 1 - avgLatency / 10000);

    // Average cost (weight: 15%) - normalized to 0-1
    // Assuming reasonable cost range: 0 - 2 per request
    const avgCost = metrics.successCount > 0 ? metrics.totalCost / metrics.successCount : 0;
    const costScore = Math.max(0, 1 - avgCost / 2);

    // Stability (weight: 15%)
    const nowMs = Date.now();
    let stabilityScore = 1;

    // Recent failures reduce stability
    if (metrics.lastFailAt) {
      const lastFailMs = new Date(metrics.lastFailAt).getTime();
      const minutesSinceFail = (nowMs - lastFailMs) / 60000;

      // Within last 5 minutes: major penalty
      if (minutesSinceFail < 5) {
        stabilityScore = 0.5;
      }
      // Within last 30 minutes: moderate penalty
      else if (minutesSinceFail < 30) {
        stabilityScore = 0.7;
      }
      // Within last 2 hours: minor penalty
      else if (minutesSinceFail < 120) {
        stabilityScore = 0.9;
      }
    }

    // High failure rate also reduces stability
    const failureRate = totalRequests > 0 ? metrics.failCount / totalRequests : 0;
    if (failureRate > 0.3) {
      stabilityScore *= 0.5;
    } else if (failureRate > 0.1) {
      stabilityScore *= 0.8;
    }

    // Composite score with stability cap
    // Success rate (weight: 50%) - most important factor
    // Latency (weight: 20%)
    // Cost (weight: 15%)
    // Stability (weight: 15%)

    // Stability problems severely limit the maximum score
    // A channel with recent failures or high failure rate cannot be trusted
    let score = successRate * 0.5 + latencyScore * 0.2 + costScore * 0.15 + stabilityScore * 0.15;

    // Cap the score based on stability and failure rate
    if (failureRate > 0.3) {
      // Very high failure rate: severe penalty
      score = Math.min(score, 0.35);
    } else if (stabilityScore <= 0.5) {
      // Recent failure within 5 minutes
      score = Math.min(score, 0.6);
    } else if (stabilityScore <= 0.7) {
      // Recent failure within 30 minutes
      score = Math.min(score, 0.75);
    }

    return {
      channelId: metrics.channelId,
      score: Math.max(0, Math.min(1, score)),
      successRate,
      avgLatency,
      avgCost,
      stability: stabilityScore,
    };
  }

  /**
   * Determine priority level from performance score
   * Priority 0 is highest, 4 is lowest
   */
  scoreToPriority(score: number): number {
    if (score > 0.8) return 0; // Top tier
    if (score > 0.6) return 1; // Excellent
    if (score > 0.4) return 2; // Good
    if (score > 0.2) return 3; // Average
    return 4; // Poor
  }

  /**
   * Orchestrate channel priorities for all routes or a specific route
   */
  async orchestrateChannelPriorities(routeId?: number): Promise<PriorityOrchestrationResult> {
    const result: PriorityOrchestrationResult = {
      adjusted: [],
      skipped: [],
    };

    // Load all channels with performance metrics
    const whereClause = routeId
      ? eq(schema.routeChannels.routeId, routeId)
      : undefined;

    const channels = await db
      .select()
      .from(schema.routeChannels)
      .where(whereClause)
      .all();

    if (channels.length === 0) {
      return result;
    }

    // Group channels by route
    const channelsByRoute = new Map<number, typeof schema.routeChannels.$inferSelect[]>();
    for (const channel of channels) {
      const routeIdKey = channel.routeId;
      if (!channelsByRoute.has(routeIdKey)) {
        channelsByRoute.set(routeIdKey, []);
      }
      channelsByRoute.get(routeIdKey)!.push(channel);
    }

    // Process each route separately
    for (const [routeIdKey, routeChannels] of channelsByRoute) {
      const routeResult = await this.orchestrateRoutePriorities(routeIdKey, routeChannels);
      result.adjusted.push(...routeResult.adjusted);
      result.skipped.push(...routeResult.skipped);
    }

    return result;
  }

  /**
   * Orchestrate priorities for channels within a single route
   */
  private async orchestrateRoutePriorities(
    routeId: number,
    channels: typeof schema.routeChannels.$inferSelect[]
  ): Promise<PriorityOrchestrationResult> {
    const result: PriorityOrchestrationResult = {
      adjusted: [],
      skipped: [],
    };

    // Calculate performance scores for all channels
    const scores: PerformanceScore[] = [];
    const eligibleChannels: typeof schema.routeChannels.$inferSelect[] = [];

    for (const channel of channels) {
      // Skip disabled channels
      if (!channel.enabled) {
        result.skipped.push({
          channelId: channel.id,
          reason: 'Channel disabled',
        });
        continue;
      }

      // Skip manually overridden channels
      if (channel.manualOverride) {
        result.skipped.push({
          channelId: channel.id,
          reason: 'Manual override set',
        });
        continue;
      }

      // Skip channels with insufficient data (less than 10 requests)
      const totalRequests = (channel.successCount || 0) + (channel.failCount || 0);
      if (totalRequests < 10) {
        result.skipped.push({
          channelId: channel.id,
          reason: 'Insufficient data (less than 10 requests)',
        });
        continue;
      }

      eligibleChannels.push(channel);

      const metrics: ChannelPerformanceMetrics = {
        channelId: channel.id,
        routeId: channel.routeId,
        priority: channel.priority || 0,
        successCount: channel.successCount || 0,
        failCount: channel.failCount || 0,
        totalLatencyMs: channel.totalLatencyMs || 0,
        totalCost: channel.totalCost || 0,
        lastFailAt: channel.lastFailAt || null,
        lastSelectedAt: channel.lastSelectedAt || null,
        manualOverride: channel.manualOverride || false,
        enabled: channel.enabled || false,
      };

      scores.push(this.calculatePerformanceScore(metrics));
    }

    if (eligibleChannels.length === 0) {
      return result;
    }

    // Sort channels by performance score (highest first)
    scores.sort((a, b) => b.score - a.score);

    // Assign priorities based on performance score
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      const channel = eligibleChannels.find((c) => c.id === score.channelId)!;

      const newPriority = this.scoreToPriority(score.score);
      const oldPriority = channel.priority || 0;

      // Only update if priority changes
      if (newPriority !== oldPriority) {
        await db
          .update(schema.routeChannels)
          .set({ priority: newPriority })
          .where(eq(schema.routeChannels.id, channel.id))
          .run();

        result.adjusted.push({
          channelId: channel.id,
          oldPriority,
          newPriority,
          score: score.score,
        });
      } else {
        result.skipped.push({
          channelId: channel.id,
          reason: `Priority unchanged (${oldPriority})`,
        });
      }
    }

    return result;
  }

  /**
   * Get performance summary for a route's channels
   */
  async getRoutePerformanceSummary(routeId: number): Promise<PerformanceScore[]> {
    const channels = await db
      .select()
      .from(schema.routeChannels)
      .where(eq(schema.routeChannels.routeId, routeId))
      .all();

    return channels.map((channel) => {
      const metrics: ChannelPerformanceMetrics = {
        channelId: channel.id,
        routeId: channel.routeId,
        priority: channel.priority || 0,
        successCount: channel.successCount || 0,
        failCount: channel.failCount || 0,
        totalLatencyMs: channel.totalLatencyMs || 0,
        totalCost: channel.totalCost || 0,
        lastFailAt: channel.lastFailAt || null,
        lastSelectedAt: channel.lastSelectedAt || null,
        manualOverride: channel.manualOverride || false,
        enabled: channel.enabled || false,
      };

      return this.calculatePerformanceScore(metrics);
    });
  }
}

export const channelPriorityOrchestrator = new ChannelPriorityOrchestrator();