// Talks to the ESP32-S3 examiner over USB serial (line-delimited JSON, 115200 baud).
// The examiner drives the FPGA's inputs, measures its outputs and signs the verdict
// with a P-256 key that never leaves the chip. This side only relays.
import type { SignedVerdict } from '../payload.js';
import type { ExaminerIdentity } from './sim.js';

type Msg =
  | { type: 'info'; examiner: string; kind: 'esp32'; pubkey: string; counter: number }
  | { type: 'log'; line: string }
  | { type: 'verdict'; payload: string; sig: string }
  | { type: 'error'; message: string };

export class SerialExaminer {
  private listeners = new Set<(m: Msg) => void>();
  identity!: ExaminerIdentity;

  private constructor(private port: { write(data: string): void }) {}

  static async open(path: string): Promise<SerialExaminer> {
    // Optional dependency: only needed on nodes with real hardware.
    const { SerialPort, ReadlineParser } = await import('serialport');
    const port = new SerialPort({ path, baudRate: 115200 });
    await new Promise<void>((resolve, reject) => port.once('open', resolve).once('error', reject));
    const ex = new SerialExaminer(port);
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line: string) => {
      const text = line.trim();
      if (!text.startsWith('{')) return; // boot chatter from the ESP32 ROM
      try {
        const m = JSON.parse(text) as Msg;
        for (const l of ex.listeners) l(m);
      } catch {
        // ignore partial lines
      }
    });
    const info = await ex.request<Extract<Msg, { type: 'info' }>>({ cmd: 'info' }, 'info', 5000);
    ex.identity = { id: info.examiner, kind: 'esp32', pubkey: info.pubkey };
    return ex;
  }

  private request<T extends Msg>(cmd: object, want: T['type'], timeoutMs: number, onLog?: (l: string) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`examiner did not answer within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      const listener = (m: Msg) => {
        if (m.type === 'log') onLog?.(m.line);
        else if (m.type === 'error') {
          clearTimeout(timer);
          this.listeners.delete(listener);
          reject(new Error(m.message));
        } else if (m.type === want) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(m as T);
        }
      };
      this.listeners.add(listener);
      this.port.write(JSON.stringify(cmd) + '\n');
    });
  }

  async run(job: { attempt: string; challenge: string; node: string; nonce: string }, onLog: (l: string) => void, timeoutSec: number): Promise<SignedVerdict> {
    const v = await this.request<Extract<Msg, { type: 'verdict' }>>({ cmd: 'run', ...job }, 'verdict', timeoutSec * 1000, onLog);
    return { payload: v.payload, sig: v.sig };
  }
}
