import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runCodebuddyTurn } from '../../src/runner/index.js';

function ensureWorkspaceDir(name: string): string {
  const workspacePath = path.join(os.tmpdir(), name);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

describe('runCodebuddyTurn', () => {
  it('maps CodeBuddy NDJSON output into structured runner events', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-success');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-1',model:'cb',permissionMode:'default',tools:['cnb_api']}));",
            "console.log(JSON.stringify({type:'assistant',message:{content:[{type:'output_text',text:'working'}]}}));",
            "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:12,num_turns:1,usage:{input_tokens:10,output_tokens:4}}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.events).toEqual([
      {
        event: 'session_started',
        payload: {
          model: 'cb',
          permissionMode: 'default',
          sessionId: 'session-1',
          tools: ['cnb_api'],
        },
      },
      {
        event: 'notification',
        payload: {
          raw: {
            message: {
              content: [{ text: 'working', type: 'output_text' }],
            },
            type: 'assistant',
          },
          message: 'working',
        },
      },
      {
        event: 'turn_completed',
        payload: {
          durationMs: 12,
          numTurns: 1,
          usage: {
            input_tokens: 10,
            output_tokens: 4,
          },
        },
      },
    ]);
  });

  it('emits malformed events for invalid json lines without aborting the turn', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-malformed');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log('not-json');",
            "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.events[0]).toEqual({
      event: 'malformed',
      payload: {
        line: 'not-json',
      },
    });
    expect(result.events[1]).toEqual({
      event: 'turn_completed',
      payload: {},
    });
  });

  it('strips terminal control sequences before parsing NDJSON lines', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-control-sequences');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "process.stdout.write('\\u001b]0;title\\u0007' + JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'OK'}]}}) + '\\n');",
            "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.events).toEqual([
      {
        event: 'notification',
        payload: {
          raw: {
            message: {
              content: [{ text: 'OK', type: 'text' }],
            },
            type: 'assistant',
          },
          message: 'OK',
        },
      },
      {
        event: 'turn_completed',
        payload: {},
      },
    ]);
  });

  it('ignores non-init system events and user tool-result events in stream-json output', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-non-terminal-events');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-4'}));",
            "console.log(JSON.stringify({type:'system',subtype:'status',status:null}));",
            "console.log(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'1',content:[{type:'text',text:'ok'}]}]}}));",
            "console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:20,num_turns:1,usage:{input_tokens:2,output_tokens:1}}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.events).toEqual([
      {
        event: 'session_started',
        payload: {
          sessionId: 'session-4',
          model: undefined,
          permissionMode: undefined,
          tools: undefined,
        },
      },
      {
        event: 'other_message',
        payload: {
          raw: { type: 'system', subtype: 'status', status: null },
        },
      },
      {
        event: 'other_message',
        payload: {
          raw: {
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: '1',
                content: [{ type: 'text', text: 'ok' }],
              }],
            },
          },
        },
      },
      {
        event: 'turn_completed',
        payload: {
          durationMs: 20,
          numTurns: 1,
          usage: {
            input_tokens: 2,
            output_tokens: 1,
          },
        },
      },
    ]);
  });

  it('maps permission denials into turn_input_required events', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-approval');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log(JSON.stringify({type:'result',subtype:'approval_required',result:'approval required',session_id:'session-2',is_error:true,permission_denials:[{kind:'exec'}]}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.events).toEqual([
      {
        event: 'turn_input_required',
        payload: {
          message: 'approval required',
          sessionId: 'session-2',
          permissionDenials: 1,
        },
      },
    ]);
  });

  it('maps auto-approved results into approval_auto_approved events', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-auto-approved');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log(JSON.stringify({type:'result',subtype:'approval_auto_approved',result:'auto approved',session_id:'session-3',is_error:false}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.events).toEqual([
      {
        event: 'approval_auto_approved',
        payload: {
          message: 'auto approved',
          sessionId: 'session-3',
        },
      },
    ]);
  });

  it('emits turn_failed when the subprocess exits non-zero before any result event', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-failure');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "process.stderr.write('boom\\n');",
            'process.exit(7);',
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toEqual(['boom']);
    expect(result.events).toEqual([
      {
        event: 'turn_failed',
        payload: {
          exitCode: 7,
          stderr: ['boom'],
        },
      },
    ]);
  });

  it('kills the subprocess when the turn timeout is exceeded', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-timeout');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          'setTimeout(() => console.log(JSON.stringify({type:"result",subtype:"success",is_error:false})), 1000);',
        ],
        cwd: workspacePath,
      },
      turnTimeoutMs: 50,
    });

    expect(result.exitCode).toBeNull();
    expect(result.events).toEqual([
      {
        event: 'turn_timed_out',
        payload: {
          timeoutMs: 50,
        },
      },
    ]);
  });

  it('kills the subprocess when the output stream stalls for too long', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-stall');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log(JSON.stringify({type:'assistant',message:{content:[{type:'output_text',text:'working'}]}}));",
            'setTimeout(() => console.log(JSON.stringify({type:"result",subtype:"success",is_error:false})), 1000);',
          ].join(''),
        ],
        cwd: workspacePath,
      },
      stallTimeoutMs: 50,
    });

    expect(result.exitCode).toBeNull();
    expect(result.events).toEqual([
      {
        event: 'turn_stalled',
        payload: {
          timeoutMs: 50,
        },
      },
    ]);
  });

  it('maps max-turns-exceeded result as turn_completed for continuation', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-max-turns');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          [
            "console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-mt'}));",
            "console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,duration_ms:170000,num_turns:54,usage:{input_tokens:1000,output_tokens:500},permission_denials:[],errors:['Max turns (20) exceeded']}));",
          ].join(''),
        ],
        cwd: workspacePath,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.events[0]).toEqual({
      event: 'session_started',
      payload: {
        sessionId: 'session-mt',
        model: undefined,
        permissionMode: undefined,
        tools: undefined,
      },
    });
    expect(result.events[1]).toEqual({
      event: 'turn_completed',
      payload: {
        durationMs: 170000,
        numTurns: 54,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
      },
    });
  });

  it('kills the subprocess when no output is received before the read timeout', async () => {
    const workspacePath = ensureWorkspaceDir('agentfirst-runner-read-timeout');
    const result = await runCodebuddyTurn({
      command: {
        command: 'node',
        args: [
          '-e',
          'setTimeout(() => console.log(JSON.stringify({type:"result",subtype:"success",is_error:false})), 1000);',
        ],
        cwd: workspacePath,
      },
      readTimeoutMs: 50,
      stallTimeoutMs: 200,
    });

    expect(result.exitCode).toBeNull();
    expect(result.events).toEqual([
      {
        event: 'turn_read_timed_out',
        payload: {
          timeoutMs: 50,
        },
      },
    ]);
  });
});
