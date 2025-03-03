import { useState, useRef, useEffect } from 'react'

interface MultiSelectProps {
  value: string | string[]
  onChange: (value: string | string[]) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
  'aria-label'?: string
  size?: number
}

export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option',
  className = '',
  'aria-label': ariaLabel,
}: MultiSelectProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const originalIsArray = Array.isArray(value)
  // Coerce value to array for multiple selections
  const selectedValues = originalIsArray ? value : value ? [value] : []

  // Remove option from selection
  const removeOption = (val: string) => {
    const newValues = selectedValues.filter((v) => v !== val)
    if (originalIsArray) {
      onChange(newValues)
    } else {
      onChange(newValues[0] || '')
    }
  }

  // Add option on click, close dropdown
  const addOption = (val: string) => {
    const newValues = [...selectedValues, val]
    if (originalIsArray) {
      onChange(newValues)
    } else {
      onChange(newValues[0] || '')
    }
    setIsDropdownOpen(false)
  }

  // Filter available options
  const availableOptions = options.filter((opt) => !selectedValues.includes(opt.value))

  // Get label for a given value
  const getLabel = (val: string) => {
    const option = options.find((opt) => opt.value === val)
    return option ? option.label : val
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className={`relative rounded-md bg-zinc-800 ${className} group`} aria-label={ariaLabel} ref={dropdownRef}>
      {selectedValues.length > 0 && (
        <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-16px)] max-h-[24px] group-hover:max-h-[80px] overflow-hidden group-hover:overflow-y-auto transition-all duration-200 pr-2">
          {selectedValues.map((val) => (
            <span key={val} className="inline-flex items-center bg-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs">
              {getLabel(val)}
              <button
                type="button"
                onClick={() => removeOption(val)}
                className="ml-1 text-zinc-400 hover:text-zinc-200 focus:outline-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        readOnly
        onFocus={() => setIsDropdownOpen(true)}
        onClick={() => setIsDropdownOpen(true)}
        placeholder={selectedValues.length ? '' : placeholder}
        className={`w-full px-2 bg-transparent text-zinc-400 text-xs outline-none border border-zinc-700 rounded text-center min-h-10 h-auto ${
          selectedValues.length > 0 ? 'pt-10 pb-1' : 'py-1'
        }`}
      />
      {isDropdownOpen && (
        <div className="absolute mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10">
          {availableOptions.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => addOption(opt.value)}
              className="w-full text-left px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700 cursor-pointer"
            >
              {opt.label}
            </button>
          ))}
          {availableOptions.length === 0 && <div className="px-2 py-1 text-xs text-zinc-400">No options available</div>}
        </div>
      )}
    </div>
  )
}
