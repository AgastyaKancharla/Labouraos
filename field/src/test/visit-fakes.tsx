/**
 * Shared fakes for the shop-visit screens: a live camera that "takes" a
 * stamped photo when its button is pressed.
 * `jest.mock('@/device/camera', () => require('@/test/visit-fakes').cameraModule())`
 */
export const fakeStamp = {
  takenAt: '2026-11-09T06:12:00.000Z',
  latitude: 12.9116,
  longitude: 77.6101,
  accuracy: 8,
  lines: ['9 Nov 2026, 11:42 AM IST', '12.91160, 77.61010 ±8 m'],
};

export function cameraModule() {
  const actual = jest.requireActual('@/device/camera/stamp');
  const { Pressable, Text } = require('react-native');
  return {
    ...actual,
    LiveCamera: ({ onCapture, facing }: { onCapture: (p: unknown) => void; facing: string }) => (
      <Pressable
        testID={`fake-camera-${facing}`}
        onPress={() =>
          onCapture({
            uri: `file:///${facing}.jpg`,
            width: 10,
            height: 10,
            mimeType: 'image/jpeg',
            source: 'live_camera',
            stamp: (globalThis as { __stamp?: typeof fakeStamp }).__stamp ?? fakeStamp,
          })
        }
      >
        <Text>shutter</Text>
      </Pressable>
    ),
  };
}

export function setFakeStamp(stamp: Partial<typeof fakeStamp> | null) {
  (globalThis as { __stamp?: typeof fakeStamp }).__stamp = stamp ? { ...fakeStamp, ...stamp } : undefined;
}

export const sampleVisit = {
  id: 'v-1',
  purpose: 'shop_visit',
  business: null,
  shopName: 'Sri Krishna Hotel',
  assignmentId: null,
  revisitOfVisitId: null,
  latitude: 12.9116,
  longitude: 77.6101,
  accuracyMeters: 8,
  startedAt: '2026-11-09T06:12:00.000Z',
  endedAt: null,
  durationSeconds: null,
  hasBoardPhoto: true,
  hasSelfie: false,
  proofDistanceMeters: null,
  geofenceFlag: false,
  spokeTo: 'owner',
  contactPhone: null,
  outcome: null,
  outcomeReason: null,
  revisitOn: null,
  note: null,
  ownerOtpDone: false,
};
