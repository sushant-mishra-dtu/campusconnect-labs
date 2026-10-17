// Early, friendly errors for code that can't work on the board. This is not the security
// boundary: macros can spell any task past a regex. The boundary is that yosys runs in a
// WebAssembly sandbox with only dut.v in its filesystem, and only the synthesized netlist
// (iCE40 primitives, no system tasks) is ever simulated.

const FORBIDDEN_TASKS =
  /\$(system|f(?:open|close|write|display|monitor|strobe|scanf|gets|getc|read|seek|tell|flush|eof|error|rewind|ungetc)\w*|s?readmem\w*|writemem\w*|dump\w*|value\$plusargs|test\$plusargs|finish|stop|exit)\b/;

function stripComments(code: string) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

export function lintStudentCode(code: string): string | null {
  const src = stripComments(code);
  if (!/\bmodule\s+top\b/.test(src)) return 'Your design must define `module top` with the harness ports.';
  if (/\bmodule\s+tb\b/.test(src)) return 'The module name `tb` is reserved for the examiner.';
  if (/`\s*include\b/.test(src)) return '`include is not allowed. Put everything in one file.';
  const task = FORBIDDEN_TASKS.exec(src);
  if (task) return `System task $${task[1]} is not allowed in submitted designs.`;
  return null;
}
