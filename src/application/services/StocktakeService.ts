import Database from 'better-sqlite3';
import { StocktakeRepository } from '../../infrastructure/sqlite/repositories/StocktakeRepository';
import {
  Stocktake,
  StocktakeLine,
  StocktakePolicy,
  CreateStocktakeDto,
  RecordStocktakeCountDto,
  ResolveStocktakeLineDto,
  StocktakeFilter,
  StocktakeSummaryReport
} from '../../shared/types/stocktake';
import { StocktakeRules, StocktakeSecurityError } from '../../domain/inventory/stocktake-rules';

export interface ActorContext {
  userId: string | number;
  role: string;
  businessId?: string;
  branchId?: string;
  overrideLocationFreeze?: boolean;
}

export class StocktakeService {
  private repo: StocktakeRepository;

  constructor(private db: Database.Database) {
    this.repo = new StocktakeRepository(db);
  }

  /**
   * Evaluates if actor has supervisor/manager/owner privileges.
   */
  private isSupervisorOrAbove(role?: string): boolean {
    if (!role) return false;
    const elevated = ['owner', 'admin', 'manager', 'supervisor', 'OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR'];
    return elevated.includes(role);
  }

  /**
   * 1. Create Stocktake
   */
  public createStocktake(dto: CreateStocktakeDto, actor: ActorContext): Stocktake {
    const bizId = actor.businessId || dto.businessId || '00000000-0000-0000-0000-000000000001';
    const branchId = actor.branchId || dto.branchId || '00000000-0000-0000-0000-000000000002';

    // Verify if location is already frozen by another active stocktake
    if (dto.freezeStock) {
      const existing = this.repo.findActiveFrozenStocktake(dto.stockLocationId);
      if (existing) {
        throw new Error(
          `Location is already frozen by active Stocktake #${existing.stocktake_number}. Cannot freeze multiple times.`
        );
      }
    }

    const created = this.repo.createStocktake(
      {
        ...dto,
        businessId: bizId,
        branchId
      },
      String(actor.userId)
    );

    return this.maskStocktakeForActor(created, actor);
  }

  /**
   * 2. Start Stocktake
   */
  public startStocktake(stocktakeId: string, actor: ActorContext): Stocktake {
    this.repo.startStocktake(stocktakeId);
    return this.getStocktakeById(stocktakeId, actor)!;
  }

  /**
   * 3. Enter/Scan Counts
   */
  public recordCount(dto: RecordStocktakeCountDto, actor: ActorContext): StocktakeLine {
    const line = this.repo.recordCount(dto, String(actor.userId));
    const st = this.repo.getStocktakeById(dto.stocktakeId);

    const isAuthorized = this.isSupervisorOrAbove(actor.role);
    return StocktakeRules.maskBlindLineData(line, st?.countingMode || 'blind', isAuthorized);
  }

  /**
   * 4. Resolve Discrepancy (Recount Acceptance, Supervisor Override, Abandon)
   */
  public resolveDiscrepancy(dto: ResolveStocktakeLineDto, actor: ActorContext): StocktakeLine {
    if (!this.isSupervisorOrAbove(actor.role)) {
      throw new StocktakeSecurityError('Resolving stock discrepancies requires supervisor or manager role.');
    }

    const line = this.repo.resolveDiscrepancy(dto, String(actor.userId));
    const st = this.repo.getStocktakeById(dto.stocktakeId);
    return StocktakeRules.maskBlindLineData(line, st?.countingMode || 'blind', true);
  }

  /**
   * 5. Submit Counts
   */
  public submitCounts(stocktakeId: string, actor: ActorContext): Stocktake {
    this.repo.submitCounts(stocktakeId, String(actor.userId));
    return this.getStocktakeById(stocktakeId, actor)!;
  }

  /**
   * 6. Move to Review State
   */
  public reviewStocktake(stocktakeId: string, actor: ActorContext): Stocktake {
    if (!this.isSupervisorOrAbove(actor.role)) {
      throw new StocktakeSecurityError('Reviewing stocktakes requires supervisor or manager role.');
    }
    this.repo.reviewStocktake(stocktakeId);
    return this.getStocktakeById(stocktakeId, actor)!;
  }

  /**
   * 7. Approve Stocktake
   */
  public approveStocktake(stocktakeId: string, actor: ActorContext): Stocktake {
    if (!this.isSupervisorOrAbove(actor.role)) {
      throw new StocktakeSecurityError('Approving stocktakes requires supervisor, manager, or owner role.');
    }
    this.repo.approveStocktake(stocktakeId, String(actor.userId));
    return this.getStocktakeById(stocktakeId, actor)!;
  }

  /**
   * 8. Post Stocktake
   */
  public postStocktake(stocktakeId: string, actor: ActorContext): Stocktake {
    if (!this.isSupervisorOrAbove(actor.role)) {
      throw new StocktakeSecurityError('Posting stocktakes requires manager or owner privileges.');
    }

    const posted = this.repo.postStocktake(stocktakeId, String(actor.userId));
    return this.maskStocktakeForActor(posted, actor);
  }

  /**
   * 9. Cancel Stocktake
   */
  public cancelStocktake(stocktakeId: string, reason: string, actor: ActorContext): Stocktake {
    if (!this.isSupervisorOrAbove(actor.role)) {
      throw new StocktakeSecurityError('Cancelling a stocktake requires manager or supervisor role.');
    }
    this.repo.cancelStocktake(stocktakeId, reason);
    return this.getStocktakeById(stocktakeId, actor)!;
  }

  /**
   * 10. Get Stocktake Details (Enforces Server-Side Blind Masking)
   */
  public getStocktakeById(id: string, actor: ActorContext): Stocktake | null {
    const st = this.repo.getStocktakeById(id);
    if (!st) return null;

    return this.maskStocktakeForActor(st, actor);
  }

  /**
   * Masks sensitive fields when blind counting is active and user is not an authorized reviewer.
   */
  private maskStocktakeForActor(st: Stocktake, actor: ActorContext): Stocktake {
    // If visible mode, no masking
    if (st.countingMode !== 'blind') {
      return st;
    }

    // In blind mode, if user is supervisor/manager/owner AND status is review/approved/posted, allow full view
    const isElevated = this.isSupervisorOrAbove(actor.role);
    const isReviewOrLater = ['review', 'approved', 'posted'].includes(st.status);
    if (isElevated && isReviewOrLater) {
      return st;
    }

    // Mask lines
    const maskedLines = (st.lines || []).map((line) =>
      StocktakeRules.maskBlindLineData(line, 'blind', false)
    );

    return {
      ...st,
      discrepancyLinesCount: undefined,
      lines: maskedLines
    };
  }

  /**
   * 11. List Stocktakes
   */
  public listStocktakes(filter: StocktakeFilter, actor: ActorContext): Stocktake[] {
    const list = this.repo.listStocktakes(filter);
    const isElevated = this.isSupervisorOrAbove(actor.role);

    return list.map((st) => {
      if (st.countingMode === 'blind' && !isElevated) {
        return {
          ...st,
          discrepancyLinesCount: undefined
        };
      }
      return st;
    });
  }

  /**
   * 12. Generate Stocktake Report
   */
  public getStocktakeReport(stocktakeId: string, actor: ActorContext): StocktakeSummaryReport {
    const isElevated = this.isSupervisorOrAbove(actor.role);
    const st = this.repo.getStocktakeById(stocktakeId);
    if (!st) throw new Error(`Stocktake ${stocktakeId} not found.`);

    if (st.countingMode === 'blind' && !isElevated && !['review', 'approved', 'posted'].includes(st.status)) {
      throw new StocktakeSecurityError('Stocktake reports cannot be viewed while counting is blind and in-progress.');
    }

    return this.repo.generateStocktakeReport(stocktakeId);
  }

  /**
   * 13. Policy Management
   */
  public getPolicy(businessId: string): StocktakePolicy {
    return this.repo.getPolicy(businessId);
  }

  public updatePolicy(businessId: string, policy: Partial<StocktakePolicy>, actor: ActorContext): StocktakePolicy {
    if (!this.isSupervisorOrAbove(actor.role)) {
      throw new StocktakeSecurityError('Updating stocktake discrepancy policies requires manager or owner role.');
    }
    return this.repo.updatePolicy(businessId, policy);
  }

  /**
   * 14. Location Freeze Check Helper
   */
  public checkLocationFreeze(stockLocationId: string): {
    isFrozen: boolean;
    stocktakeNumber?: string;
    stocktakeId?: string;
  } {
    const active = this.repo.findActiveFrozenStocktake(stockLocationId);
    if (active) {
      return {
        isFrozen: true,
        stocktakeNumber: active.stocktake_number,
        stocktakeId: active.id
      };
    }
    return { isFrozen: false };
  }
}

