export function alarmBuckets(grouped) {
  const g = grouped || {}
  return (
    g.buckets || {
      activeUnacked: g.activeUnacked || [],
      activeAcked: g.activeAcked || [],
      recoveredUnacked: g.recoveredUnacked || [],
      recoveredAcked: g.recoveredAcked || [],
    }
  )
}

export function alarmListForView(grouped, view, group) {
  const bucketMap = alarmBuckets(grouped)
  const legacyMap = { current: grouped?.current, history: grouped?.history }
  const list = bucketMap[view] || legacyMap?.[view] || grouped?.current || []
  if (group === 'all' || !group) return list
  return list.filter((a) => a.group === group)
}
