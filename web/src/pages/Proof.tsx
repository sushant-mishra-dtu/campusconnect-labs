import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Attempt } from '../api';
import {
  Button,
  Card,
  CheckIcon,
  CrossIcon,
  ErrorNote,
  KindBadge,
  Loading,
  PersonLink,
  SectionTitle,
  Spinner,
  Tag,
  cx,
  fmtDateTime,
} from '../components/ui';
import { useApi } from '../hooks';
import { verifySignature, webCryptoAvailable } from '../lib/verify';

const SERVER_CHECKS = [
  'ECDSA P-256 signature verifies against the examiner key pinned for this node',
  'nonce equals the one the platform issued for this attempt',
  'node, examiner and challenge in the payload match the attempt',
  'counter is higher than any the examiner used before (no replays)',
  'the attempt started inside a booking held by this student on this board',
];

type Check = { state: 'idle' } | { state: 'busy' } | { state: 'done'; ok: boolean } | { state: 'error'; message: string };

export function Proof() {
  const { id } = useParams();
  const { data: a, error, loading } = useApi<Attempt>(`/proofs/${id}`);
  const [payload, setPayload] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  useEffect(() => {
    if (a?.proof) setPayload(a.proof.payload);
  }, [a]);

  if (loading) return <Loading />;
  if (error || !a || !a.proof) return <ErrorNote>{error ?? 'No signed verdict for this attempt'}</ErrorNote>;
  const proof = a.proof;

  const verify = async () => {
    if (!webCryptoAvailable()) {
      setCheck({ state: 'error', message: 'WebCrypto needs a secure context. Open this page on https or localhost.' });
      return;
    }
    setCheck({ state: 'busy' });
    try {
      setCheck({ state: 'done', ok: await verifySignature(proof.examiner_pubkey, payload, proof.sig) });
    } catch (e) {
      setCheck({ state: 'error', message: (e as Error).message });
    }
  };

  const tamper = () => {
    setPayload((p) => (p.includes('"result":"pass"') ? p.replace('"result":"pass"', '"result":"fail"') : p.replace('"result":"fail"', '"result":"pass"')));
    setCheck({ state: 'idle' });
  };

  const edited = payload !== proof.payload;
  let pretty = proof.payload;
  try {
    pretty = JSON.stringify(JSON.parse(proof.payload), null, 2);
  } catch {
    // show it raw
  }

  const pass = a.status === 'verified' && a.result === 'pass';

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={pass ? 'proof' : a.status === 'verified' ? 'claim' : 'fail'}>
            {a.status === 'verified' ? (a.result === 'pass' ? 'PASS' : 'FAIL') : a.status.toUpperCase()}
          </Tag>
          <KindBadge kind={proof.examiner_kind} />
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Signed verdict <span className="font-mono text-muted">#{a.id}</span>
        </h1>
        <p className="mt-1 text-ink-2">
          {a.user.name} attempted <span className="font-medium">{a.test.title}</span>
          {a.challenge && <> for {a.challenge.author.name}</>}
          {a.node && <> on {a.node.name}, {a.node.college.name}</>}
          {a.finished_at && <> · {fmtDateTime(a.finished_at)}</>}
        </p>
        {proof.examiner_kind === 'sim' && (
          <p className="mt-2 text-sm text-muted">
            This verdict came from a simulation examiner: the testbench ran against the synthesized netlist on the lab node, and the key is stored on that machine.
            Only verdicts from an ESP32 examiner whose key the platform enrolled are marked “Verified on silicon”.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted">Student</div>
          <div className="mt-2">
            <PersonLink user={a.user} />
          </div>
        </Card>
        {a.challenge && (
          <Card className="p-4">
            <div className="text-xs text-muted">Challenge author</div>
            <div className="mt-2">
              <PersonLink user={a.challenge.author} />
            </div>
          </Card>
        )}
        {a.node && (
          <Card className="p-4">
            <div className="text-xs text-muted">Board lent by</div>
            <div className="mt-2">
              <PersonLink user={a.node.owner} />
            </div>
          </Card>
        )}
      </div>

      <section>
        <SectionTitle>What the examiner signed</SectionTitle>
        <div className="overflow-hidden rounded-xl bg-board">
          <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-[#d8e6dd]">{pretty}</pre>
          <div className="space-y-1 border-t border-white/10 px-4 py-3 font-mono text-[11.5px] break-all text-trace">
            <div>
              <span className="text-white/60">sig </span>
              {proof.sig}
            </div>
            <div>
              <span className="text-white/60">examiner </span>
              {proof.examiner_id} · key {proof.fingerprint}
            </div>
          </div>
        </div>
      </section>

      {a.status === 'verified' && (
        <section>
          <SectionTitle>Checks the platform ran before accepting it</SectionTitle>
          <ul className="space-y-2">
            {SERVER_CHECKS.map((c) => (
              <li key={c} className="flex items-start gap-2 text-sm">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-proof" /> {c}
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.status === 'rejected' && <ErrorNote>The platform rejected this verdict: {a.reject_reason}</ErrorNote>}

      <section>
        <SectionTitle>Verify it yourself</SectionTitle>
        <Card className="p-5">
          <p className="text-sm text-ink-2">
            Your browser checks the signature with WebCrypto against the examiner’s public key. Change one character of the payload and it stops verifying.
          </p>
          <textarea
            value={payload}
            onChange={(e) => {
              setPayload(e.target.value);
              setCheck({ state: 'idle' });
            }}
            rows={4}
            spellCheck={false}
            className={cx('mt-4 w-full rounded-lg border bg-paper p-3 font-mono text-xs', edited ? 'border-claim' : 'border-line-2')}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={verify} disabled={check.state === 'busy'}>
              {check.state === 'busy' && <Spinner />} Verify signature
            </Button>
            <Button kind="secondary" onClick={tamper}>
              Flip the result
            </Button>
            {edited && (
              <Button
                kind="ghost"
                onClick={() => {
                  setPayload(proof.payload);
                  setCheck({ state: 'idle' });
                }}
              >
                Restore original
              </Button>
            )}
          </div>
          {check.state === 'done' &&
            (check.ok ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-proof-soft px-3 py-2 text-sm font-medium text-proof">
                <CheckIcon className="h-4 w-4" /> Valid. The examiner signed exactly this payload.
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-fail-soft px-3 py-2 text-sm font-medium text-fail">
                <CrossIcon className="h-4 w-4" /> Invalid. This payload is not what the examiner signed.
              </div>
            ))}
          {check.state === 'error' && <div className="mt-4"><ErrorNote>{check.message}</ErrorNote></div>}
          <details className="mt-5">
            <summary className="cursor-pointer text-sm text-muted">Examiner public key</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-paper p-3 font-mono text-[11px]">{proof.examiner_pubkey}</pre>
          </details>
        </Card>
      </section>

      <div className="text-sm">
        <Link to={`/u/${a.user.id}`} className="text-wire hover:underline">
          ← {a.user.name}’s profile
        </Link>
      </div>
    </div>
  );
}
