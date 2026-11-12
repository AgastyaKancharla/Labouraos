import { LinkTabs } from '../../../components/Tabs';
import { useScreenPath } from '../../../portals/PortalContext';

/** Today · Live board · Leave, as on MG-Attendance and MG-Attendance-Live. */
export function AttendanceTabs() {
  const to = useScreenPath();
  return (
    <LinkTabs
      label="Attendance"
      items={[
        { to: to('MG-Attendance'), label: 'Today', end: true },
        { to: to('MG-Attendance-Live'), label: 'Live board' },
        { to: to('MG-Leave'), label: 'Leave' },
      ]}
    />
  );
}
