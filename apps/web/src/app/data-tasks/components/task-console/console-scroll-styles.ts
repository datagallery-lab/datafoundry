/** Shared overflow helpers for the resizable right console at narrow widths. */
import { codeBlockClass, dataTableShellClass } from "../../ui-tokens";

export const consoleScrollXShellClass =
  "max-w-full overflow-x-auto overscroll-x-contain";

export const consoleCodeBlockBaseClass = codeBlockClass;

export const consoleCodeInnerClass = "block min-w-max whitespace-pre font-mono";

export const consoleTableShellClass = dataTableShellClass;
