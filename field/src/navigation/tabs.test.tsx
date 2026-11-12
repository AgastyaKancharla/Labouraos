import fs from 'fs';
import path from 'path';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { I18nProvider } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { routes, sellingRoutes } from './routes';

/**
 * The tab bar is shown on every screen whose design shows it (FA03–FA22): each
 * tab keeps its own stack, so a screen opened from a tab stays inside it. This
 * renders the real route tree (every file in app/, with the real tab and stack
 * layouts) and a stand-in for each screen.
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

/** Each screen from the task list, with the tab its design marks as active. */
const SCREENS: [design: string, url: string, tab: 'Home' | 'Visits'][] = [
  ['FA04-CheckedIn', routes.attendance, 'Home'],
  ['FA04e-MyAttendance', routes.myAttendance, 'Home'],
  ['FA04f-RequestLeave', routes.myLeave, 'Home'],
  ['FA04h-Correction', routes.myCorrection, 'Home'],
  ['FA04g-Payslip', routes.myPayslips, 'Home'],
  ['Search (CA16 for the phone)', routes.search, 'Home'],
  ['FA07-RegisterBusiness', `${routes.businessNew}?visitId=v-1`, 'Home'],
  ['FA08-Business', `${routes.business}/b-1`, 'Home'],
  ['FA10-CaptureSeeker', routes.jobSeekerNew, 'Home'],
  ['FA10b-SeekerSaved', sellingRoutes.seekerSaved('js-1'), 'Home'],
  ['FA10c-SeekerProgress', sellingRoutes.seekerProgress('js-1'), 'Home'],
  ['FA11-Joining', sellingRoutes.joining('pl-1'), 'Home'],
  ['FA14-Pitch', routes.feeCalculator, 'Home'],
  ['FA17-AddVacancy', routes.vacancyNew, 'Home'],
  ['FA18-CallOwner', sellingRoutes.callOwner('b-1'), 'Home'],
  ['FA20-VisitStart', routes.visitStart, 'Visits'],
  ['FA21-VisitTalk', `${routes.visitTalk}?id=v-1`, 'Visits'],
  ['FA22-VisitProof', `${routes.visitProof}?id=v-1`, 'Visits'],
  ['FA06c-VisitOutcome', `${routes.visitOutcome}?id=v-1`, 'Visits'],
  ['FA06-Verify', `${routes.visitVerify}?businessId=b-1`, 'Visits'],
  ['FA06b-VisitDone', `${routes.visitDone}?businessId=b-1`, 'Visits'],
];

describe('Laboura Field tab bar', () => {
  it.each(SCREENS)('%s (%s) shows the tab bar with %s active', async (_design, url, tab) => {
    await render(url);
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(activeTab()).toEqual([tab]);
  });

  it('keeps every URL the screens already use', async () => {
    const result = await render(routes.visitStart);
    expect(result.getPathname()).toBe('/visit/start');
    await testRouter.push(routes.home);
    expect(result.getPathname()).toBe('/');
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/(home)/index');
  });

  it('walks the visit flow inside the Visits tab, and back returns step by step to the visits list', async () => {
    await render(routes.visits);
    expect(activeTab()).toEqual(['Visits']);
    await testRouter.push(routes.visitStart);
    await testRouter.replace(`${routes.visitTalk}?id=v-1`);
    await testRouter.push(`${routes.visitProof}?id=v-1`);
    expect(activeTab()).toEqual(['Visits']);
    await testRouter.back(`${routes.visitTalk}?id=v-1`);
    expect(activeTab()).toEqual(['Visits']);
    await testRouter.back(routes.visits);
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/(visits)/visits');
  });

  it('a screen opened from Home stays in the Home tab and back returns to Home', async () => {
    await render(routes.home);
    await testRouter.push(routes.attendance);
    expect(activeTab()).toEqual(['Home']);
    await testRouter.back('/');
    expect(activeTab()).toEqual(['Home']);
  });

  it('opening a screen straight from its URL still has the tab root underneath, so back works', async () => {
    const proof = await render(`${routes.visitProof}?id=v-1`);
    expect(testRouter.canGoBack()).toBe(true);
    await testRouter.back();
    expect(proof.getPathname()).toBe(routes.visits);
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/(visits)/visits');
  });

  it('opening a Home-flow screen straight from its URL has Home underneath', async () => {
    const joining = await render(sellingRoutes.joining('pl-1'));
    expect(testRouter.canGoBack()).toBe(true);
    await testRouter.back();
    expect(joining.getPathname()).toBe('/');
    expect(screen.getByTestId('screen')).toHaveTextContent('(app)/(tabs)/(home)/index');
  });

  it.each([
    ['Job seekers', sellingRoutes.matches('b-1', 'v-1'), '/job-seekers', '(app)/(tabs)/job-seekers/index'],
    ['Job seekers', sellingRoutes.candidate('js-1', 'v-1'), '/job-seekers', '(app)/(tabs)/job-seekers/index'],
    ['Vacancies', sellingRoutes.confirmVacancy('v-1'), '/vacancies', '(app)/(tabs)/vacancies/index'],
    ['Vacancies', sellingRoutes.addVacancy('b-1'), '/vacancies', '(app)/(tabs)/vacancies/index'],
  ])('a deep link into the %s tab (%s) keeps the list underneath, so back shows the list', async (tab, url, listPath, listScreen) => {
    const result = await render(url);
    expect(activeTab()).toEqual([tab]);
    expect(testRouter.canGoBack()).toBe(true);
    await testRouter.back();
    expect(result.getPathname()).toBe(listPath);
    expect(screen.getByTestId('screen')).toHaveTextContent(listScreen);
    expect(activeTab()).toEqual([tab]);
  });

  it('switching tabs keeps each tab where the agent left it', async () => {
    await render(routes.visits);
    await testRouter.push(routes.visitStart);
    await testRouter.navigate(routes.home);
    expect(activeTab()).toEqual(['Home']);
    await testRouter.navigate(routes.visits);
    expect(activeTab()).toEqual(['Visits']);
  });

  it('every visit-flow and Home-flow route file sits inside (tabs), so none can lose the tab bar', () => {
    const files = routeFiles(APP_DIR).filter((f) => !f.endsWith('_layout.tsx'));
    const outside = files.filter((f) => f.startsWith('(app)/') && !f.startsWith('(app)/(tabs)/'));
    // Search (CA16 adapted to the phone) now lives in the Home stack too, so nothing is outside the tabs.
    expect(outside).toEqual([]);
  });
});
