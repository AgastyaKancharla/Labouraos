/**
 * What an agent sees of a business that is not theirs (Master Guide, roles:
 * a field agent sees "all businesses on the map; full details of businesses
 * they onboarded"; a call agent reads businesses to add vacancies by phone).
 *
 * An agent who is the account agent, created the lead, or holds the open
 * verification visit for it sees the full record. Any other agent gets the
 * record with the business's registration, tax, licence and billing details
 * blanked (GST, PAN, licence and registration numbers, legal and owner names,
 * billing name, address and email, the storefront photo, signed agreements).
 * Name, place, type, opening hours, contact person, vacancies and branches stay
 * so they can find it on the map, call it through the system and add a vacancy.
 */
export const AGENT_LIMITED_ROLES = ['field_agent', 'call_agent'] as const;

export const AGENT_HIDDEN_BUSINESS_FIELDS = [
  'gstNumber',
  'gstLegalName',
  'gstStatus',
  'gstVerified',
  'gstCheckedAt',
  'pan',
  'licenceNumber',
  'shopEstablishmentNumber',
  'udyamNumber',
  'fssaiNumber',
  'legalName',
  'ownerName',
  'familyName',
  'billingName',
  'billingAddress',
  'billingEmail',
  'storefrontPhotoPath',
  'storefrontPhotoHash',
  'agreements',
] as const;

export interface AgentViewer {
  id: string;
  role: string;
  /** Businesses this agent holds an open verification visit for. */
  assignedBusinessIds?: ReadonlySet<string>;
}

export function agentSeesFullBusiness(
  business: { id: string; accountAgentId?: string | null; leadCreatedByStaffId?: string | null },
  viewer: AgentViewer,
): boolean {
  if (!(AGENT_LIMITED_ROLES as readonly string[]).includes(viewer.role)) return true;
  if (business.accountAgentId === viewer.id || business.leadCreatedByStaffId === viewer.id) return true;
  return Boolean(viewer.assignedBusinessIds?.has(business.id));
}

/** The record as this viewer may see it; `detailsLimited: true` when fields were blanked. */
export function businessForViewer<T extends { id: string; accountAgentId?: string | null; leadCreatedByStaffId?: string | null }>(
  business: T,
  viewer: AgentViewer,
): T & { detailsLimited?: true } {
  if (agentSeesFullBusiness(business, viewer)) return business;
  const limited: Record<string, unknown> = { ...business, detailsLimited: true };
  for (const field of AGENT_HIDDEN_BUSINESS_FIELDS) {
    if (field in limited) limited[field] = field === 'agreements' ? [] : null;
  }
  return limited as T & { detailsLimited: true };
}

type VisitReader = {
  visitAssignment: { findMany(args: { where: { assignedStaffId: string; status: string }; select: { businessId: true } }): Promise<Array<{ businessId: string }>> };
};

/**
 * M2: who is looking, for the agent view. Field and call agents see full details
 * only of businesses they hold (account agent, lead creator, open verification
 * visit). Shared by the businesses API and every screen that shows a business.
 */
export async function agentViewerFor(db: VisitReader, staffId: string, role: string): Promise<AgentViewer> {
  if (!(AGENT_LIMITED_ROLES as readonly string[]).includes(role)) return { id: staffId, role };
  const visits = await db.visitAssignment.findMany({
    where: { assignedStaffId: staffId, status: 'assigned' },
    select: { businessId: true },
  });
  return { id: staffId, role, assignedBusinessIds: new Set(visits.map((v) => v.businessId)) };
}

/**
 * A business-name search for an agent matches the hidden names (legal or owner name)
 * only on businesses they hold, so a search can't reveal them.
 */
export function heldByAgent(viewer: AgentViewer): Record<string, unknown> | null {
  if (!(AGENT_LIMITED_ROLES as readonly string[]).includes(viewer.role)) return null;
  return {
    OR: [
      { accountAgentId: viewer.id },
      { leadCreatedByStaffId: viewer.id },
      ...(viewer.assignedBusinessIds?.size ? [{ id: { in: [...viewer.assignedBusinessIds] } }] : []),
    ],
  };
}
