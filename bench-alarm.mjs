// Compatibility facade — prefer src/domain/modbus/alarm-model.mjs.
export {
  normalizeAlarmState,
  groupAlarms,
  acknowledgeAlarm,
  evaluateAlarms,
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
  suggestAlarm,
  buildAlarmRef,
} from './src/domain/modbus/alarm-model.mjs'
