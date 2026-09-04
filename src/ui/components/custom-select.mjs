/**
 * CustomSelect - Reusable styled dropdown selector for DSH Vision Bench.
 * Aligns with the DSH design system popover and selection design.
 */

function normalizeOption(opt) {
  if (opt == null) return null;
  if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
    return { value: opt, label: String(opt), disabled: false, title: undefined };
  }
  if (typeof opt === 'object') {
    if (opt.props && (opt.type === 'option' || typeof opt.type === 'string')) {
      const val = opt.props.value !== undefined ? opt.props.value : opt.props.children;
      const label = opt.props.children != null ? String(opt.props.children) : String(val);
      return {
        value: val,
        label,
        disabled: !!opt.props.disabled,
        title: opt.props.title,
      };
    }
    const val = opt.value !== undefined ? opt.value : opt.key;
    return {
      value: val,
      label: opt.label != null ? String(opt.label) : String(val ?? ''),
      disabled: !!opt.disabled,
      title: opt.title,
    };
  }
  return null;
}

function normalizeOptions(options, children) {
  const result = [];
  if (Array.isArray(options)) {
    for (const opt of options) {
      const norm = normalizeOption(opt);
      if (norm) result.push(norm);
    }
  } else if (children) {
    const childArr = Array.isArray(children) ? children.flat(Infinity) : [children];
    for (const child of childArr) {
      const norm = normalizeOption(child);
      if (norm) result.push(norm);
    }
  }
  return result;
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
  } = props;

  const options = normalizeOptions(rawOptions, children);
  const isControlled = typeof controlledOpen === 'boolean';
  const isOpen = isControlled ? controlledOpen : props.internalOpen;

  const selectedOpt = options.find((opt) => String(opt.value) === String(value));
  const displayLabel = selectedOpt ? selectedOpt.label : (value !== undefined && value !== '' ? String(value) : placeholder);

  const triggerClasses = [
    'dvb-select-trigger',
    isOpen ? 'is-open' : '',
    disabled ? 'is-disabled' : '',
    size === 'sm' ? 'is-sm' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const wrapperClasses = ['dvb-select', className, isOpen ? 'is-open' : ''].filter(Boolean).join(' ');

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
        className: triggerClasses,
        style: triggerStyle || null,
        disabled: !!disabled,
        title: title || selectedOpt?.title || undefined,
        'aria-haspopup': 'listbox',
        'aria-expanded': isOpen ? 'true' : 'false',
        onClick(e) {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          if (typeof onToggle === 'function') {
            onToggle(!isOpen);
          }
        },
        onKeyDown(e) {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (!disabled && typeof onToggle === 'function') {
              onToggle(true);
            }
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
            className: 'dvb-select-dropdown' + (align === 'right' ? ' is-right' : ''),
            style: menuStyle || null,
            role: 'listbox',
            tabIndex: -1,
            onClick(e) {
              e.stopPropagation();
            },
          },
          options.map((opt, idx) => {
            const isSelected = selectedOpt ? opt.value === selectedOpt.value : String(opt.value) === String(value);
            const optClasses = [
              'dvb-select-option',
              isSelected ? 'is-selected' : '',
              opt.disabled ? 'is-disabled' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return el(
              'div',
              {
                key: `${opt.value}-${idx}`,
                className: optClasses,
                role: 'option',
                'aria-selected': isSelected ? 'true' : 'false',
                'aria-disabled': opt.disabled ? 'true' : undefined,
                title: opt.title || undefined,
                onClick(e) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (opt.disabled) return;
                  if (typeof onChange === 'function') {
                    onChange(opt.value);
                  }
                  if (typeof onToggle === 'function') {
                    onToggle(false);
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
            );
          }),
        )
      : null,
  );
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
