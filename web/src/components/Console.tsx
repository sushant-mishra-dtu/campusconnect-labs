import { useEffect, useRef } from 'react';
import { cx } from './ui';

function tone(line: string) {
  if (line.includes('✗') || /\b(error|ERROR|failed)\b/.test(line)) return 'text-[#ff8f7a]';
  if (line.includes('✓') || line.includes('verdict accepted') || line.includes('badge issued')) return 'text-proof-bright';
  if (line.startsWith('[examiner]')) return 'text-[#f2c76e]';
  if (line.startsWith('[platform]')) return 'text-white';
  return 'text-trace';
}

export function Console({ lines, placeholder }: { lines: string[]; placeholder: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length]);

  return (
    <div className="console-scroll h-full overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.65]" role="log" aria-live="polite">
      {lines.length === 0 && <div className="text-trace/60">{placeholder}</div>}
      {lines.map((l, i) => (
        <div key={i} className={cx('break-words whitespace-pre-wrap', tone(l))}>
          {l}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
