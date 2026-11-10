import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AttendanceService } from '../modules/attendance/attendance.service';

const FIELD_LOGIN = { latitude: 12.9716, longitude: 77.5946 };

/**
 * Logs the staff member in for today and sets Available.
 * A call is refused until this has happened. Times come from the attendance clock.
 */
export async function openAvailableDay(app: INestApplication, staffId: string): Promise<void> {
  const attendance = app.get(AttendanceService);
  const prisma = app.get(PrismaService);
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { role: true },
  });
  await attendance.login(staffId, staff?.role === 'field_agent' ? FIELD_LOGIN : {});
  await attendance.setStatus(staffId, 'available');
}
