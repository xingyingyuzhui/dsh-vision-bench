// @ts-check
// Domain: tri-state alarm model (condition/ack, process/comm, deadband/delay/dedup).
export {
  ACTIVE,
  RECOVERED,
  ACKED,
  ALARM_STATUS,
  PROCESS,
  COMM,
  ALARM_GROUP,
  COND_ACTIVE,
  COND_RECOVERED,
  ALARM_CONDITION,
} from './alarm-constants.mjs'
export {
  normalizeAlarmState,
  groupAlarms,
  acknowledgeAlarm,
  suggestAlarm,
  buildAlarmRef,
} from './alarm-lifecycle.mjs'
export { evaluateAlarms } from './alarm-evaluate.mjs'
