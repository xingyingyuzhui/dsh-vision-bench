import { COPY, NS } from './copy.mjs'

export function interpolate(template, params) {
  if (params == null) return template
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

export function activeLocaleId(ctx) {
  const locale = ctx && ctx.locale
  const snap = locale && (locale.getLocale ? locale.getLocale() : locale.getSnapshot && locale.getSnapshot())
  if (snap && typeof snap.active === 'string' && snap.active) return snap.active
  const tag = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'zh'
  return tag
}

export function isZh(ctx) {
  return String(activeLocaleId(ctx)).toLowerCase().indexOf('zh') === 0
}

export function translate(lang, key, params) {
  const table = COPY[lang] || COPY.en
  return interpolate(table[key] ?? COPY.en[key] ?? key, params)
}

export function tWith(ctx, key, params) {
  const locale = ctx && ctx.locale
  if (locale && typeof locale.bind === 'function') {
    const translated = locale.bind(NS)(key, params)
    if (translated && translated !== key) return interpolate(translated, params)
  }
  return translate(isZh(ctx) ? 'zh' : 'en', key, params)
}
