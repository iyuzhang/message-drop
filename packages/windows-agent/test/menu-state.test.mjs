import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMenuTemplate } from '../lib/menu-state.mjs'

function toKeySequence(template) {
  return template.map((item) => item.label ?? `#${item.type}`)
}

test('buildMenuTemplate_runningStateUsesStrictLabelSequence', () => {
  const template = buildMenuTemplate({ status: 'running', autostartEnabled: true })
  assert.deepEqual(toKeySequence(template), [
    'Status: Running',
    '#separator',
    'Stop Server',
    'Autostart: On',
    '#separator',
    'Quit'
  ])
})

test('buildMenuTemplate_unknownStatusFallsBackToStopped', () => {
  const template = buildMenuTemplate({ status: 'unexpected-status', autostartEnabled: false })
  assert.equal(template[0]?.label, 'Status: Stopped')
})

test('buildMenuTemplate_autostartLabelTogglesOnOff', () => {
  const onTemplate = buildMenuTemplate({ status: 'stopped', autostartEnabled: true })
  const template = buildMenuTemplate({ status: 'stopped', autostartEnabled: false })
  assert.ok(onTemplate.some((item) => item.label === 'Autostart: On'))
  assert.ok(template.some((item) => item.label === 'Autostart: Off'))
})

test('buildMenuTemplate_errorStateOrdersRecoveryActions', () => {
  const template = buildMenuTemplate({ status: 'error', autostartEnabled: true })
  const sequence = toKeySequence(template)
  assert.equal(sequence[0], 'Status: Error')
  assert.ok(sequence.includes('Start Server'))
  assert.ok(!sequence.includes('Stop Server'))
  assert.deepEqual(sequence.slice(4, 6), ['Retry Start', 'View Logs'])
  assert.ok(sequence.indexOf('Retry Start') < sequence.indexOf('View Logs'))
})

test('buildMenuTemplate_stoppedStateShowsOnlyStartAction', () => {
  const template = buildMenuTemplate({ status: 'stopped', autostartEnabled: false })
  const sequence = toKeySequence(template)
  assert.ok(sequence.includes('Start Server'))
  assert.ok(!sequence.includes('Stop Server'))
})
