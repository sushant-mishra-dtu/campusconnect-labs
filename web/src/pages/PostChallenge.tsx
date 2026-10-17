import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Challenge, type OfferType } from '../api';
import { useAuth } from '../auth';
import { Button, Card, DifficultyTag, ErrorNote, SkillChip, Spinner, cx } from '../components/ui';
import { useMeta } from '../hooks';

const OFFERS: { value: OfferType; label: string; example: string }[] = [
  { value: 'referral', label: 'Referral', example: "Make this work on a real FPGA and I'll refer you." },
  { value: 'interview', label: 'Interview slot', example: 'Pass this and you skip our first-round screen.' },
  { value: 'mentorship', label: 'Mentorship', example: "Pass this and I'll mentor you through our board bring-up." },
  { value: 'internship', label: 'Internship', example: 'Pass this and you are shortlisted for our summer internship.' },
];

export function PostChallenge() {
  const { me } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const [testId, setTestId] = useState('');
  const [offerType, setOfferType] = useState<OfferType>('referral');
  const [title, setTitle] = useState('');
  const [offer, setOffer] = useState('');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myRoles = meta?.roles.filter((r) => r.author.id === me?.id) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await api<Challenge>('/challenges', { body: { test_id: testId, offer_type: offerType, title, offer, role_id: roleId || null } });
      navigate(`/challenges/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Post a challenge</h1>
      <p className="mt-1 text-ink-2">Pick a hardware test from the library and say what you’ll do for someone who passes it. Anyone who passes gets connected to you with the signed proof.</p>

      <form onSubmit={submit} className="mt-8 space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold">1. The test</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {meta?.tests.map((t) => (
              <button type="button" key={t.id} onClick={() => setTestId(t.id)} className="text-left">
                <Card className={cx('h-full p-4 transition-colors', testId === t.id ? 'border-ink ring-1 ring-ink' : 'hover:border-line-2')}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.title}</span>
                    <DifficultyTag test={t} />
                  </div>
                  <p className="mt-1.5 text-sm text-ink-2">{t.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {t.skills.map((s) => (
                      <SkillChip key={s} slug={s} state="neutral" />
                    ))}
                  </div>
                </Card>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">2. Your offer</h2>
          <div className="flex flex-wrap gap-2">
            {OFFERS.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => setOfferType(o.value)}
                className={cx('rounded-lg border px-3 py-1.5 text-sm', offerType === o.value ? 'border-ink bg-ink text-white' : 'border-line-2 bg-card hover:border-ink')}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm">
            <span className="text-muted">Headline</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Make this UART work on a real FPGA" className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-muted">What you’ll do for someone who passes</span>
            <textarea
              required
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              placeholder={OFFERS.find((o) => o.value === offerType)?.example}
              rows={3}
              className="mt-1 w-full rounded-lg border border-line-2 bg-card px-3 py-2"
            />
          </label>
          {myRoles.length > 0 && (
            <label className="mt-3 block text-sm">
              <span className="text-muted">Link to one of your roles (students see it in their gap analysis)</span>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3">
                <option value="">No role</option>
                {myRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · {r.org}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy || !testId || !offer.trim()}>
          {busy && <Spinner />} Post challenge
        </Button>
      </form>
    </div>
  );
}
