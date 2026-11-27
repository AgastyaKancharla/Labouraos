/**
 * The two pretend-data markers the screens need to recognise. Kept apart from
 * src/api/mock.ts and src/verify/mockSteps.ts so a release build, which never
 * loads the pretend server, does not carry it just for these strings.
 */
export const MOCK_SHEET_URL = 'laboura-mock://sheet';
export const mockLinkToken = (profileId: string) => `mock-link-${profileId}`;
