import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelPriorityOrchestrator, type ChannelPerformanceMetrics } from './channelPriorityOrchestrator.js';

type DbModule = typeof import('../db/index.js');
type SchemaModule = typeof import('../db/schema.js');

describe('ChannelPriorityOrchestrator', () => {
  let db: DbModule['db'];
  let schema: SchemaModule['schema'];
  let orchestrator: ChannelPriorityOrchestrator;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-priority-orchestration-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const schemaModule = await import('../db/schema.js');
    db = dbModule.db;
    schema = schemaModule.schema;
    orchestrator = new ChannelPriorityOrchestrator();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  describe('calculatePerformanceScore', () => {
    it('gives high score to channel with 100% success rate and low latency', () => {
      const metrics: ChannelPerformanceMetrics = {
        channelId: 1,
        routeId: 1,
        priority: 0,
        successCount: 100,
        failCount: 0,
        totalLatencyMs: 5000, // 50ms average
        totalCost: 10,
        lastFailAt: null,
        lastSelectedAt: null,
        manualOverride: false,
        enabled: true,
      };

      const score = orchestrator.calculatePerformanceScore(metrics);
      expect(score.score).toBeGreaterThan(0.8);
      expect(score.successRate).toBe(1);
      expect(score.avgLatency).toBe(50);
      expect(score.stability).toBe(1);
    });

    it('gives low score to channel with high failure rate', () => {
      const metrics: ChannelPerformanceMetrics = {
        channelId: 2,
        routeId: 1,
        priority: 0,
        successCount: 50,
        failCount: 50,
        totalLatencyMs: 10000,
        totalCost: 50,
        lastFailAt: null,
        lastSelectedAt: null,
        manualOverride: false,
        enabled: true,
      };

      const score = orchestrator.calculatePerformanceScore(metrics);
      expect(score.score).toBeLessThan(0.5);
      expect(score.successRate).toBe(0.5);
      expect(score.stability).toBeLessThan(1);
    });

    it('penalizes channels with recent failures', () => {
      const recentFailTime = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago
      const metrics: ChannelPerformanceMetrics = {
        channelId: 3,
        routeId: 1,
        priority: 0,
        successCount: 100,
        failCount: 0,
        totalLatencyMs: 5000,
        totalCost: 10,
        lastFailAt: recentFailTime,
        lastSelectedAt: null,
        manualOverride: false,
        enabled: true,
      };

      const score = orchestrator.calculatePerformanceScore(metrics);
      expect(score.stability).toBe(0.5);
      expect(score.score).toBeLessThan(0.8);
    });

    it('handles channels with no requests', () => {
      const metrics: ChannelPerformanceMetrics = {
        channelId: 4,
        routeId: 1,
        priority: 0,
        successCount: 0,
        failCount: 0,
        totalLatencyMs: 0,
        totalCost: 0,
        lastFailAt: null,
        lastSelectedAt: null,
        manualOverride: false,
        enabled: true,
      };

      const score = orchestrator.calculatePerformanceScore(metrics);
      expect(score.successRate).toBe(0);
      expect(score.avgLatency).toBe(0);
      expect(score.avgCost).toBe(0);
    });
  });

  describe('scoreToPriority', () => {
    it('assigns priority 0 (top tier) for scores > 0.8', () => {
      expect(orchestrator.scoreToPriority(0.9)).toBe(0);
      expect(orchestrator.scoreToPriority(0.85)).toBe(0);
    });

    it('assigns priority 1 (excellent) for scores 0.6-0.8', () => {
      expect(orchestrator.scoreToPriority(0.7)).toBe(1);
      expect(orchestrator.scoreToPriority(0.65)).toBe(1);
    });

    it('assigns priority 2 (good) for scores 0.4-0.6', () => {
      expect(orchestrator.scoreToPriority(0.5)).toBe(2);
      expect(orchestrator.scoreToPriority(0.45)).toBe(2);
    });

    it('assigns priority 3 (average) for scores 0.2-0.4', () => {
      expect(orchestrator.scoreToPriority(0.3)).toBe(3);
      expect(orchestrator.scoreToPriority(0.25)).toBe(3);
    });

    it('assigns priority 4 (poor) for scores < 0.2', () => {
      expect(orchestrator.scoreToPriority(0.1)).toBe(4);
      expect(orchestrator.scoreToPriority(0)).toBe(4);
    });
  });

  describe('orchestrateChannelPriorities', () => {
    let routeId: number;

    beforeEach(async () => {
      await db.delete(schema.routeChannels).run();
      await db.delete(schema.tokenRoutes).run();
      await db.delete(schema.accountTokens).run();
      await db.delete(schema.accounts).run();
      await db.delete(schema.sites).run();

      // Create test data
      const route = await db.insert(schema.tokenRoutes).values({
        modelPattern: 'test-model',
        enabled: true,
      }).returning().get();
      routeId = route.id;

      const site = await db.insert(schema.sites).values({
        name: 'test-site',
        url: 'https://test.example.com',
        platform: 'new-api',
        status: 'active',
      }).returning().get();

      const account = await db.insert(schema.accounts).values({
        siteId: site.id,
        username: 'test-user',
        status: 'active',
      }).returning().get();

      const token = await db.insert(schema.accountTokens).values({
        accountId: account.id,
        name: 'test-token',
        token: 'test-token-value',
        enabled: true,
        isDefault: false,
      }).returning().get();

      // Create channels with different performance
      await db.insert(schema.routeChannels).values([
        {
          routeId: route.id,
          accountId: account.id,
          tokenId: token.id,
          priority: 2,
          weight: 10,
          enabled: true,
          manualOverride: false,
          successCount: 100,
          failCount: 0,
          totalLatencyMs: 5000,
          totalCost: 10,
        },
        {
          routeId: route.id,
          accountId: account.id,
          tokenId: token.id,
          priority: 2,
          weight: 10,
          enabled: true,
          manualOverride: false,
          successCount: 50,
          failCount: 50,
          totalLatencyMs: 10000,
          totalCost: 50,
        },
        {
          routeId: route.id,
          accountId: account.id,
          tokenId: token.id,
          priority: 2,
          weight: 10,
          enabled: true,
          manualOverride: true, // Should be skipped
          successCount: 80,
          failCount: 20,
          totalLatencyMs: 8000,
          totalCost: 30,
        },
      ]).run();
    });

    it('adjusts priorities based on performance', async () => {
      const result = await orchestrator.orchestrateChannelPriorities(routeId);

      // Should have adjusted 2 channels (one with manualOverride skipped)
      expect(result.adjusted.length).toBe(2);

      // High performance channel should have priority 0
      const highPerfChannel = result.adjusted.find((c) => c.oldPriority === 2 && c.score > 0.8);
      expect(highPerfChannel).toBeDefined();
      expect(highPerfChannel!.newPriority).toBe(0);

      // Low performance channel should have priority 3 or 4
      const lowPerfChannel = result.adjusted.find((c) => c.oldPriority === 2 && c.score < 0.5);
      expect(lowPerfChannel).toBeDefined();
      expect(lowPerfChannel!.newPriority).toBeGreaterThanOrEqual(3);

      // Manual override channel should be skipped
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0].reason).toContain('Manual override');
    });

    it('skips disabled channels', async () => {
      await db.update(schema.routeChannels)
        .set({ enabled: false })
        .where(schema.routeChannels.successCount === 100)
        .run();

      const result = await orchestrator.orchestrateChannelPriorities(routeId);

      const disabledSkipped = result.skipped.find((s) => s.reason.includes('disabled'));
      expect(disabledSkipped).toBeDefined();
    });

    it('skips channels with insufficient data', async () => {
      await db.update(schema.routeChannels)
        .set({ successCount: 5, failCount: 2 })
        .where(schema.routeChannels.successCount === 100)
        .run();

      const result = await orchestrator.orchestrateChannelPriorities(routeId);

      const insufficientSkipped = result.skipped.find((s) => s.reason.includes('Insufficient data'));
      expect(insufficientSkipped).toBeDefined();
    });

    it('does not change priority if already optimal', async () => {
      // Set priority to 0 for high-perf channel
      await db.update(schema.routeChannels)
        .set({ priority: 0 })
        .where(schema.routeChannels.successCount === 100)
        .run();

      const result = await orchestrator.orchestrateChannelPriorities(routeId);

      // Should have fewer adjustments
      expect(result.adjusted.length).toBe(1);
    });
  });
});