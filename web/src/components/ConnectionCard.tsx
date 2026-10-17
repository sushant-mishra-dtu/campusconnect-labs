import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Connection, type ConnectionType } from '../api';
import { useAuth } from '../auth';
import { Button, Card, KindBadge, PersonLink, Spinner, Tag, fmtDateTime } from './ui';

export const EDGE_LABEL: Record<ConnectionType, string> = {
  proved_for: 'proved for',
  lent_board: 'lent a board to',
  referred: 'referred',
  mentored: 'is mentoring',
};

export const EDGE_COLOR: Record<ConnectionType, string> = {
  proved_for: '#157a4c',
  lent_board: '#2f5bd3',
  referred: '#a2600f',
  mentored: '#8a3fb8',
};

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

export function ConnectionCard({ c, onActed }: { c: Connection; onActed?: () => void }) {
  const { me } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAct = me && c.type === 'proved_for' && c.to.id === me.id && c.follow_ups.length === 0;

  const act = async (action: 'referral' | 'mentorship') => {
    setBusy(action);
    setError(null);
    try {
      await api(`/connections/${c.id}/act`, { body: { action, note } });
      onActed?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <PersonLink user={c.from} size={30} />
        <span className="rounded-md px-1.5 py-0.5 font-mono text-[12px] text-white" style={{ background: EDGE_COLOR[c.type] }}>
          {EDGE_LABEL[c.type]}
        </span>
        <PersonLink user={c.to} size={30} />
      </div>
      <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-[13px]">
        <Row k="type">
          <span className="font-mono">{c.type}</span>
        </Row>
        {c.challenge && (
          <Row k="challenge">
            <Link to={`/challenges/${c.challenge.id}`} className="hover:underline">
              {c.challenge.test.title}
            </Link>
          </Row>
        )}
        {c.node && (
          <Row k="board">
            {c.node.name}, {c.node.college.name}
          </Row>
        )}
        {c.proof && (
          <Row k="signed by">
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="font-mono">{c.proof.examiner_id}</span> <KindBadge kind={c.proof.examiner_kind} compact />
            </span>
          </Row>
        )}
        {c.note && <Row k="note">{c.note}</Row>}
        <Row k="when">{fmtDateTime(c.created_at)}</Row>
      </dl>
      {c.follow_ups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.follow_ups.map((f, i) => (
            <Tag key={i} tone="claim">
              {f.type === 'referred' ? 'Referral sent' : 'Mentorship started'}
              {f.note ? ` · ${f.note}` : ''}
            </Tag>
          ))}
        </div>
      )}
      {c.proof && (
        <Link to={`/proof/${c.proof.attempt_id}`} className="mt-3 inline-block text-xs font-medium text-wire hover:underline">
          View the signed proof →
        </Link>
      )}
      {canAct && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="text-sm font-medium">This proof is addressed to you. Follow through:</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note, e.g. Referred to the FPGA prototyping team"
            className="mt-2 h-9 w-full rounded-lg border border-line-2 bg-card px-3 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => act('referral')} disabled={!!busy}>
              {busy === 'referral' && <Spinner />} Send referral
            </Button>
            <Button size="sm" kind="secondary" onClick={() => act('mentorship')} disabled={!!busy}>
              {busy === 'mentorship' && <Spinner />} Offer mentorship
            </Button>
          </div>
          {error && <div className="mt-2 text-sm text-fail">{error}</div>}
        </div>
      )}
    </Card>
  );
}
