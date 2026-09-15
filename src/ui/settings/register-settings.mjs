import { NS } from '../i18n/copy.mjs'

export function registerSettings(ctx, React, t, Page) {
  const slots = ctx.slots
  if (slots == null || React == null) return function () {}
  return slots.inject('settings.section', function () {
    return slots.register(
      {
        name: 'settings.section',
        id: 'dsh-vision-bench',
        order: 46,
        locale: NS,
        label() {
          return t('nav')
        },
      },
      Page,
    )
  })
}

