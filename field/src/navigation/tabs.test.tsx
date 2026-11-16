import fs from 'fs';
import path from 'path';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { pageRoutes, routes, SEARCH_ROUTES, sellingRoutes, sellingRoutesFor, TAB_ROOTS } from './routes';

/**
 * Laboura Field redesign (16 Nov): five tabs — Today, Visits, Businesses,
 * Job seekers, Me — each one kind of work, and a job never jumps to another
 * tab halfway. This renders the real route tree (every file in app/, with the
 * real tab and stack layouts) and a stand-in for each screen.
 */
const APP_DIR = path.join(__dirname, '../../app');

function routeFiles(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return routeFiles(path.join(dir, entry.name), `${rel}/`);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

function PlainStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

/** Route files: real layouts inside (tabs), plain stacks above it, a labelled stand-in for every screen. */
function routeTree() {
  const tree: Record<string, unknown> = {};
  for (const file of routeFiles(APP_DIR)) {
    const key = file.replace(/\.tsx?$/, '');
    if (key.endsWith('_layout')) {
      // The root and signed-in layouts need fonts and a session; they are plain stacks here.
      tree[key] = key.includes('(tabs)') ? require(path.join(APP_DIR, file)) : PlainStack;
    } else {
      const Stub = () => <Text testID="screen">{key}</Text>;
      tree[key] = Stub;
    }
  }
  return tree;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider storage={createMemoryStore()}>{children}</I18nProvider>
    </SafeAreaProvider>
  );
}

const render = (initialUrl: string) => renderRouter(routeTree() as never, { initialUrl, wrapper: Providers });

const activeTab = () =>
  screen
    .getAllByRole('tab')
    .filter((tab) => tab.props.accessibilityState?.selected)
    .map((tab) => tab.props.accessibilityLabel);

const visitFlow = sellingRoutesFor('/visit');
type Tab = 'Today' | 'Visits' | 'Businesses' | 'Job seekers' | 'Me';

/** Every screen, with the tab its job lives in. */
const SCREENS: [design: string, url: string, tab: Tab][] = [
  ['Search from Today', routes.search, 'Today'],
  ['FA14-Pitch', routes.feeCalculator, 'Today'],
  // The whole visit-and-onboard job lives in Visits.
  ['FA05b-TodaysWork', pageRoutes.todaysWork('2026-11-16', 'visit'), 'Visits'],
  ['FA13 Shops near me', routes.shopsNearMe, 'Visits'],
  ['FA20-VisitStart', routes.visitStart, 'Visits'],
  ['FA21-VisitTalk', `${routes.visitTalk}?id=v-1`, 'Visits'],
  ['FA22-VisitProof', `${routes.visitProof}?id=v-1`, 'Visits'],
  ['FA07-RegisterBusiness', `${routes.visitBusiness}?visitId=v-1`, 'Visits'],
  ['FA07b-Agreement', `${routes.visitAgreement}?businessId=b-1`, 'Visits'],
  ['FA07c-VisitVacancies', `${routes.visitVacancies}?businessId=b-1`, 'Visits'],
  ['FA06b-VisitDone (candidates)', `${routes.visitDone}?businessId=b-1`, 'Visits'],
  ['FA15b in the visit', visitFlow.matches('b-1', 'v-1'), 'Visits'],
  ['FA17b in the visit', visitFlow.confirmVacancy('vac-1'), 'Visits'],
  ['FA16 interview to attend', visitFlow.interviewDay('iv-1'), 'Visits'],
  ['FA06c-VisitOutcome', `${routes.visitOutcome}?id=v-1`, 'Visits'],
  ['FA06-Verify', `${routes.visitVerify}?businessId=b-1`, 'Visits'],
  ['FA05d visit details', pageRoutes.visitDetails('v-1'), 'Visits'],
  ['FA14 during a visit', routes.visitPitch, 'Visits'],
  // Businesses: the business page and everything about its vacancies and candidates.
  ['FA08-Business', pageRoutes.business('b-1'), 'Businesses'],
  ['FA17-AddVacancy', sellingRoutes.addVacancy('b-1'), 'Businesses'],
  ['FA17b-VacancyOTP', sellingRoutes.confirmVacancy('vac-1'), 'Businesses'],
  ['FA15b-Matches', sellingRoutes.matches('b-1', 'vac-1'), 'Businesses'],
  ['FA15d-Candidate', sellingRoutes.candidate('js-1', 'vac-1'), 'Businesses'],
  ['FA15e-Calling', sellingRoutes.call('vac-1', 'js-1'), 'Businesses'],
  ['FA15f-ThreeWay', sellingRoutes.owner('iv-1'), 'Businesses'],
  ['FA15g-BookInterview', sellingRoutes.book('vac-1', 'js-1'), 'Businesses'],
  ['FA15s-Selected', sellingRoutes.selected('iv-1'), 'Businesses'],
  ['FA15q-Paid', sellingRoutes.paid('pl-1'), 'Businesses'],
  ['FA11-Joining', sellingRoutes.joining('pl-1'), 'Businesses'],
  ['FA18-CallOwner', sellingRoutes.callOwner('b-1'), 'Businesses'],
  ['FA05d from the business page', pageRoutes.visitDetails('v-1', '/businesses'), 'Businesses'],
  // Job seekers
  ['FA10-CaptureSeeker', routes.jobSeekerNew, 'Job seekers'],
  ['FA10b-SeekerSaved', pageRoutes.seekerSaved('js-1'), 'Job seekers'],
  ['FA10c-SeekerProgress', pageRoutes.seekerProgress('js-1'), 'Job seekers'],
  ['FA23-RegisterReferral', routes.referralNew, 'Job seekers'],
  ['FA23b-ReferralSaved', pageRoutes.referralSaved('rf-1'), 'Job seekers'],
  // Me
  ['FA12-Targets', routes.targets, 'Me'],
  ['FA04-CheckedIn', routes.myDay, 'Me'],
  ['FA04e-MyAttendance', routes.myAttendance, 'Me'],
  ['FA04f-RequestLeave', routes.myLeave, 'Me'],
  ['FA04h-Correction', routes.myCorrection, 'Me'],
  ['FA04g-Payslip', routes.myPayslips, 'Me'],
];

const ROOTS: [tab: Tab, url: string, file: string][] = [
  ['Today', TAB_ROOTS['(today)'], '(app)/(tabs)/(today)/index'],
  ['Visits', TAB_ROOTS['(visits)'], '(app)/(tabs)/(visits)/visits/index'],
  ['Businesses', TAB_ROOTS.businesses, '(app)/(tabs)/businesses/index'],
  ['Job seekers', TAB_ROOTS['job-seekers'], '(app)/(tabs)/job-seekers/index'],
  ['Me', TAB_ROOTS.me, '(app)/(tabs)/me/index'],
];

describe('Laboura Field tabs', () => {
  it('has five tabs in order: Today, Visits, Businesses, Job seekers, Me (no Vacancies or Map tab)', async () => {
    await render(routes.home);
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual(['Today', 'Visits', 'Businesses', 'Job seekers', 'Me']);
    expect(activeTab()).toEqual(['Today']);
  });

  it.each(ROOTS)('the %s tab opens its main page at %s', async (_tab, url, file) => {
    await render(url);
    expect(screen.getByTestId('screen')).toHaveTextContent(file);
  });

  it.each(SCREENS)('%s (%s) sits in the %s tab', async (_design, url, tab) => {
    await render(url);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(activeTab()).toEqual([tab]);
  });

  const TAB_LABEL: Record<string, Tab> = { '(today)': 'Today', '(visits)': 'Visits', businesses: 'Businesses', 'job-seekers': 'Job seekers', me: 'Me' };
  it.each(Object.entries(SEARCH_ROUTES))('the %s tab has its own search page (%s), so searching never changes tab', async (tab, url) => {
    await render(url);
    expect(screen.getByTestId('screen')).toHaveTextContent(new RegExp(`\\(tabs\\)/${tab.replace(/[()]/g, '\\$&')}/.*search$`));
    expect(activeTab()).toEqual([TAB_LABEL[tab]]);
  });

  it('walks the whole onboarding job inside the Visits tab — photo, talk, selfie, form, agreement, vacancies, candidates — and back returns step by step', async () => {
    await render(routes.visits);
    await testRouter.push(routes.visitStart);
    await testRouter.replace(`${routes.visitTalk}?id=v-1`);
    await testRouter.push(`${routes.visitProof}?id=v-1`);
    await testRouter.push(`${routes.visitBusiness}?visitId=v-1`);
    await testRouter.replace(`${routes.visitAgreement}?businessId=b-1&visitId=v-1`);
    await testRouter.push(`${routes.visitVacancies}?businessId=b-1&visitId=v-1`);
    await testRouter.push(`${routes.visitDone}?businessId=b-1&visitId=v-1`);
    await testRouter.push(visitFlow.matches('b-1', 'vac-1'));
    await testRouter.push(visitFlow.candidate('js-1', 'vac-1'));
    expect(activeTab()).toEqual(['Visits']);
    await testRouter.back();
    await testRouter.back();
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/(visits)/visit/done');
    expect(activeTab()).toEqual(['Visits']);
  });

  it('a draft vacancy, its confirmation and the candidates all stay in the Businesses tab', async () => {
    await render(routes.businesses);
    await testRouter.push(pageRoutes.business('b-1'));
    await testRouter.push(sellingRoutes.confirmVacancy('vac-1'));
    expect(activeTab()).toEqual(['Businesses']);
    await testRouter.push(sellingRoutes.matches('b-1', 'vac-1'));
    expect(activeTab()).toEqual(['Businesses']);
    await testRouter.back();
    await testRouter.back();
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/businesses/[id]');
  });

  it('a screen opened straight from its URL has its tab’s main page underneath, so back works', async () => {
    const r = await render(`${routes.visitAgreement}?businessId=b-1`);
    expect(testRouter.canGoBack()).toBe(true);
    await testRouter.back();
    expect(r.getPathname()).toBe(routes.visits);
    const b = await render(sellingRoutes.confirmVacancy('vac-1'));
    await testRouter.back();
    expect(b.getPathname()).toBe(routes.businesses);
  });

  it('tapping another tab returns to its main page: a tab left mid-job is reset', async () => {
    await render(routes.visits);
    await testRouter.push(routes.visitStart);
    await testRouter.push(`${routes.visitTalk}?id=v-1`);
    await fireEvent.press(screen.getByTestId('tab-(today)'));
    expect(activeTab()).toEqual(['Today']);
    await act(async () => {
      jest.runOnlyPendingTimers?.();
    });
    await fireEvent.press(screen.getByTestId('tab-(visits)'));
    expect(activeTab()).toEqual(['Visits']);
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/(visits)/visits/index');
  });

  it('tapping the tab you are on closes everything opened inside it', async () => {
    await render(routes.me);
    await testRouter.push(routes.myAttendance);
    await testRouter.push(routes.myLeave);
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/me/attendance/leave');
    await fireEvent.press(screen.getByTestId('tab-me'));
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/me/index');
    expect(activeTab()).toEqual(['Me']);
  });

  it('every signed-in route file sits inside one of the five tabs, so none can lose the tab bar', () => {
    const files = routeFiles(APP_DIR).filter((f) => !f.endsWith('_layout.tsx'));
    const outside = files.filter((f) => f.startsWith('(app)/') && !f.startsWith('(app)/(tabs)/'));
    expect(outside).toEqual([]);
    const tabs = new Set(files.filter((f) => f.startsWith('(app)/(tabs)/')).map((f) => f.split('/')[2]));
    expect([...tabs].sort()).toEqual(['(today)', '(visits)', 'businesses', 'job-seekers', 'me']);
  });
});
