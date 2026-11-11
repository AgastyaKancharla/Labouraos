import { LinkTabs } from '../../../components/Tabs';
import { useScreenPath } from '../../../portals/PortalContext';

/** The sub-tabs the designs show on Businesses, Placements and Payments. */
export function BusinessTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Businesses"
      items={[
        { to: to('C-Businesses'), label: 'All businesses' },
        { to: to('C-Biz-Pending'), label: 'Waiting for visit or approval' },
        { to: to('C-Introductions'), label: 'Introductions register' },
      ]}
    />
  );
}

export function PlacementTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Placements"
      items={[
        { to: to('C-Placements'), label: 'Placements' },
        { to: to('C-Claims'), label: 'Replacement claims' },
        { to: to('C-Checkins'), label: 'Joining & check-ins' },
      ]}
    />
  );
}

export function PaymentTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Payments"
      items={[
        { to: to('C-Payments'), label: 'Money in' },
        { to: to('C-Payments-Out'), label: 'Money out' },
        { to: to('C-Payments-GST'), label: 'GST & invoices' },
      ]}
    />
  );
}

export function TeamTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Team & access"
      items={[
        { to: to('C-Team'), label: 'Staff & roles' },
        { to: to('C-Teams'), label: 'Teams' },
        { to: to('C-Team-Salaries'), label: 'Salaries' },
        { to: to('C-Team-Devices'), label: 'Devices & logins' },
      ]}
    />
  );
}

export function AttendanceTabs({ personId }: { personId?: string }) {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Attendance"
      items={[
        { to: to('C-Team-Attendance'), label: 'Today', end: true },
        { to: to('C-Att-Live'), label: 'Live board' },
        { to: to('C-Team-Leave'), label: 'Leave & corrections' },
        ...(personId ? [{ to: to('C-Att-Person', { staffId: personId }), label: "One person's report" }] : []),
      ]}
    />
  );
}

export function TargetTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Targets"
      items={[
        { to: to('C-Team-Targets'), label: 'Targets' },
        { to: to('C-Leaderboard'), label: 'Leaderboard' },
      ]}
    />
  );
}

export function AuditTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Audit"
      items={[
        { to: to('C-Audit'), label: 'Activity' },
        { to: to('C-Audit-Flags'), label: 'Flags' },
      ]}
    />
  );
}

export function PricingTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Pricing & policy"
      items={[
        { to: to('C-Pricing'), label: 'Prices & rules', end: true },
        { to: to('C-Pricing-Trades'), label: 'Trades & salary ranges' },
        { to: to('C-Pricing-Areas'), label: 'Areas' },
        { to: to('C-Pricing-MinWage'), label: 'Legal minimum wage' },
        { to: to('C-Pricing-Data'), label: 'Keeping data' },
      ]}
    />
  );
}
