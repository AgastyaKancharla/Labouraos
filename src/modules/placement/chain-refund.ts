import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * M4 (Master Guide rev 178): a 100% business refund returns the first
 * placement's fee and every salary-difference fee (D3) paid in the same
 * replacement chain. Each part keeps its own GST beside it, for the credit
 * note. The refund amount itself follows the existing rule — fees only; the
 * GST stays owed until the CA answers (lawyer/CA list, "Credit notes on
 * business refunds") — so `feePaise` is what is refunded today.
 */
export interface ChainRefundPart {
  placementId: string;
  kind: 'placement_fee' | 'salary_difference';
  feePaise: number;
  gstPaise: number;
}

export interface ChainRefund {
  parts: ChainRefundPart[];
  feePaise: number;
  gstPaise: number;
}

type Client = PrismaService | Prisma.TransactionClient;

/** The refund of each chain, by its first (root) placement id. */
export async function chainRefundsByRoot(client: Client, rootIds: string[]): Promise<Map<string, ChainRefund>> {
  const ids = [...new Set(rootIds.filter(Boolean))];
  const out = new Map<string, ChainRefund>();
  if (!ids.length) return out;
  const rows = await client.placement.findMany({
    where: {
      OR: [
        { id: { in: ids } },
        // A paid salary difference; a cancelled replacement (M2) never paid one.
        { rootPlacementId: { in: ids }, salaryUpgradeDifferencePaise: { not: null }, paidAt: { not: null }, status: { not: 'cancelled' } },
      ],
    },
    select: { id: true, rootPlacementId: true, placementFee: true, gstAmount: true },
  });
  for (const row of rows) {
    const rootId = row.rootPlacementId ?? row.id;
    const refund = out.get(rootId) ?? { parts: [], feePaise: 0, gstPaise: 0 };
    refund.parts.push({ placementId: row.id, kind: row.rootPlacementId ? 'salary_difference' : 'placement_fee', feePaise: row.placementFee, gstPaise: row.gstAmount });
    refund.feePaise += row.placementFee;
    refund.gstPaise += row.gstAmount;
    out.set(rootId, refund);
  }
  // The first placement's fee first, then the differences.
  for (const refund of out.values()) refund.parts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'placement_fee' ? -1 : 1));
  return out;
}

export async function chainRefundOf(client: Client, rootId: string): Promise<ChainRefund> {
  return (await chainRefundsByRoot(client, [rootId])).get(rootId) ?? { parts: [], feePaise: 0, gstPaise: 0 };
}
