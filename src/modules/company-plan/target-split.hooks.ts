import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { AgentField } from './target-split';

/**
 * A change to the people who carry targets (17 Nov, "Mid-month re-split").
 *  - joined: a new call/field agent, one reactivated, or an owner account cleared
 *  - left: deactivated, or marked as an owner account
 *  - moved: an agent moved to another Team Lead (`before` = their target row this month, read before the move)
 *  - team_moved: a Team Lead moved to another Manager
 */
export type StaffSplitEvent =
  | { kind: 'joined'; staffId: string; actorId: string; fromToday: boolean }
  | { kind: 'left'; staffId: string; actorId: string }
  | { kind: 'moved'; staffId: string; actorId: string; fromTeamLeadId: string | null; before: Partial<Record<AgentField, number | null>> | null }
  | { kind: 'team_moved'; staffId: string; actorId: string };

export interface TargetSplitHandler {
  staffChanged(event: StaffSplitEvent): Promise<void>;
  agentHandSet(staffId: string, year: number, month: number, actorId: string): Promise<void>;
}

/**
 * A small global registry so the staff and target code can tell the
 * automatic split about a change without importing it (the split depends on
 * the target module, the staff module sits under almost everything). The
 * split service registers itself at start-up. A failure here never fails the
 * staff or target change itself: it is logged, and the next split puts it right.
 */
@Injectable()
export class TargetSplitHooks {
  private readonly logger = new Logger('TargetSplitHooks');
  private handler: TargetSplitHandler | null = null;

  register(handler: TargetSplitHandler): void {
    this.handler = handler;
  }

  async staffChanged(event: StaffSplitEvent): Promise<void> {
    if (!this.handler) return;
    try {
      await this.handler.staffChanged(event);
    } catch (error) {
      this.logger.warn(`Re-split after ${event.kind} of ${event.staffId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async agentHandSet(staffId: string, year: number, month: number, actorId: string): Promise<void> {
    if (!this.handler) return;
    try {
      await this.handler.agentHandSet(staffId, year, month, actorId);
    } catch (error) {
      this.logger.warn(`Re-split after a hand-set target of ${staffId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

@Global()
@Module({ providers: [TargetSplitHooks], exports: [TargetSplitHooks] })
export class TargetSplitHooksModule {}
