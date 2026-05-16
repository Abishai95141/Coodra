/**
 * `CommandsView` — the TUI's `/02` tab: the full command catalog,
 * derived from the real program surface and grouped by intent into
 * `/NN` categories. ↑/↓ moves the phosphor cursor; ⏎ inserts the
 * selected command (with its argument placeholders) into the Terminal
 * prompt and switches to that tab.
 *
 * The catalog is ~55 commands, so the view is a scroll window: it
 * renders a viewport-sized slice of rows centred on the selection, with
 * `↑ N more` / `↓ N more` affordances. The command-name column is sized
 * to the longest command so every description stays aligned.
 */

import { Box, Text, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { CommandRow, SectionHead, useTerminalSize } from '../../ui/ink/index.js';
import { palette } from '../../ui/theme.js';
import {
  ALL_CATALOG_COMMANDS,
  CATALOG_COMMAND_COUNT,
  type CatalogCommand,
  COMMAND_CATALOG,
} from '../command-catalog.js';

export interface CommandsViewProps {
  readonly active: boolean;
  /** Insert the chosen command line (with arg placeholders) into the Terminal prompt. */
  readonly onSelect: (command: string) => void;
}

/** A rendered row — a category head or a command. */
type CatalogRow =
  | { readonly kind: 'head'; readonly num: string; readonly title: string }
  | { readonly kind: 'cmd'; readonly cmd: CatalogCommand; readonly flatIndex: number };

export function CommandsView({ active, onSelect }: CommandsViewProps) {
  const { exit } = useApp();
  const { rows: termRows } = useTerminalSize();
  const [index, setIndex] = useState(0);

  useInput(
    (char, key) => {
      if (char === 'q') {
        exit();
        return;
      }
      if (key.upArrow) {
        setIndex((i) => (i - 1 + CATALOG_COMMAND_COUNT) % CATALOG_COMMAND_COUNT);
      } else if (key.downArrow) {
        setIndex((i) => (i + 1) % CATALOG_COMMAND_COUNT);
      } else if (key.return) {
        const cmd = ALL_CATALOG_COMMANDS[index];
        if (cmd !== undefined) {
          // When the command has positional-argument placeholders (e.g.
          // `coodra export <runId>`), insert the placeholder-free
          // `coodra export ` (trailing space) into the prompt so the
          // cursor lands where the user needs to type the value —
          // instead of injecting the literal `<runId>` which trips
          // `parseCommandInput` into passing the placeholder text as
          // the real argument. When there are no placeholders the
          // display and the command are equal — insert the command
          // alone, no trailing space.
          const inserted = cmd.display === cmd.command ? cmd.command : `${cmd.command} `;
          onSelect(inserted);
        }
      }
    },
    { isActive: active },
  );

  // Command-name column sized to the longest command — keeps every
  // description aligned regardless of name length.
  const nameWidth = useMemo(() => ALL_CATALOG_COMMANDS.reduce((max, c) => Math.max(max, c.command.length), 0) + 2, []);

  // Flat row list (heads + commands) — the scroll window slices this.
  const rows = useMemo<readonly CatalogRow[]>(() => {
    const out: CatalogRow[] = [];
    let flatIndex = 0;
    for (const category of COMMAND_CATALOG) {
      out.push({ kind: 'head', num: category.num, title: category.title });
      for (const cmd of category.commands) {
        out.push({ kind: 'cmd', cmd, flatIndex });
        flatIndex += 1;
      }
    }
    return out;
  }, []);

  const selected = ALL_CATALOG_COMMANDS[index];
  const selectedRow = rows.findIndex((r) => r.kind === 'cmd' && r.flatIndex === index);
  // Viewport: terminal height less the chrome (top bar, footer, the
  // ⏎-hint line, the more-above/below lines, padding).
  const viewport = Math.max(6, termRows - 10);
  const start = Math.max(0, Math.min(selectedRow - Math.floor(viewport / 2), rows.length - viewport));
  const end = Math.min(rows.length, start + viewport);
  const visible = rows.slice(start, end);
  const moreAbove = start;
  const moreBelow = rows.length - end;

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      {moreAbove > 0 ? <Text color={palette.inkFar}>{`  ↑ ${moreAbove} more`}</Text> : null}

      {visible.map((row) =>
        row.kind === 'head' ? (
          <SectionHead key={`head-${row.num}`} num={row.num} title={row.title} />
        ) : (
          <CommandRow
            key={row.cmd.id}
            active={row.flatIndex === index}
            name={row.cmd.command}
            description={row.cmd.description}
            nameWidth={nameWidth}
          />
        ),
      )}

      {moreBelow > 0 ? <Text color={palette.inkFar}>{`  ↓ ${moreBelow} more`}</Text> : null}

      {selected !== undefined ? (
        <Box marginTop={1}>
          <Text color={palette.inkFar}>{'  ⏎ '}</Text>
          <Text dimColor>insert in terminal</Text>
          {selected.interactive ? (
            <Text color={palette.inkFar}> · needs its own terminal (interactive)</Text>
          ) : (
            <Text color={palette.inkFar}> · runs in /01 terminal</Text>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
