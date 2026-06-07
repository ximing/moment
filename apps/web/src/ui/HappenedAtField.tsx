import { useContext } from 'react';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker,
  DatePickerStateContext,
  DateSegment,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Label,
  Popover,
} from 'react-aria-components';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { parseDateTime, type CalendarDateTime, type DateValue } from '@internationalized/date';
import type { TimeValue } from 'react-aria-components';
import { Icon } from '@/ui/Icon';

const segmentClass =
  'rounded-md px-0.5 tabular-nums caret-transparent outline-none data-[placeholder]:text-muted data-[focused]:bg-select data-[focused]:text-select-fg data-[type=literal]:px-px data-[type=literal]:text-muted';

/** 发布面板「发生在」：点整条输入弹出日历 + 时间，皮用 token，不露时区。value 为本地 YYYY-MM-DDTHH:mm。 */
export function HappenedAtField({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  const parsed = parseLocalDateTime(value);

  return (
    <I18nProvider locale="zh-CN">
      <DatePicker
        granularity="minute"
        hourCycle={12}
        hideTimeZone
        firstDayOfWeek="mon"
        shouldCloseOnSelect={false}
        value={parsed}
        onChange={(next) => {
          if (!next) return;
          onChange(formatLocalDateTime(next));
        }}
        className="flex flex-col"
      >
        {({ state }) => (
          <>
            <Label className="mb-1 text-sm text-muted">发生在</Label>
            <Group
              className="flex cursor-pointer items-center gap-1 rounded-card border border-line bg-bg px-3 py-2 text-sm text-ink focus-within:border-action"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                e.preventDefault();
                state.setOpen(true);
              }}
            >
              <DateInput className="pointer-events-none flex min-w-0 flex-1 flex-wrap items-center">
                {(segment) => <DateSegment segment={segment} className={segmentClass} />}
              </DateInput>
              <Button
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted outline-none transition duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink data-[pressed]:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
                aria-label="选择日期和时间"
              >
                <Icon icon={CalendarIcon} />
              </Button>
            </Group>
            {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
            <Popover
              placement="bottom start"
              offset={8}
              className="z-50 !max-h-none rounded-[20px] border border-line bg-surface p-3 elev data-[entering]:animate-[grow-in_160ms_ease-out]"
            >
              <Dialog className="flex outline-none">
                <Calendar className="w-fit">
                  <header className="mb-2 flex items-center gap-1">
                    <Button
                      slot="previous"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted outline-none hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
                    >
                      <Icon icon={ChevronLeft} />
                    </Button>
                    <Heading className="flex-1 text-center text-sm font-semibold text-ink" />
                    <Button
                      slot="next"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted outline-none hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
                    >
                      <Icon icon={ChevronRight} />
                    </Button>
                  </header>
                  <CalendarGrid className="border-separate border-spacing-1">
                    <CalendarGridHeader>
                      {(day) => (
                        <CalendarHeaderCell className="h-8 w-9 text-center text-xs font-normal text-muted">
                          {day}
                        </CalendarHeaderCell>
                      )}
                    </CalendarGridHeader>
                    <CalendarGridBody>
                      {(date) => (
                        <CalendarCell
                          date={date}
                          className={({ isSelected, isToday, isOutsideMonth, isDisabled, isFocusVisible }) =>
                            [
                              'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-sm outline-none',
                              isOutsideMonth || isDisabled ? 'text-muted opacity-40' : 'text-ink',
                              isToday && !isSelected ? 'font-semibold text-[var(--today)]' : '',
                              isSelected
                                ? 'bg-action font-medium text-action-fg'
                                : 'hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]',
                              isFocusVisible ? 'ring-2 ring-action ring-offset-2 ring-offset-surface' : '',
                            ].join(' ')
                          }
                        />
                      )}
                    </CalendarGridBody>
                  </CalendarGrid>
                </Calendar>
                <PopoverTime />
              </Dialog>
            </Popover>
          </>
        )}
      </DatePicker>
    </I18nProvider>
  );
}

function PopoverTime() {
  const state = useContext(DatePickerStateContext);
  const t = state?.timeValue;
  if (!state?.hasTime || !t) return null;
  const pm = t.hour >= 12;
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;

  function apply(next: TimeValue) {
    state!.setTimeValue(next);
  }

  return (
    <div className="ml-3 flex w-[7.5rem] shrink-0 flex-col justify-center border-l border-line pl-3">
      <p className="mb-2 text-xs text-muted">时间</p>
      <div className="mb-3 flex rounded-full bg-bg p-0.5">
        <button
          type="button"
          className={`flex-1 rounded-full px-2 py-1 text-xs ${pm ? 'text-muted' : 'bg-select text-select-fg'}`}
          onClick={() => apply(t.set({ hour: hour12 === 12 ? 0 : hour12 }))}
        >
          上午
        </button>
        <button
          type="button"
          className={`flex-1 rounded-full px-2 py-1 text-xs ${pm ? 'bg-select text-select-fg' : 'text-muted'}`}
          onClick={() => apply(t.set({ hour: hour12 === 12 ? 12 : hour12 + 12 }))}
        >
          下午
        </button>
      </div>
      <div className="flex items-center justify-center gap-1">
        <TimeStep
          label="小时"
          value={hour12}
          onStep={(d) => {
            const next12 = ((((hour12 - 1 + d) % 12) + 12) % 12) + 1;
            const hour = (next12 % 12) + (pm ? 12 : 0);
            apply(t.set({ hour }));
          }}
        />
        <span className="pb-0.5 text-lg text-muted">:</span>
        <TimeStep
          label="分钟"
          value={t.minute}
          pad
          onStep={(d) => apply(t.cycle('minute', d))}
        />
      </div>
    </div>
  );
}

function TimeStep({
  label,
  value,
  onStep,
  pad: doPad,
}: {
  label: string;
  value: number;
  onStep: (delta: number) => void;
  pad?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={`${label}加一`}
        className="flex h-6 w-9 items-center justify-center rounded-md text-muted hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
        onClick={() => onStep(1)}
      >
        <Icon icon={ChevronUp} size={14} />
      </button>
      <span className="w-9 text-center text-sm tabular-nums text-ink">{doPad ? pad(value) : value}</span>
      <button
        type="button"
        aria-label={`${label}减一`}
        className="flex h-6 w-9 items-center justify-center rounded-md text-muted hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
        onClick={() => onStep(-1)}
      >
        <Icon icon={ChevronDown} size={14} />
      </button>
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseLocalDateTime(s: string): CalendarDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  try {
    return parseDateTime(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
  } catch {
    return null;
  }
}

function formatLocalDateTime(v: DateValue): string {
  const hour = 'hour' in v ? v.hour : 0;
  const minute = 'minute' in v ? v.minute : 0;
  return `${v.year}-${pad(v.month)}-${pad(v.day)}T${pad(hour)}:${pad(minute)}`;
}
