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
