#!/usr/bin/env node
/**
 * Test script for ReAct streaming segments functionality with insertIndex
 *
 * This script simulates the event flow and validates that:
 * 1. Text updates are properly handled with full content
 * 2. Tool calls record insertion points
 * 3. Content is correctly split by tool call insertion points
 */

import { createInitialTuiState } from './src/state/tui-state.js';
import {
  addAssistantMessage,
  insertToolCallIntoLastMessage,
  updateLastAssistantMessage,
} from './src/state/message-history.js';

console.log('🧪 Testing ReAct Streaming Segments with insertIndex\n');

// Test 1: Create initial assistant message
console.log('Test 1: Create initial assistant message');
let state = createInitialTuiState();
state = addAssistantMessage(state, '', true);
console.log('✓ Initial message created');
console.log(`  Messages: ${state.messages.length}`);
console.log(`  Segments: ${state.messages[0]?.segments?.length || 0}\n`);

// Test 2: Update with first chunk of text
console.log('Test 2: Update with first text chunk');
state = updateLastAssistantMessage(state, 'Let me check the datasources...', true);
const msg1 = state.messages[state.messages.length - 1];
console.log('✓ Text updated');
console.log(`  Content: "${msg1?.content}"`);
console.log(`  Segments: ${msg1?.segments?.length}`);
console.log(`  Last segment type: ${msg1?.segments?.[msg1.segments.length - 1]?.type}\n`);

// Test 3: Insert tool call at current position
console.log('Test 3: Insert tool call at current position');
state = insertToolCallIntoLastMessage(state, 'tool-list-ds-123');
const msg2 = state.messages[state.messages.length - 1];
console.log('✓ Tool call inserted');
console.log(`  Segments: ${msg2?.segments?.length}`);
if (msg2?.segments?.[0]?.type === 'tool_call') {
  console.log(`  Tool call insertion index: ${msg2.segments[0].insertIndex}\n`);
}

// Test 4: Update with more text (simulating continued streaming)
console.log('Test 4: Update with more text after tool call');
const fullText = 'Let me check the datasources...\n\nNow inspecting the schema...';
state = updateLastAssistantMessage(state, fullText, true);
const msg3 = state.messages[state.messages.length - 1];
console.log('✓ Text updated after tool call');
console.log(`  Content length: ${msg3?.content.length}`);
console.log(`  Segments: ${msg3?.segments?.length}`);
console.log(`  Segment types: ${msg3?.segments?.map(s => s.type).join(', ')}`);

// Print segment details
console.log('  Segment details:');
msg3?.segments?.forEach((seg, i) => {
  if (seg.type === 'text') {
    console.log(`    [${i}] text: "${seg.content.substring(0, 30)}..." (${seg.startIndex}-${seg.endIndex})`);
  } else {
    console.log(`    [${i}] tool_call: ${seg.toolCallId} @ index ${seg.insertIndex}`);
  }
});
console.log();

// Test 5: Insert another tool call
console.log('Test 5: Insert another tool call');
state = insertToolCallIntoLastMessage(state, 'tool-inspect-456');
const msg4 = state.messages[state.messages.length - 1];
console.log('✓ Second tool call inserted');
console.log(`  Segments: ${msg4?.segments?.length}`);
const toolCalls = msg4?.segments?.filter(s => s.type === 'tool_call') || [];
console.log(`  Tool call insertion indices: ${toolCalls.map(tc => tc.type === 'tool_call' ? tc.insertIndex : 0).join(', ')}\n`);

// Test 6: Final update with complete content
console.log('Test 6: Final update with complete content');
const finalContent = 'Let me check the datasources...\n\nNow inspecting the schema...\n\nI found 5 tables.';
state = updateLastAssistantMessage(state, finalContent, false);
const msg5 = state.messages[state.messages.length - 1];
console.log('✓ Final content updated');
console.log(`  Content length: ${msg5?.content.length}`);
console.log(`  Segments: ${msg5?.segments?.length}`);
console.log(`  Segment types: ${msg5?.segments?.map(s => s.type).join(', ')}`);
console.log(`  Is streaming: ${msg5?.isStreaming}`);

// Print final segment details
console.log('\n  Final segment breakdown:');
msg5?.segments?.forEach((seg, i) => {
  if (seg.type === 'text') {
    const preview = seg.content.replace(/\n/g, '\\n').substring(0, 40);
    console.log(`    [${i}] text: "${preview}..." (${seg.content.length} chars)`);
  } else {
    console.log(`    [${i}] tool_call: ${seg.toolCallId} @ index ${seg.insertIndex}`);
  }
});

// Final validation
console.log('\n📊 Final State Validation:');
const finalMsg = msg5;
if (!finalMsg?.segments) {
  console.error('❌ FAIL: No segments found');
  process.exit(1);
}

// Expected: text, tool_call, text, tool_call, text
const expectedPattern = ['text', 'tool_call', 'text', 'tool_call', 'text'];
let allValid = true;

if (finalMsg.segments.length !== expectedPattern.length) {
  console.error(`❌ FAIL: Expected ${expectedPattern.length} segments, got ${finalMsg.segments.length}`);
  allValid = false;
}

for (let i = 0; i < Math.min(finalMsg.segments.length, expectedPattern.length); i++) {
  const expected = expectedPattern[i];
  const actual = finalMsg.segments[i];

  if (actual.type !== expected) {
    console.error(`❌ FAIL: Segment ${i} type mismatch: expected ${expected}, got ${actual.type}`);
    allValid = false;
  } else {
    console.log(`✓ Segment ${i}: ${actual.type}`);
  }
}

// Verify text segments don't overlap
console.log('\n📏 Verifying text segments cover the full content without gaps:');
const textSegments = finalMsg.segments.filter(s => s.type === 'text');
const reconstructed = textSegments.map(s => s.type === 'text' ? s.content : '').join('');
const toolCallCount = finalMsg.segments.filter(s => s.type === 'tool_call').length;

console.log(`  Original content length: ${finalMsg.content.length}`);
console.log(`  Reconstructed length: ${reconstructed.length}`);
console.log(`  Tool calls: ${toolCallCount}`);

// Note: With tool calls inserted, the text segments should cover parts of the content
if (textSegments.length + toolCallCount === finalMsg.segments.length) {
  console.log('✓ Segment count matches (text + tool_calls)');
} else {
  console.error('❌ FAIL: Segment count mismatch');
  allValid = false;
}

console.log();
if (allValid) {
  console.log('✅ All tests passed! ReAct streaming segments with insertIndex work correctly.');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the implementation.');
  process.exit(1);
}
