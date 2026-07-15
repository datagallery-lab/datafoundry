import React from 'react';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'node:test';
import { render } from 'ink';
import { CommandHistory } from '../keybindings.js';
import { EnhancedInputBox, inputLineFragments } from './EnhancedInputBox.js';

const waitForInput = () => new Promise<void>((resolve) => setImmediate(resolve));

type TestInput = PassThrough & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
  ref: () => TestInput;
  unref: () => TestInput;
};

type TestOutput = PassThrough & {
  columns: number;
  rows: number;
  isTTY: boolean;
};

const activeViews: Array<ReturnType<typeof render>> = [];

function renderInputBox(element: React.ReactElement) {
  const stdin = new PassThrough() as TestInput;
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (mode) => {
    stdin.isRaw = mode;
  };
  stdin.ref = () => stdin;
  stdin.unref = () => stdin;

  const stdout = new PassThrough() as TestOutput;
  stdout.columns = 100;
  stdout.rows = 40;
  stdout.isTTY = true;
  const stderr = new PassThrough() as TestOutput;
  stderr.columns = 100;
  stderr.rows = 40;
  stderr.isTTY = true;
  const output: string[] = [];
  stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  const view = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  });
  activeViews.push(view);
  return { ...view, stdin, output };
}

afterEach(() => {
  for (const view of activeViews.splice(0)) {
    view.unmount();
    view.cleanup();
  }
});

describe('EnhancedInputBox paste handling', () => {
  it('folds a paste over 1000 characters and expands it on submit', async () => {
    const changes: string[] = [];
    const submissions: string[] = [];
    const largePaste = 'x'.repeat(1001);
    const view = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        onChange={(value) => changes.push(value)}
        onSubmit={(value) => submissions.push(value)}
      />,
    );
    await waitForInput();

    view.stdin.write(`\x1b[200~${largePaste}\x1b[201~`);
    await waitForInput();

    assert.equal(changes.at(-1), '[Pasted Content 1001 chars]');
    assert.match(view.output.join(''), /\[Pasted Content 1001 chars\]/);
    assert.deepEqual(
      inputLineFragments('before [Pasted Content 1001 chars] after', null),
      [
        { text: 'before ', isPastePlaceholder: false, hasCursor: false },
        {
          text: '[Pasted Content 1001 chars]',
          isPastePlaceholder: true,
          hasCursor: false,
        },
        { text: ' after', isPastePlaceholder: false, hasCursor: false },
      ],
    );

    view.stdin.write('\r');
    await waitForInput();

    assert.deepEqual(submissions, [largePaste]);
  });

  it('folds a paste with more than 10 lines', async () => {
    const changes: string[] = [];
    const multiLinePaste = Array.from({ length: 11 }, () => 'line').join('\n');
    const view = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        onChange={(value) => changes.push(value)}
        onSubmit={() => {}}
      />,
    );
    await waitForInput();

    view.stdin.write(`\x1b[200~${multiLinePaste}\x1b[201~`);
    await waitForInput();

    assert.equal(
      changes.at(-1),
      `[Pasted Content ${multiLinePaste.length} chars]`,
    );
  });

  it('keeps a small multiline paste editable in the buffer', async () => {
    const changes: string[] = [];
    const view = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        onChange={(value) => changes.push(value)}
        onSubmit={() => {}}
      />,
    );
    await waitForInput();

    view.stdin.write('\x1b[200~first\nsecond\x1b[201~');
    await waitForInput();

    assert.equal(changes.at(-1), 'first\nsecond');
  });
});

describe('EnhancedInputBox history navigation', () => {
  it('moves to the first column before restoring older history', async () => {
    const history = new CommandHistory();
    history.add('previous command');
    const changes: string[] = [];
    const view = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        history={history}
        onChange={(value) => changes.push(value)}
        onSubmit={() => {}}
      />,
    );
    await waitForInput();

    view.stdin.write('draft');
    await waitForInput();
    const callsAfterTyping = changes.length;

    view.stdin.write('\x1b[A');
    await waitForInput();

    assert.equal(changes.at(-1), 'draft');
    assert.equal(changes.length, callsAfterTyping);

    view.stdin.write('\x1b[A');
    await waitForInput();

    assert.equal(changes.at(-1), 'previous command');

    view.stdin.write('X');
    await waitForInput();

    assert.equal(changes.at(-1), 'Xprevious command');
  });

  it('moves to the last column before restoring the original draft', async () => {
    const history = new CommandHistory();
    history.add('previous command');
    const changes: string[] = [];
    const view = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        history={history}
        onChange={(value) => changes.push(value)}
        onSubmit={() => {}}
      />,
    );
    await waitForInput();

    view.stdin.write('draft');
    await waitForInput();
    view.stdin.write('\x1b[A');
    await waitForInput();
    view.stdin.write('\x1b[A');
    await waitForInput();
    const callsAfterHistoryRestore = changes.length;

    view.stdin.write('\x1b[B');
    await waitForInput();

    assert.equal(changes.at(-1), 'previous command');
    assert.equal(changes.length, callsAfterHistoryRestore);

    view.stdin.write('\x1b[B');
    await waitForInput();

    assert.equal(changes.at(-1), 'draft');
  });

  it('retains submitted history when the composer is remounted', async () => {
    const history = new CommandHistory();
    const firstSubmissions: string[] = [];
    const firstView = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        history={history}
        onChange={() => {}}
        onSubmit={(value) => firstSubmissions.push(value)}
      />,
    );
    await waitForInput();

    firstView.stdin.write('remember me');
    await waitForInput();
    firstView.stdin.write('\r');
    await waitForInput();
    assert.deepEqual(firstSubmissions, ['remember me']);
    firstView.unmount();

    const changes: string[] = [];
    const secondView = renderInputBox(
      <EnhancedInputBox
        commands={[]}
        history={history}
        onChange={(value) => changes.push(value)}
        onSubmit={() => {}}
      />,
    );
    await waitForInput();

    secondView.stdin.write('\x1b[A');
    await waitForInput();

    assert.equal(changes.at(-1), 'remember me');
  });
});
