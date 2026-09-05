/**
 * CustomSelect - Reusable styled dropdown selector for DSH Vision Bench.
 * Aligns with the DSH design system popover and selection design.
 */

function normalizeOption(opt) {
  if (opt == null) return null
  if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
    return { value: opt, label: String(opt), disabled: false, title: undefined }
  }
  if (typeof opt === 'object') {
    if (opt.props && (opt.type === 'option' || typeof opt.type === 'string')) {
      const val = opt.props.value !== undefined ? opt.props.value : opt.props.children
      const label = opt.props.children != null ? String(opt.props.children) : String(val)
      return {
        value: val,
        label,
        disabled: !!opt.props.disabled,
        title: opt.props.title,
      }
    }
    const val = opt.value !== undefined ? opt.value : opt.key
    return {
      value: val,
      label: opt.label != null ? String(opt.label) : String(val ?? ''),
      disabled: !!opt.disabled,
      title: opt.title,
    }
  }
  return null
}

function normalizeOptions(options, children) {
  const result = []
  if (Array.isArray(options)) {
    for (const opt of options) {
      const norm = normalizeOption(opt)
      if (norm) result.push(norm)
    }
  } else if (children) {
    const childArr = Array.isArray(children) ? children.flat(Number.POSITIVE_INFINITY) : [children]
    for (const child of childArr) {
      const norm = normalizeOption(child)
      if (norm) result.push(norm)
    }
  }
  return result
}

function findNextEnabledIndex(options, startIdx, step) {
  if (!options || !options.length) return -1
  const len = options.length
  let cur = startIdx >= 0 ? startIdx : step > 0 ? -1 : len
  for (let i = 0; i < len; i++) {
    cur = (cur + step + len) % len
    if (!options[cur].disabled) return cur
  }
  return -1
}

function findFirstEnabledIndex(options) {
  return options.findIndex((opt) => !opt.disabled)
}

function findLastEnabledIndex(options) {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i].disabled) return i
  }
  return -1
}

export function renderCustomSelect(el, props) {
  const {
    value,
    options: rawOptions,
    children,
    onChange,
    disabled = false,
    placeholder = '请选择',
    className = '',
    style,
    triggerStyle,
    menuStyle,
    align = 'left',
    size = 'default',
    title,
    open: controlledOpen,
    onToggle,
    highlightIndex: controlledHighlight,
    onHighlightIndexChange,
  } = props

  const options = normalizeOptions(rawOptions, children)
  const isControlled = typeof controlledOpen === 'boolean'
  const isOpen = isControlled ? controlledOpen : props.internalOpen

  const selectId = props.id || 'dvb-select'
  const listboxId = `${selectId}-listbox`

  const selectedOpt = options.find((opt) => String(opt.value) === String(value))
  const selectedIndex = options.findIndex((opt) => String(opt.value) === String(value))
  const highlightIndex =
    controlledHighlight !== undefined ? controlledHighlight : isOpen ? (selectedIndex >= 0 ? selectedIndex : 0) : -1

  const displayLabel = selectedOpt
    ? selectedOpt.label
    : value !== undefined && value !== ''
      ? String(value)
      : placeholder

  const triggerClasses = [
    'dvb-select-trigger',
    isOpen ? 'is-open' : '',
    disabled ? 'is-disabled' : '',
    size === 'sm' ? 'is-sm' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const wrapperClasses = ['dvb-select', className, isOpen ? 'is-open' : ''].filter(Boolean).join(' ')

  const activeOptionId =
    isOpen && highlightIndex >= 0 && options[highlightIndex] ? `${listboxId}-opt-${highlightIndex}` : undefined

  return el(
    'div',
    {
      className: wrapperClasses,
      style: style || null,
      ref: props.containerRef,
    },
    el(
      'button',
      {
        type: 'button',
        role: 'combobox',
        className: triggerClasses,
        style: triggerStyle || null,
        disabled: !!disabled,
        title: title || selectedOpt?.title || undefined,
        'aria-haspopup': 'listbox',
        'aria-expanded': isOpen ? 'true' : 'false',
        'aria-controls': isOpen ? listboxId : undefined,
        'aria-activedescendant': activeOptionId,
        onClick(e) {
          e.preventDefault()
          e.stopPropagation()
          if (disabled) return
          if (typeof onToggle === 'function') {
            onToggle(!isOpen)
          }
        },
        onKeyDown(e) {
          if (typeof props.onKeyDown === 'function') {
            props.onKeyDown(e)
            if (e.defaultPrevented) return
          }
          if (disabled) return
          if (!isOpen) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (typeof onToggle === 'function') {
                onToggle(true)
              }
            }
            return
          }

          if (e.key === 'ArrowDown') {
            e.preventDefault()
            const next = findNextEnabledIndex(options, highlightIndex, 1)
            if (next >= 0 && typeof onHighlightIndexChange === 'function') {
              onHighlightIndexChange(next)
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            const prev = findNextEnabledIndex(options, highlightIndex, -1)
            if (prev >= 0 && typeof onHighlightIndexChange === 'function') {
              onHighlightIndexChange(prev)
            }
          } else if (e.key === 'Home') {
            e.preventDefault()
            const first = findFirstEnabledIndex(options)
            if (first >= 0 && typeof onHighlightIndexChange === 'function') {
              onHighlightIndexChange(first)
            }
          } else if (e.key === 'End') {
            e.preventDefault()
            const last = findLastEnabledIndex(options)
            if (last >= 0 && typeof onHighlightIndexChange === 'function') {
              onHighlightIndexChange(last)
            }
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            const chosen = highlightIndex >= 0 ? options[highlightIndex] : selectedOpt
            if (chosen && !chosen.disabled) {
              if (typeof onChange === 'function') onChange(chosen.value)
              if (typeof onToggle === 'function') onToggle(false)
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (typeof onToggle === 'function') onToggle(false)
          } else if (e.key === 'Tab') {
            if (typeof onToggle === 'function') onToggle(false)
          }
        },
      },
      el('span', { className: 'dvb-select-label' }, displayLabel),
      el(
        'svg',
        {
          className: 'dvb-select-chevron',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        el('polyline', { points: '6 9 12 15 18 9' }),
      ),
    ),
    isOpen
      ? el(
          'div',
          {
            id: listboxId,
            className: `dvb-select-dropdown${align === 'right' ? ' is-right' : ''}`,
            style: menuStyle || null,
            role: 'listbox',
            tabIndex: -1,
            'aria-activedescendant': activeOptionId,
            onClick(e) {
              e.stopPropagation()
            },
          },
          options.map((opt, idx) => {
            const isSelected = selectedOpt ? opt.value === selectedOpt.value : String(opt.value) === String(value)
            const isHighlighted = highlightIndex === idx
            const optClasses = [
              'dvb-select-option',
              isSelected ? 'is-selected' : '',
              opt.disabled ? 'is-disabled' : '',
              isHighlighted ? 'is-highlighted' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return el(
              'div',
              {
                id: `${listboxId}-opt-${idx}`,
                key: `${opt.value}-${idx}`,
                className: optClasses,
                role: 'option',
                'aria-selected': isSelected ? 'true' : 'false',
                'aria-disabled': opt.disabled ? 'true' : undefined,
                title: opt.title || undefined,
                onMouseEnter() {
                  if (!opt.disabled && typeof onHighlightIndexChange === 'function') {
                    onHighlightIndexChange(idx)
                  }
                },
                onClick(e) {
                  e.preventDefault()
                  e.stopPropagation()
                  if (opt.disabled) return
                  if (typeof onChange === 'function') {
                    onChange(opt.value)
                  }
                  if (typeof onToggle === 'function') {
                    onToggle(false)
                  }
                },
              },
              el('span', { className: 'dvb-select-option-text' }, opt.label),
              isSelected
                ? el(
                    'svg',
                    {
                      className: 'dvb-select-check',
                      viewBox: '0 0 24 24',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: 2.4,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    },
                    el('polyline', { points: '20 6 9 17 4 12' }),
                  )
                : null,
            )
          }),
        )
      : null,
  )
}

const selectComponentCache = new WeakMap()

/**
 * React Component factory for CustomSelect.
 */
export function createCustomSelect(React) {
  if (!React || typeof React.useState !== 'function') {
    return function MockCustomSelect(props) {
      const el = (type, p, ...children) => ({ type, props: p, children: children.flat() })
      return renderCustomSelect(el, props)
    }
  }
  const el = React.createElement
  return function CustomSelect(props) {
    const [internalOpen, setInternalOpen] = React.useState(false)
    const [highlightIndex, setHighlightIndex] = React.useState(-1)
    const containerRef = React.useRef(null)

    const isOpen = typeof props.open === 'boolean' ? props.open : internalOpen

    React.useEffect(() => {
      if (!isOpen) return undefined

      function onPointerDown(e) {
        if (containerRef.current && !containerRef.current.contains(e.target)) {
          if (typeof props.onToggle === 'function') {
            props.onToggle(false)
          } else {
            setInternalOpen(false)
          }
        }
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (typeof props.onToggle === 'function') {
            props.onToggle(false)
          } else {
            setInternalOpen(false)
          }
        }
      }

      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }, [isOpen, props.onToggle])

    const handleToggle = (nextOpen) => {
      if (!nextOpen) {
        setHighlightIndex(-1)
      }
      if (typeof props.onToggle === 'function') {
        props.onToggle(nextOpen)
      } else {
        setInternalOpen(nextOpen)
      }
    }

    return renderCustomSelect(el, {
      ...props,
      internalOpen,
      containerRef,
      highlightIndex,
      onHighlightIndexChange: setHighlightIndex,
      onToggle: handleToggle,
    })
  }
}

/**
 * Get a cached, stable CustomSelect component instance for the given React runtime.
 */
export function getCustomSelect(React) {
  if (!React) return createCustomSelect(null)
  let comp = selectComponentCache.get(React)
  if (!comp) {
    comp = createCustomSelect(React)
    selectComponentCache.set(React, comp)
  }
  return comp
}
