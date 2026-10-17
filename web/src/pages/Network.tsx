import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ConnectionType, NetworkData, Role } from '../api';
import { EDGE_COLOR, EDGE_LABEL } from '../components/ConnectionCard';
import { Card, ErrorNote, Loading, SectionTitle, cx, roleLabel, timeAgo } from '../components/ui';
import { useApi } from '../hooks';
import { useLiveRefresh } from '../live';

interface GNode extends SimulationNodeDatum {
  id: string;
  name: string;
  role: Role;
  hue: number;
  badges: number;
  headline: string;
}

interface GLink extends SimulationLinkDatum<GNode> {
  id: string;
  type: ConnectionType;
  created_at: number;
  attempt_id: string | null;
  lane: number;
}

const TYPES: ConnectionType[] = ['proved_for', 'lent_board', 'referred', 'mentored'];
const HEIGHT = 560;

function radius(n: GNode) {
  return 13 + Math.min(n.badges, 4) * 2.5;
}

function Shape({ n, r }: { n: GNode; r: number }) {
  const fill = `hsl(${n.hue} 55% 88%)`;
  const stroke = `hsl(${n.hue} 45% 30%)`;
  if (n.role === 'club') {
    return <rect x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} transform="rotate(45)" fill={fill} stroke={stroke} strokeWidth={1.5} />;
  }
  if (n.role !== 'student') {
    return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.35} fill={fill} stroke={stroke} strokeWidth={1.5} />;
  }
  return <circle r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />;
}

export function Network() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<NetworkData>('/network');
  useLiveRefresh(['network'], () => void reload());

  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<ConnectionType>>(new Set());
  const sim = useRef<Simulation<GNode, GLink> | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const drag = useRef<{ node: GNode; moved: boolean } | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => {
    if (!data) return null;
    const nodes: GNode[] = data.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      role: n.role,
      hue: n.hue,
      badges: n.badges,
      headline: n.headline,
      ...(positions.current.get(n.id) ?? {}),
    }));
    // Spread parallel edges between the same pair into separate curved lanes.
    const pairCount = new Map<string, number>();
    const links: GLink[] = data.edges.map((e) => {
      const key = [e.source, e.target].sort().join('|');
      const lane = pairCount.get(key) ?? 0;
      pairCount.set(key, lane + 1);
      return { id: e.id, source: e.source, target: e.target, type: e.type, created_at: e.created_at, attempt_id: e.attempt_id, lane };
    });
    return { nodes, links };
  }, [data]);

  useEffect(() => {
    if (!graph) return;
    sim.current?.stop();
    const s = forceSimulation<GNode>(graph.nodes)
      .force('link', forceLink<GNode, GLink>(graph.links).id((d) => d.id).distance(110).strength(0.5))
      .force('charge', forceManyBody().strength(-420))
      .force('center', forceCenter(width / 2, HEIGHT / 2))
      .force('collide', forceCollide<GNode>().radius((d) => radius(d) + 18))
      .alpha(positions.current.size ? 0.3 : 1)
      .on('tick', () => {
        for (const n of graph.nodes) {
          n.x = Math.max(30, Math.min(width - 30, n.x ?? 0));
          n.y = Math.max(30, Math.min(HEIGHT - 30, n.y ?? 0));
          positions.current.set(n.id, { x: n.x, y: n.y });
        }
        setTick((t) => t + 1);
      });
    sim.current = s;
    return () => {
      s.stop();
    };
  }, [graph, width]);

  if (loading) return <Loading />;
  if (error || !data || !graph) return <ErrorNote>{error ?? 'No data'}</ErrorNote>;

  const counts = Object.fromEntries(TYPES.map((t) => [t, data.edges.filter((e) => e.type === t).length])) as Record<ConnectionType, number>;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const recent = [...data.edges].sort((a, b) => b.created_at - a.created_at).slice(0, 8);
  const now = Date.now();
  const linked = (l: GLink) => hover && ((l.source as GNode).id === hover || (l.target as GNode).id === hover);

  const onPointerDown = (e: React.PointerEvent, n: GNode) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { node: n, moved: false };
    sim.current?.alphaTarget(0.2).restart();
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    drag.current.node.fx = e.clientX - box.left;
    drag.current.node.fy = e.clientY - box.top;
    drag.current.moved = true;
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { node, moved } = drag.current;
    node.fx = null;
    node.fy = null;
    drag.current = null;
    sim.current?.alphaTarget(0);
    if (!moved) navigate(`/u/${node.id}`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">The network</h1>
          <p className="mt-1 max-w-2xl text-ink-2">Every edge points to something that happened: a challenge passed, a board lent, a referral sent, a mentorship started. There are no follow buttons.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(t)) next.delete(t);
                  else next.add(t);
                  return next;
                })
              }
              className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', hidden.has(t) ? 'border-line text-muted' : 'border-line-2 bg-card')}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: hidden.has(t) ? '#d2cec4' : EDGE_COLOR[t] }} />
              {t} <span className="font-mono text-muted">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_17rem]">
        <Card className="overflow-hidden">
          <div ref={wrap} className="relative">
            <svg width={width} height={HEIGHT} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="block touch-none select-none">
              <defs>
                {TYPES.map((t) => (
                  <marker key={t} id={`arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill={EDGE_COLOR[t]} />
                  </marker>
                ))}
              </defs>
              <g>
                {graph.links
                  .filter((l) => !hidden.has(l.type))
                  .map((l) => {
                    const s = l.source as GNode;
                    const t = l.target as GNode;
                    if (s.x == null || t.x == null || s.y == null || t.y == null) return null;
                    const dx = t.x - s.x;
                    const dy = t.y - s.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const bend = (l.lane - 0.5) * 34 + (l.lane === 0 ? 17 : 0);
                    const mx = (s.x + t.x) / 2 - (dy / len) * bend;
                    const my = (s.y + t.y) / 2 + (dx / len) * bend;
                    // stop the arrow at the target's edge
                    const ex = t.x - ((t.x - mx) / Math.hypot(t.x - mx, t.y - my)) * (radius(t) + 4);
                    const ey = t.y - ((t.y - my) / Math.hypot(t.x - mx, t.y - my)) * (radius(t) + 4);
                    const fresh = now - l.created_at < 120_000;
                    const dim = hover && !linked(l);
                    return (
                      <path
                        key={l.id}
                        d={`M${s.x},${s.y} Q${mx},${my} ${ex},${ey}`}
                        fill="none"
                        stroke={EDGE_COLOR[l.type]}
                        strokeWidth={fresh ? 3.5 : linked(l) ? 2.5 : 1.6}
                        strokeOpacity={dim ? 0.12 : 0.85}
                        markerEnd={`url(#arrow-${l.type})`}
                        className={fresh ? 'animate-pulse-dot' : undefined}
                      >
                        <title>
                          {s.name} {EDGE_LABEL[l.type]} {t.name}
                        </title>
                      </path>
                    );
                  })}
              </g>
              <g>
                {graph.nodes.map((n) => {
                  if (n.x == null || n.y == null) return null;
                  const r = radius(n);
                  const dim = hover && hover !== n.id && !graph.links.some((l) => linked(l) && ((l.source as GNode).id === n.id || (l.target as GNode).id === n.id));
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      opacity={dim ? 0.3 : 1}
                      onPointerEnter={() => setHover(n.id)}
                      onPointerLeave={() => setHover(null)}
                      onPointerDown={(e) => onPointerDown(e, n)}
                      className="cursor-pointer"
                    >
                      <Shape n={n} r={r} />
                      <text textAnchor="middle" dy="0.35em" fontSize={r * 0.75} fontWeight={600} fill={`hsl(${n.hue} 45% 28%)`} pointerEvents="none">
                        {n.name
                          .split(' ')
                          .map((p) => p[0])
                          .join('')
                          .slice(0, 2)}
                      </text>
                      <text textAnchor="middle" y={r + 14} fontSize={11.5} fill="#3d4149" pointerEvents="none">
                        {n.name.split(' ')[0]}
                      </text>
                      <title>
                        {n.name} · {roleLabel(n.role)} · {n.headline}
                      </title>
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-card/90 px-3 py-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="5" fill="#eee" stroke="#555" /></svg> student
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" aria-hidden><rect x="1" y="1" width="10" height="10" rx="3" fill="#eee" stroke="#555" /></svg> alum · recruiter · founder
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" aria-hidden><rect x="2.5" y="2.5" width="7" height="7" transform="rotate(45 6 6)" fill="#eee" stroke="#555" /></svg> club
              </span>
            </div>
          </div>
        </Card>

        <aside>
          <SectionTitle>Latest connections</SectionTitle>
          <ul className="space-y-2.5">
            {recent.map((e) => {
              const from = byId.get(e.source);
              const to = byId.get(e.target);
              if (!from || !to) return null;
              return (
                <li key={e.id} className="text-sm">
                  <Link to={`/u/${from.id}`} className="font-medium hover:underline">
                    {from.name.split(' ')[0]}
                  </Link>{' '}
                  <span className="font-mono text-[12px]" style={{ color: EDGE_COLOR[e.type] }}>
                    {e.type}
                  </span>{' '}
                  <Link to={`/u/${to.id}`} className="font-medium hover:underline">
                    {to.name.split(' ')[0]}
                  </Link>
                  <div className="text-xs text-muted">
                    {timeAgo(e.created_at)}
                    {e.attempt_id && (
                      <>
                        {' · '}
                        <Link to={`/proof/${e.attempt_id}`} className="text-wire hover:underline">
                          proof
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
