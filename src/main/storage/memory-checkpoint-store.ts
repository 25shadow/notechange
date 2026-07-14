import type {
  MigrationCheckpoint,
  MigrationCheckpointStore
} from '../migration/orchestrator';

export class MemoryMigrationCheckpointStore implements MigrationCheckpointStore {
  private readonly checkpoints = new Map<string, MigrationCheckpoint>();

  async get(sourceId: string): Promise<MigrationCheckpoint | null> {
    return this.checkpoints.get(sourceId) ?? null;
  }

  async save(checkpoint: MigrationCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.sourceId, { ...checkpoint });
  }
}
