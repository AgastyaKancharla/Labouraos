import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, TextInput } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { kiran, renderWithApp } from '@/test/render';
import { getDraft, saveDraft } from '@/screens/_visits/visitDraft';
import { clearAllDrafts, clearAllFormDrafts, draftOwner, readFormDraft, setDraftOwner, useFormDraft } from './formDraft';

/**
 * Fix list A6 (16 Nov): drafts used to survive sign-out, and the referral
 * draft had one fixed key for everyone. Now every draft is kept under the
 * signed-in agent and Log out clears them all.
 */
const anita = { id: 'fa-2', code: 'FA-00021', name: 'Anita Rao', role: 'field_agent' };

function Form({ draftKey }: { draftKey: string }) {
  const [value, setValue] = useFormDraft(draftKey, '');
  const { logout } = useAuth();
  return (
    <>
      <TextInput testID="field" value={value} onChangeText={setValue} />
      <Text testID="owner">{draftOwner() ?? '-'}</Text>
      <Pressable testID="logout" onPress={() => void logout()} />
    </>
  );
}

const visit = (id: string) => ({
  id, startedAt: '2026-11-16T06:00:00.000Z', latitude: 12.9, longitude: 77.6, accuracy: 8, shopName: 'Shop', businessId: null, businessName: null,
  spokeTo: '', contactPhone: '', endedAt: null, proofDistance: null, proofAt: null,
});

beforeEach(() => {
  clearAllFormDrafts();
  setDraftOwner(null);
});

describe('form drafts belong to the signed-in agent (A6)', () => {
  it('keeps a draft under the agent: the same agent finds it, another agent signing in never sees it', async () => {
    setDraftOwner('fa-1');
    const first = await renderHookValue('fa23');
    await act(async () => first.set('Ravi Kumar'));
    expect(readFormDraft('fa23')).toBe('Ravi Kumar');
    // An automatic sign-out (idle) keeps it for him…
    setDraftOwner(null);
    expect(readFormDraft('fa23')).toBeUndefined();
    setDraftOwner('fa-1');
    expect(readFormDraft('fa23')).toBe('Ravi Kumar');
    // …but another agent signing in on this phone drops it.
    setDraftOwner(null);
    setDraftOwner('fa-2');
    expect(readFormDraft('fa23')).toBeUndefined();
    setDraftOwner('fa-1');
    expect(readFormDraft('fa23')).toBeUndefined();
  });

  it('another agent signing in also empties the visits in progress', () => {
    setDraftOwner('fa-1');
    saveDraft(visit('v-1'));
    setDraftOwner(null);
    setDraftOwner('fa-2');
    expect(getDraft('v-1')).toBeNull();
  });

  it('clearAllDrafts empties form drafts and the visits in progress', async () => {
    setDraftOwner('fa-1');
    const form = await renderHookValue('fa10');
    await act(async () => form.set('typed'));
    saveDraft(visit('v-2'));
    clearAllDrafts();
    expect(readFormDraft('fa10')).toBeUndefined();
    expect(getDraft('v-2')).toBeNull();
  });

  it('Log out clears every draft (the referral form, the job seeker form, a visit in progress)', async () => {
    await renderWithApp(<Form draftKey="fa23" />, { signedInAs: kiran, route: (url) => (url.endsWith('/auth/logout') ? { status: 200, body: { success: true } } : undefined) });
    await waitFor(() => expect(screen.getByTestId('owner')).toHaveTextContent('fa-1'));
    await fireEvent.changeText(screen.getByTestId('field'), 'Half-typed referral');
    saveDraft(visit('v-3'));
    expect(readFormDraft('fa23')).toBe('Half-typed referral');
    await fireEvent.press(screen.getByTestId('logout'));
    await waitFor(() => expect(readFormDraft('fa23')).toBeUndefined());
    expect(getDraft('v-3')).toBeNull();
  });

  it('a form opened by another agent on the same phone starts empty', async () => {
    const first = await renderWithApp(<Form draftKey="fa23" />, { signedInAs: kiran });
    await fireEvent.changeText(screen.getByTestId('field'), 'Kiran’s draft');
    await first.unmount();
    setDraftOwner(null);
    await renderWithApp(<Form draftKey="fa23" />, { signedInAs: anita });
    await waitFor(() => expect(screen.getByTestId('owner')).toHaveTextContent('fa-2'));
    expect(screen.getByTestId('field').props.value).toBe('');
  });
});

/** The hook's setter, for tests that need no screen. */
async function renderHookValue(key: string) {
  const { result } = await renderHook(() => useFormDraft(key, ''));
  return { set: (v: string) => result.current[1](v) };
}
