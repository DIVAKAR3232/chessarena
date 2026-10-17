import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function toSkipTake({ page, pageSize }: Pagination) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta({ page, pageSize }: Pagination, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Builds a Zod enum of allowed sort keys plus a direction, e.g. `sort=createdAt&order=desc`. */
export function sortSchema<const T extends readonly [string, ...string[]]>(keys: T, defaultKey: T[number]) {
  return z.object({
    sort: z.enum(keys).default(defaultKey as never),
    order: z.enum(['asc', 'desc']).default('desc'),
  });
}
