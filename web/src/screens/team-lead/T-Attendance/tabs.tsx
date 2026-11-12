import { LinkTabs } from '../../../components/Tabs';
import { useScreenPath } from '../../../portals/PortalContext';

export function AttendanceTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Attendance"
      items={[
        { to: to('T-Attendance'), label: 'Today', end: true },
        { to: to('T-Attendance-Live'), label: 'Live board' },
      ]}
    />
  );
}
