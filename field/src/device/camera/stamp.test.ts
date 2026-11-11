import { buildStamp, stampFormFields } from './stamp';

describe('photo stamp', () => {
  const takenAt = new Date('2026-11-11T08:35:00Z'); // 2:05 PM IST

  it('stamps the time in IST and the place with accuracy', () => {
    const stamp = buildStamp(takenAt, { latitude: 12.9116, longitude: 77.6389, accuracy: 12.4, timestamp: 0 }, 'BZ-00012');
    expect(stamp.lines).toEqual(['11 Nov 2026, 2:05 PM IST', '12.91160, 77.63890 ±12 m', 'BZ-00012']);
    expect(stamp).toMatchObject({ takenAt: '2026-11-11T08:35:00.000Z', latitude: 12.9116, longitude: 77.6389, accuracy: 12 });
  });

  it('says so when there is no location', () => {
    const stamp = buildStamp(takenAt, null);
    expect(stamp.lines[1]).toBe('Location not available');
    expect(stamp.latitude).toBeNull();
  });

  it('becomes upload fields marked as a live camera photo', () => {
    const fields = stampFormFields(buildStamp(takenAt, { latitude: 1.5, longitude: 2.5, accuracy: 8, timestamp: 0 }));
    expect(fields).toEqual({ takenAt: '2026-11-11T08:35:00.000Z', source: 'live_camera', latitude: '1.5', longitude: '2.5', accuracy: '8' });
    expect(stampFormFields(buildStamp(takenAt, null))).toEqual({ takenAt: '2026-11-11T08:35:00.000Z', source: 'live_camera' });
  });
});
