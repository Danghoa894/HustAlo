// client/src/features/auth/form.ts — form dùng chung cho auth và cài đặt (ui_ux_spec.md §3.1, §3.8):
// validate bằng Zod schema của @hustalo/shared, lỗi hiện khi blur hoặc khi submit, lỗi server gắn vào trường,
// focus trường lỗi đầu tiên sau submit thất bại.
import { useCallback, useMemo, useRef, useState } from 'react';
import { vi } from '../../i18n/vi';
import { errorMessage } from '../../i18n/errors';
import { ApiError, NetworkError } from '../../lib/api/http';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Phần tối thiểu của Zod schema cần dùng (client không phụ thuộc trực tiếp gói zod). */
export interface SafeParser {
  safeParse(
    input: unknown,
  ):
    { success: true } | { success: false; error: { issues: { path: PropertyKey[]; code: string; message: string }[] } };
}

/**
 * Lỗi theo trường từ Zod. Thông điệp: trường rỗng → "Vui lòng nhập thông tin này"; refine/superRefine của shared
 * (code 'custom', đã là tiếng Việt) → giữ nguyên; còn lại → `fallback[field]` (không lộ thông điệp mặc định tiếng Anh).
 */
export function zodFieldErrors<K extends string>(
  schema: SafeParser,
  input: unknown,
  values: Record<K, string>,
  fallback: Record<K, string>,
): FieldErrors<K> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  const errors: FieldErrors<K> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    const field = typeof key === 'string' ? (key as K) : undefined;
    if (field === undefined || !(field in fallback) || errors[field] !== undefined) continue;
    errors[field] =
      values[field] === '' ? vi.common.required : issue.code === 'custom' ? issue.message : fallback[field];
  }
  return errors;
}

/** Lỗi chung của form (FormError) cho lỗi REST không gắn với trường nào (ui_ux_spec.md §3.1). */
export function formErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return vi.auth.offline;
  if (err instanceof ApiError) {
    if (err.code === 'SERVICE_UNAVAILABLE') return vi.auth.serverBusy;
    return errorMessage(err.code);
  }
  return errorMessage(null);
}

type ErrorDetail = { field?: unknown; path?: unknown };

/**
 * Tên trường lỗi trong `details`: `details.field` của 409 CONFLICT (EC-AUTH-001), `details[].field` của 422
 * (EC-AUTH-008), `details[].path` của 400 VALIDATION_ERROR (lấy phần đầu của path lồng nhau).
 */
export function errorFields(err: ApiError): string[] {
  const d = err.details as ErrorDetail | ErrorDetail[] | undefined;
  const list = Array.isArray(d) ? d : d ? [d] : [];
  return list.flatMap((x) => {
    if (typeof x.field === 'string') return [x.field];
    if (typeof x.path === 'string' && x.path !== '') return [x.path.split('.')[0] ?? x.path];
    return [];
  });
}

export function useForm<K extends string>(
  initial: Record<K, string>,
  validate: (v: Record<K, string>) => FieldErrors<K>,
) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors<K>>({});
  const refs = useRef<Partial<Record<K, HTMLInputElement | null>>>({});
  const order = useMemo(() => Object.keys(initial) as K[], [initial]);

  const clientErrors = useMemo(() => validate(values), [validate, values]);

  const errors = useMemo(() => {
    const out: FieldErrors<K> = {};
    for (const k of order) {
      const msg = serverErrors[k] ?? (touched[k] || submitted ? clientErrors[k] : undefined);
      if (msg !== undefined) out[k] = msg;
    }
    return out;
  }, [order, serverErrors, touched, submitted, clientErrors]);

  const focusFirst = useCallback(
    (errs: FieldErrors<K>) => {
      const first = order.find((k) => errs[k] !== undefined);
      if (first !== undefined) refs.current[first]?.focus();
    },
    [order],
  );

  /** true nếu hợp lệ; ngược lại hiện lỗi và focus trường lỗi đầu tiên. */
  const checkAll = useCallback(() => {
    setSubmitted(true);
    if (Object.keys(clientErrors).length === 0) return true;
    focusFirst(clientErrors);
    return false;
  }, [clientErrors, focusFirst]);

  const setServerError = useCallback(
    (k: K, msg: string) => {
      setServerErrors((s) => ({ ...s, [k]: msg }));
      focusFirst({ [k]: msg } as FieldErrors<K>);
    },
    [focusFirst],
  );

  const field = (k: K) => ({
    ref: (el: HTMLInputElement | null) => {
      refs.current[k] = el;
    },
    name: k,
    value: values[k],
    error: errors[k],
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      setValues((s) => ({ ...s, [k]: v }));
      setServerErrors((s) => {
        if (s[k] === undefined) return s;
        const next: FieldErrors<K> = { ...s };
        Reflect.deleteProperty(next, k);
        return next;
      });
    },
    onBlur: () => {
      setTouched((s) => ({ ...s, [k]: true }));
    },
  });

  const reset = useCallback(() => {
    setValues(initial);
    setTouched({});
    setSubmitted(false);
    setServerErrors({});
  }, [initial]);

  return { values, setValues, errors, field, checkAll, setServerError, reset };
}
