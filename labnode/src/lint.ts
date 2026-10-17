// Student code runs on someone else's machine. Before anything is compiled, refuse the
// system tasks that touch files or end the examiner early, and `include.
// (Proper sandboxing of the toolchain is on the roadmap.)

const FORBIDDEN_TASKS =
  /\$(system|fopen|fclose|fwrite[bho]?|fdisplay[bho]?|fmonitor|fstrobe|fscanf|fgets|fgetc|fread|readmem[bh]|writemem[bh]|dumpfile|dumpvars|dumpall|value\$plusargs|test\$plusargs|finish|stop)\b/;

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
