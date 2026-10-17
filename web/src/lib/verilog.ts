import { StreamLanguage } from '@codemirror/language';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';

export const verilogLanguage = StreamLanguage.define(verilog);
