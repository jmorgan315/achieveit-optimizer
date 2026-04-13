import { useState, useRef, useEffect, useCallback } from 'react';
import { format, parse } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export type EditableCellType = 'text' | 'textarea' | 'dropdown' | 'date';

export interface DropdownOption {
  value: string;
  label: string;
  color?: string;
}

interface EditableCellProps {
  value: string;
  onChange: (value: string) => void;
  type: EditableCellType;
  options?: DropdownOption[];
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  displayClassName?: string;
  /** Render a custom display (e.g. colored Badge) instead of plain text */
  renderDisplay?: (value: string) => React.ReactNode;
}

export function EditableCell({
  value,
  onChange,
  type,
  options,
  placeholder = '—',
  readOnly = false,
  className,
  displayClassName,
  renderDisplay,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
      autoResize(textareaRef.current);
    }
  }, [isEditing]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const save = useCallback(() => {
    setIsEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
  }, [draft, value, onChange]);

  const cancel = useCallback(() => {
    setDraft(value);
    setIsEditing(false);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
    // Enter saves for single-line text; for textarea, Enter adds newline, Ctrl+Enter saves
    if (type === 'textarea') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    } else {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    }
  };

  if (readOnly) {
    return (
      <div className={cn('px-2 py-1 text-sm text-muted-foreground', className)}>
        {renderDisplay ? renderDisplay(value) : (value || placeholder)}
      </div>
    );
  }

  // ── Date type ──
  if (type === 'date') {
    const dateValue = value ? (() => {
      const d = new Date(value + 'T00:00:00');
      return Number.isNaN(d.getTime()) ? undefined : d;
    })() : undefined;

    const formatDisplay = dateValue ? format(dateValue, 'M/d/yy') : '';

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'w-full text-left px-2 py-1 text-sm rounded hover:bg-muted/60 transition-colors cursor-pointer truncate',
              !dateValue && 'text-muted-foreground',
              className,
            )}
          >
            {formatDisplay || placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex flex-col">
            <Calendar
              mode="single"
              selected={dateValue}
              onSelect={(date) => {
                onChange(date ? format(date, 'yyyy-MM-dd') : '');
              }}
              initialFocus
              className="p-3 pointer-events-auto"
            />
            {dateValue && (
              <Button
                variant="ghost"
                size="sm"
                className="mx-3 mb-2"
                onClick={() => onChange('')}
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // ── Dropdown type ──
  if (type === 'dropdown' && options) {
    return (
      <Select
        value={value || 'none'}
        onValueChange={(v) => onChange(v === 'none' ? '' : v)}
      >
        <SelectTrigger
          className={cn(
            'h-auto min-h-[28px] border-0 shadow-none bg-transparent hover:bg-muted/60 px-2 py-1 text-sm focus:ring-0 focus:ring-offset-0',
            className,
          )}
        >
          <SelectValue placeholder={placeholder}>
            {renderDisplay
              ? renderDisplay(value)
              : (value || placeholder)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="text-muted-foreground">{placeholder}</span>
          </SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // ── Text / Textarea display mode ──
  if (!isEditing) {
    return (
      <button
        className={cn(
          'w-full text-left px-2 py-1 text-sm rounded hover:bg-muted/60 transition-colors cursor-pointer',
          type === 'textarea' ? 'whitespace-pre-wrap break-words' : 'truncate',
          !value && 'text-muted-foreground',
          displayClassName,
          className,
        )}
        onClick={() => setIsEditing(true)}
      >
        {renderDisplay ? renderDisplay(value) : (value || placeholder)}
      </button>
    );
  }

  // ── Text edit mode ──
  if (type === 'text') {
    return (
      <Input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn('h-7 text-sm px-2 py-1', className)}
      />
    );
  }

  // ── Textarea edit mode ──
  return (
    <textarea
      ref={textareaRef}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        autoResize(e.target);
      }}
      onBlur={save}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={1}
      className={cn(
        'w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    />
  );
}
