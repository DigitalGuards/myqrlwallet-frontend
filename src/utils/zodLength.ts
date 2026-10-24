/**
 * UTF-16 length checks for zod string schemas. Since zod 4.5, `.min()` and
 * `.max()` count Unicode code points. The wallet's limits are UTF-16 code
 * units (`string.length`, the unit the encryption and storage code checks), so
 * these keep text with astral characters (emoji) at the limits it had.
 */

import type { z } from 'zod';

type LengthCheck = (value: string, context: z.RefinementCtx<string>) => void;

export function minUtf16Length(minimum: number, message?: string): LengthCheck {
  return (value, context) => {
    if (value.length < minimum) {
      context.addIssue({
        code: 'too_small',
        origin: 'string',
        minimum,
        inclusive: true,
        input: value,
        ...(message === undefined ? {} : { message }),
      });
    }
  };
}

export function maxUtf16Length(maximum: number, message?: string): LengthCheck {
  return (value, context) => {
    if (value.length > maximum) {
      context.addIssue({
        code: 'too_big',
        origin: 'string',
        maximum,
        inclusive: true,
        input: value,
        ...(message === undefined ? {} : { message }),
      });
    }
  };
}
