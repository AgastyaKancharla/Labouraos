import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { TextField } from '../../../components/fields/TextField';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';

/**
 * Legal documents v1.1 (rev 176): the company details every legal text and
 * public page shows — CIN, registered office, GSTIN and the Grievance Officer.
 * Until Laboura is registered they read "to be added after registration".
 * CEO only (PUT /pricing/company-details); the texts pick them up at once.
 */
interface Company {
  legalName: string;
  cin: string | null;
  registeredOffice: string | null;
  gstin: string | null;
  grievanceOfficer: { name: string | null; phone: string | null; email: string | null };
  versions: Record<string, string>;
  noticeVersion: string;
}

export function CompanyDetailsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const company = useQuery({ queryKey: ['legal-company', 'ceo'], queryFn: () => api.get<Company>('/legal/company', { auth: false }) });
  const [form, setForm] = useState({ legalName: '', cin: '', address: '', gstin: '', name: '', phone: '', email: '' });
  const c = company.data;
  useEffect(() => {
    if (!c) return;
    setForm({
      legalName: c.legalName,
      cin: c.cin ?? '',
      address: c.registeredOffice ?? '',
      gstin: c.gstin ?? '',
      name: c.grievanceOfficer.name ?? '',
      phone: c.grievanceOfficer.phone ?? '',
      email: c.grievanceOfficer.email ?? '',
    });
  }, [c]);
  const save = useMutation({
    mutationFn: () =>
      api.put('/pricing/company-details', {
        legalName: form.legalName,
        cin: form.cin,
        address: form.address,
        gstin: form.gstin,
        grievanceOfficerName: form.name,
        grievanceOfficerPhone: form.phone,
        grievanceOfficerEmail: form.email,
      }),
    onSuccess: () => {
      toast.success('Company details saved — every legal text shows them now');
      void queryClient.invalidateQueries({ queryKey: ['legal-company'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <Card title="Legal documents · company details">
      {c && (
        <div className="ceo-note">
          Versions in use: job seeker terms {c.versions.job_seeker_terms} (consent notice {c.noticeVersion}), business agreement {c.versions.business_agreement}, referral
          partner terms {c.versions.referral_terms}. Empty fields read “to be added after registration” on the documents.
        </div>
      )}
      <TextField label="Legal name" value={form.legalName} onChange={set('legalName')} required />
      <TextField label="CIN" value={form.cin} onChange={set('cin')} hint="21 characters, after registration" />
      <TextField label="Registered office" value={form.address} onChange={set('address')} />
      <TextField label="GSTIN" value={form.gstin} onChange={set('gstin')} />
      <TextField label="Grievance Officer name" value={form.name} onChange={set('name')} />
      <TextField label="Grievance Officer phone" value={form.phone} onChange={set('phone')} inputMode="tel" />
      <TextField label="Grievance Officer email" value={form.email} onChange={set('email')} type="email" />
      <Button variant="primary" onClick={() => save.mutate()} disabled={!form.legalName.trim() || save.isPending}>
        Save company details
      </Button>
    </Card>
  );
}
