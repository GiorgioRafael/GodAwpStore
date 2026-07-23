export const ORDERS_PERIOD_OPTIONS = [
  { value: "all", label: "Todo o período" },
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "custom", label: "Personalizado" },
] as const;

export const ORDERS_STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "paid", label: "Pagos" },
  { value: "cancelled", label: "Cancelados" },
  { value: "awaiting_payment", label: "Aguardando pagamento" },
] as const;

export const ORDERS_PAGE_SIZE = 50;

export type OrdersPeriodKey = (typeof ORDERS_PERIOD_OPTIONS)[number]["value"];
export type OrdersStatusFilter = (typeof ORDERS_STATUS_OPTIONS)[number]["value"];

export type OrdersPeriodRange = {
  from: string | null;
  to: string | null;
};

export type ResolvedOrdersPeriod = OrdersPeriodRange & {
  key: OrdersPeriodKey;
  label: string;
  fromInput: string;
  toInput: string;
  error: string | null;
};

type SearchParamValue = string | string[] | undefined;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const SAO_PAULO_OFFSET = "-03:00";

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPeriodKey(value: string | undefined): value is OrdersPeriodKey {
  return ORDERS_PERIOD_OPTIONS.some((option) => option.value === value);
}

function isStatusFilter(value: string | undefined): value is OrdersStatusFilter {
  return ORDERS_STATUS_OPTIONS.some((option) => option.value === value);
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function saoPauloCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function startOfSaoPauloDay(value: string): string {
  return new Date(`${value}T00:00:00${SAO_PAULO_OFFSET}`).toISOString();
}

function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00.000Z`),
  );
}

function presetPeriod(key: Exclude<OrdersPeriodKey, "all" | "custom">, now: Date) {
  const today = saoPauloCalendarDate(now);
  const daysBack = key === "today" ? 0 : key === "7d" ? 6 : 29;
  const fromInput = shiftCalendarDate(today, -daysBack);
  const toInput = today;
  const label = ORDERS_PERIOD_OPTIONS.find((option) => option.value === key)?.label ?? "Período";

  return {
    key,
    label,
    fromInput,
    toInput,
    from: startOfSaoPauloDay(fromInput),
    to: startOfSaoPauloDay(shiftCalendarDate(toInput, 1)),
    error: null,
  } satisfies ResolvedOrdersPeriod;
}

export function resolveOrdersPeriod(
  searchParams: { period?: SearchParamValue; from?: SearchParamValue; to?: SearchParamValue },
  now = new Date(),
): ResolvedOrdersPeriod {
  const requestedKey = first(searchParams.period);
  const key = isPeriodKey(requestedKey) ? requestedKey : "all";

  if (key === "all") {
    return {
      key,
      label: "Todo o período",
      fromInput: "",
      toInput: "",
      from: null,
      to: null,
      error: null,
    };
  }

  if (key !== "custom") return presetPeriod(key, now);

  const fromInput = first(searchParams.from)?.trim() ?? "";
  const toInput = first(searchParams.to)?.trim() ?? "";
  const validDates = isCalendarDate(fromInput) && isCalendarDate(toInput);
  const validOrder = validDates && fromInput <= toInput;

  if (!validDates || !validOrder) {
    return {
      key,
      label: "Período personalizado",
      fromInput,
      toInput,
      from: null,
      to: null,
      error: !validDates
        ? "Informe as datas inicial e final para usar o período personalizado."
        : "A data inicial não pode ser posterior à data final.",
    };
  }

  return {
    key,
    label: `${formatCalendarDate(fromInput)} a ${formatCalendarDate(toInput)}`,
    fromInput,
    toInput,
    from: startOfSaoPauloDay(fromInput),
    to: startOfSaoPauloDay(shiftCalendarDate(toInput, 1)),
    error: null,
  };
}

export function resolveOrdersStatus(value: SearchParamValue): OrdersStatusFilter {
  const requested = first(value);
  return isStatusFilter(requested) ? requested : "all";
}

export function resolveOrdersPage(value: SearchParamValue): number {
  const requested = first(value);
  if (!requested || !/^\d+$/.test(requested)) return 1;
  const page = Number(requested);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
