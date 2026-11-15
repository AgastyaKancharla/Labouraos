import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';

interface StaffLanguages {
  languages: string[];
  staff: Array<{ id: string; code: string; spokenLanguages: string[] }>;
}

const KEY = ['signup-tracker', 'staff-languages'];

/**
 * Languages each staff member speaks with customers (customer app proposal
 * 4.3, C5): app sign-ups go to an agent who speaks the person's language.
 * Data: GET /signup-tracker/staff-languages, saved with PUT …/:staffId (CEO only).
 */
export function useStaffLanguages() {
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<StaffLanguages>('/signup-tracker/staff-languages') });
  const byId = new Map((q.data?.staff ?? []).map((s) => [s.id, s.spokenLanguages]));
  return { options: q.data?.languages ?? [], byId, loaded: q.isSuccess };
}

export function SpokenLanguagesButton({ id, name, current, options }: { id: string; name: string; current: string[]; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(current);
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.put(`/signup-tracker/staff-languages/${id}`, { languages: picked }),
    onSuccess: () => {
      toast.success(`Languages saved for ${name}`);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the languages'),
  });
  const toggle = (language: string) =>
    setPicked((list) => (list.includes(language) ? list.filter((l) => l !== language) : [...list, language]));
  return (
    <>
      <Button
        size="compact"
        onClick={() => {
          setPicked(current);
          setOpen(true);
        }}
      >
        Languages
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Languages ${name} speaks`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
              Save languages
            </Button>
          </>
        }
      >
        <p className="sub">App sign-ups go first to an agent who speaks the person's language.</p>
        <fieldset style={{ border: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          <legend className="sub">Speaks with customers</legend>
          {options.map((language) => (
            <label key={language} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={picked.includes(language)} onChange={() => toggle(language)} /> {language}
            </label>
          ))}
        </fieldset>
      </Modal>
    </>
  );
}
